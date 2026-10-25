import http from 'node:http';
import { createApp } from '../app';
import { type AppConfig, loadConfig } from '../config/config';
import { createPool, type Database } from '../db/pool';
import { createLogger } from '../logging/logger';
import { type ConnectionTracker, createConnectionTracker } from './connection-tracker';
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

/**
 * Cierra el Pool tras un fallo de arranque dentro del plazo. Si el cierre rechaza se registra como
 * `uncaught_exception`; si excede el plazo, como `shutdown_timeout`. En ningún caso cambia el código de salida.
 */
async function closePoolAfterFailure(database: Database, timeoutMs: number, deps: ServerDeps): Promise<void> {
  try {
    const result = await runWithin(() => database.close(), timeoutMs, deps.timers);
    if (result === 'timeout') {
      deps.logger.error('shutdown_timeout', { context: { timeoutMs } });
    }
  } catch (error) {
    deps.logger.error('uncaught_exception', { thrown: error });
  }
}

interface Running {
  server: ServerLike;
  database: Database;
  tracker: ConnectionTracker;
  timeoutMs: number;
}

/** Cierra el servidor (sin conexiones nuevas; espera a que terminen las abiertas). Ignora el error del callback. */
function closeServer(server: ServerLike): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

const SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Estado «funcionando»: espera una señal, hace UN cierre ordenado y devuelve el código de salida. Orden: 1) el
 * servidor deja de aceptar conexiones y termina las peticiones en curso, 2) se cierra el Pool; todo dentro de
 * `SHUTDOWN_TIMEOUT_MS`. Si el plazo vence se corta lo que quede y el código es 1. Una segunda señal con el cierre
 * en curso termina de inmediato con código 1. Los manejadores se retiran antes de resolver.
 */
function superviseUntilShutdown(running: Running, deps: ServerDeps): Promise<number> {
  const { server, database, tracker, timeoutMs } = running;
  return new Promise<number>((resolve) => {
    let closing = false;
    let done = false;
    let exitCode = 0;

    const handlers = SIGNALS.map((signal) => ({ signal, handler: () => onSignal(signal) }));

    function finish(code: number): void {
      done = true;
      for (const { signal, handler } of handlers) {
        deps.process.off(signal, handler);
      }
      resolve(code);
    }

    async function closeAll(): Promise<void> {
      let result: 'completed' | 'timeout' = 'completed';
      try {
        result = await runWithin(
          async () => {
            await closeServer(server);
            await database.close();
          },
          timeoutMs,
          deps.timers,
        );
      } catch (error) {
        exitCode = 1;
        deps.logger.error('uncaught_exception', { thrown: error });
      }
      if (done) {
        return;
      }
      if (result === 'timeout') {
        deps.logger.error('shutdown_timeout', { context: { timeoutMs } });
        server.closeAllConnections();
        finish(1);
        return;
      }
      deps.logger.info('shutdown_completed', { exitCode });
      finish(exitCode);
    }

    function onSignal(signal: (typeof SIGNALS)[number]): void {
      if (closing) {
        finish(1);
        return;
      }
      closing = true;
      deps.logger.info('shutdown_started', { signal });
      tracker.closeAfterResponses();
      void closeAll();
    }

    for (const { signal, handler } of handlers) {
      deps.process.on(signal, handler);
    }
  });
}

/**
 * Arranca el servicio en tres pasos: 1) valida la configuración, 2) abre el Pool y comprueba la base de datos con
 * `SELECT 1`, 3) escucha. Si algo falla registra `startup_failed`, cierra el Pool dentro de `SHUTDOWN_TIMEOUT_MS` y
 * devuelve 1. Nunca rechaza ni llama a `process.exit`: solo `index.ts` aplica el código. Si arranca, registra
 * `startup` y la promesa queda pendiente hasta el cierre ordenado ante SIGTERM o SIGINT, que la resuelve con el
 * código de salida (0 solo si todo cerró bien).
 */
export async function startServer(overrides: Partial<ServerDeps> = {}): Promise<number> {
  const deps = { ...defaultDeps(), ...overrides };

  let config: AppConfig;
  try {
    config = loadConfig(deps.env);
  } catch (error) {
    deps.logger.error('startup_failed', { thrown: error });
    return 1;
  }

  const { port, host, shutdownTimeoutMs } = config.server;
  let database: Database | undefined;
  let server: ServerLike;
  const tracker = createConnectionTracker();
  try {
    database = deps.createDatabase(config, deps.logger);
    await database.query('SELECT 1');
    server = deps.createServer(deps.logger);
    tracker.attach(server);
    await listen(server, port, host);
  } catch (error) {
    deps.logger.error('startup_failed', { thrown: error });
    if (database !== undefined) {
      await closePoolAfterFailure(database, shutdownTimeoutMs, deps);
    }
    return 1;
  }

  const running = superviseUntilShutdown({ server, database, tracker, timeoutMs: shutdownTimeoutMs }, deps);
  deps.logger.info('startup', { host, port });
  return running;
}
