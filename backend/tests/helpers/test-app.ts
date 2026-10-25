import type { Express } from 'express';
import { createApp } from '../../src/app';
import type { Database } from '../../src/db/pool';
import { createCaptureLogger, type CaptureLogger } from './capture-logger';

export interface TestAppOptions {
  /** Rutas de prueba que se registran antes del 404 final y del manejador central. */
  registerRoutes?: (app: Express) => void;
  /** Logger de captura propio; si falta se crea uno. */
  capture?: CaptureLogger;
  /** Base de datos de la app; si falta se inyecta una que falla al usarse (los tests sin BD no deben tocarla). */
  database?: Database;
}

export interface TestApp {
  readonly app: Express;
  readonly capture: CaptureLogger;
}

/** `Database` para los tests que no deben consultar nada: cualquier uso es un error del test. */
export function unusedDatabase(): Database {
  return {
    query: () => Promise.reject(new Error('Este test no debe usar la base de datos.')),
    close: () => Promise.resolve(),
  };
}

/** Único punto de los tests que llama a `createApp`: construye la app real con un logger de captura. */
export function createTestApp(options: TestAppOptions = {}): TestApp {
  const capture = options.capture ?? createCaptureLogger();
  const app = createApp({
    logger: capture.logger,
    database: options.database ?? unusedDatabase(),
    ...(options.registerRoutes === undefined ? {} : { registerRoutes: options.registerRoutes }),
  });
  return { app, capture };
}
