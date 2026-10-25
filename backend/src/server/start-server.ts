import http from 'node:http';
import { createApp } from '../app';
import { type AppConfig, loadConfig } from '../config/config';
import { createPool, type Database } from '../db/pool';
import { DatabaseUnavailableError } from '../errors/database-unavailable-error';
import { createLogger } from '../logging/logger';
import { createConnectionTracker } from './connection-tracker';
import { runWithin } from './deadline';
import type { ServerDeps, ServerLike } from './server.types';

/** Dependencias reales; los tests sustituyen las que necesitan. */
function defaultDeps(): ServerDeps {
  return {
    env: process.env,
    logger: createLogger((line) => process.stdout.write(line)),
    createDatabase: (config, logger) => createPool({ connectionString: config.databaseUrl, ...config.pool }, logger),
    createServer: (logger) => http.createServer(createApp({ logger })),
    process,
    timers: {
      setTimer: (callback, ms) => {
        const timer = setTimeout(callback, ms);
        return () => {
          clearTimeout(timer);
        };
      },
    },
  };
}

/** Escucha en `host:port`: se cumple con `listening` y rechaza con el primer `error` (puerto ocupado, permisos...). */
function listen(server: ServerLike, port: number, host: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => {
      server.off('error', reject);
      resolve();
    });
    server.listen(port, host);
  });
}

const SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/** Cierra el servidor (sin conexiones nuevas; espera a que terminen las abiertas). Ignora el error del callback. */
function closeServer(server: ServerLike): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

/**
 * Arranca el servicio en tres pasos: 1) valida la configuración y abre el Pool, 2) comprueba la base de datos con
 * `SELECT 1`, 3) escucha. Devuelve el código de salida; nunca rechaza ni llama a `process.exit`: solo `index.ts`
 * aplica el código. La promesa termina cuando el servicio ya no tiene nada pendiente.
 *
 * - Fallo propio al arrancar: registra `startup_failed`, cierra el Pool dentro de `SHUTDOWN_TIMEOUT_MS` y devuelve 1.
 * - Arranque correcto: registra `startup` y espera una señal (SIGTERM o SIGINT) para hacer UN cierre ordenado: el
 *   servidor deja de aceptar conexiones y termina las peticiones en curso, y después se cierra el Pool, todo dentro
 *   del plazo. Devuelve 0 si todo cerró bien; si el plazo vence corta las conexiones que queden y devuelve 1.
 * - Señal durante el arranque: aborta sin aceptar peticiones (no llega a escuchar, o cierra el servidor de
 *   inmediato si ya había pedido `listen`), cierra el Pool y devuelve 0. Un fallo de la comprobación de la base de
 *   datos solo se considera provocado por el aborto si ya se había pedido y es un `DatabaseUnavailableError`
 *   (el Pool cerrado); cualquier otro fallo es causa propia y prevalece el código 1.
 * - Una segunda señal con un cierre o un fallo de arranque en curso termina de inmediato con código 1.
 *
 * Las señales se registran al principio y se retiran antes de resolver.
 */
export function startServer(overrides: Partial<ServerDeps> = {}): Promise<number> {
  const deps = { ...defaultDeps(), ...overrides };

  return new Promise<number>((resolve) => {
    let phase: 'starting' | 'running' | 'closing' = 'starting';
    let abortRequested = false;
    let done = false;
    let exitCode = 0;
    let timeoutMs = 0;
    let database: Database | undefined;
    let server: ServerLike | undefined;
    let listenCalled = false;
    let pendingCheck: Promise<boolean> = Promise.resolve(true);
    const tracker = createConnectionTracker();

    const handlers = SIGNALS.map((signal) => ({ signal, handler: () => onSignal(signal) }));
    for (const { signal, handler } of handlers) {
      deps.process.on(signal, handler);
    }

    function finish(code: number): void {
      if (done) {
        return;
      }
      done = true;
      for (const { signal, handler } of handlers) {
        deps.process.off(signal, handler);
      }
      resolve(code);
    }

    function reportCloseFailure(error: unknown): void {
      exitCode = 1;
      deps.logger.error('uncaught_exception', { thrown: error });
    }

    /** Fallo propio del arranque: lo registra y, si no hay ya un cierre en curso, cierra el Pool y termina con 1. */
    function startupFailed(error: unknown): void {
      if (done) {
        return;
      }
      exitCode = 1;
      deps.logger.error('startup_failed', { thrown: error });
      if (phase === 'closing') {
        return;
      }
      phase = 'closing';
      void closePoolAfterFailure();
    }

    async function closePoolAfterFailure(): Promise<void> {
      const db = database;
      if (db !== undefined) {
        try {
          const result = await runWithin(() => db.close(), timeoutMs, deps.timers);
          if (done) {
            return;
          }
          if (result === 'timeout') {
            deps.logger.error('shutdown_timeout', { context: { timeoutMs } });
          }
        } catch (error) {
          deps.logger.error('uncaught_exception', { thrown: error });
        }
      }
      finish(1);
    }

    /** Comprueba la base de datos. Devuelve `false` si falla; nunca rechaza. */
    async function checkDatabase(db: Database): Promise<boolean> {
      try {
        await db.query('SELECT 1');
        return true;
      } catch (error) {
        // Con la bandera, el `DatabaseUnavailableError` es el del Pool cerrado por el aborto: no es una causa.
        if (!(abortRequested && error instanceof DatabaseUnavailableError)) {
          startupFailed(error);
        }
        return false;
      }
    }

    /** Crea el servidor y escucha. Tras cada espera comprueba si se pidió el aborto. */
    async function listenIfNotAborted(port: number, host: string): Promise<void> {
      if (!(await pendingCheck) || abortRequested) {
        return;
      }
      try {
        server = deps.createServer(deps.logger);
        tracker.attach(server);
        listenCalled = true;
        await listen(server, port, host);
      } catch (error) {
        startupFailed(error);
        return;
      }
      if (abortRequested) {
        return;
      }
      phase = 'running';
      deps.logger.info('startup', { host, port });
    }

    async function closeResources(): Promise<void> {
      if (server !== undefined && listenCalled) {
        await closeServer(server);
      }
      await Promise.all([database?.close(), pendingCheck]);
    }

    async function closeAll(): Promise<void> {
      let result: 'completed' | 'timeout' = 'completed';
      try {
        result = await runWithin(closeResources, timeoutMs, deps.timers);
      } catch (error) {
        reportCloseFailure(error);
      }
      if (done) {
        return;
      }
      if (result === 'timeout') {
        deps.logger.error('shutdown_timeout', { context: { timeoutMs } });
        server?.closeAllConnections();
        finish(1);
        return;
      }
      deps.logger.info('shutdown_completed', { exitCode });
      finish(exitCode);
    }

    function onSignal(signal: (typeof SIGNALS)[number]): void {
      if (phase === 'closing') {
        finish(1);
        return;
      }
      // La bandera se activa antes de cerrar el Pool: así el fallo que provoca el cierre se reconoce como aborto.
      abortRequested = phase === 'starting';
      phase = 'closing';
      deps.logger.info('shutdown_started', { signal });
      tracker.closeAfterResponses();
      void closeAll();
    }

    let config: AppConfig;
    try {
      config = loadConfig(deps.env);
      timeoutMs = config.server.shutdownTimeoutMs;
      database = deps.createDatabase(config, deps.logger);
    } catch (error) {
      startupFailed(error);
      return;
    }
    pendingCheck = checkDatabase(database);
    void listenIfNotAborted(config.server.port, config.server.host);
  });
}
