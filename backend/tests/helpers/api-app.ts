import type { Express } from 'express';
import type { AppConfig } from '../../src/config/config';
import { createPool, type Database } from '../../src/db/pool';
import type { Logger } from '../../src/logging/logger';
import { createCaptureLogger, type CaptureLogger } from './capture-logger';
import { getFreePort } from './server-fakes';
import { applySchema, getTestDatabase, resetSchema } from './test-database';
import { createTestApp } from './test-app';

export interface ApiAppOptions {
  /** Logger de captura propio (para construir antes una `Database` que lo use). */
  capture?: CaptureLogger;
  /** Base de datos de la app; si falta se usa un Pool real del rol writer sobre la BD de pruebas. */
  database?: Database;
  registerRoutes?: (app: Express) => void;
  /** Ajustes de la lista de tareas (tope); por defecto el de `createTestApp`. */
  tasks?: AppConfig['tasks'];
}

export interface ApiApp {
  readonly app: Express;
  readonly capture: CaptureLogger;
  readonly database: Database;
  close(): Promise<void>;
}

const POOL_SETTINGS = { max: 2, idleTimeoutMillis: 1000, connectionTimeoutMillis: 5000 };

/** Pool real del rol writer (la URL sale de TEST_DATABASE_URL; `getTestDatabase` aplica la guarda de seguridad). */
export function createWriterDatabase(logger: Logger): Database {
  getTestDatabase();
  return createPool({ connectionString: process.env['TEST_DATABASE_URL'] as string, ...POOL_SETTINGS }, logger);
}

/**
 * Pool dirigido a un puerto cerrado de 127.0.0.1 (no se detiene el contenedor compartido) con el plazo de conexión
 * mínimo permitido de la configuración (100 ms): simula la base de datos apagada.
 */
export async function createClosedPortDatabase(logger: Logger): Promise<Database> {
  getTestDatabase();
  const url = new URL(process.env['TEST_DATABASE_URL'] as string);
  url.hostname = '127.0.0.1';
  url.port = String(await getFreePort());
  return createPool({ connectionString: url.toString(), ...POOL_SETTINGS, connectionTimeoutMillis: 100 }, logger);
}

/**
 * Prepara la BD de pruebas (esquema nuevo con migración y permisos) y construye la app real conectada a ella. El
 * esquema se resetea: los archivos de test que la usan no pueden ejecutarse a la vez.
 */
export async function startApiApp(options: ApiAppOptions = {}): Promise<ApiApp> {
  await resetSchema();
  await applySchema();
  const capture = options.capture ?? createCaptureLogger();
  const database = options.database ?? createWriterDatabase(capture.logger);
  const { app } = createTestApp({
    capture,
    database,
    ...(options.tasks === undefined ? {} : { tasks: options.tasks }),
    ...(options.registerRoutes === undefined ? {} : { registerRoutes: options.registerRoutes }),
  });
  return { app, capture, database, close: () => database.close() };
}
