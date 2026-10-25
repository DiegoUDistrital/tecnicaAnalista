import http from 'node:http';
import { createApp } from '../app';
import { type AppConfig, loadConfig } from '../config/config';
import { createPool, type Database } from '../db/pool';
import { createLogger } from '../logging/logger';
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

/**
 * Arranca el servicio en tres pasos: 1) valida la configuración, 2) abre el Pool y comprueba la base de datos con
 * `SELECT 1`, 3) escucha. Si algo falla registra `startup_failed`, cierra el Pool dentro de `SHUTDOWN_TIMEOUT_MS` y
 * devuelve 1. Nunca rechaza ni llama a `process.exit`: solo `index.ts` aplica el código. Si arranca, registra
 * `startup` y la promesa queda pendiente (el cierre ordenado llega con las señales).
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
  try {
    database = deps.createDatabase(config, deps.logger);
    await database.query('SELECT 1');
    await listen(deps.createServer(deps.logger), port, host);
  } catch (error) {
    deps.logger.error('startup_failed', { thrown: error });
    if (database !== undefined) {
      await closePoolAfterFailure(database, shutdownTimeoutMs, deps);
    }
    return 1;
  }

  deps.logger.info('startup', { host, port });
  return new Promise<number>(() => undefined);
}
