import type { Express } from 'express';
import { createApp, type ShutdownApp } from '../../src/app';
import type { AppConfig } from '../../src/config/config';
import type { Database } from '../../src/db/pool';
import type { Logger } from '../../src/logging/logger';
import { createCaptureLogger, type CaptureLogger } from './capture-logger';
import { testSecurity, withTestKey } from './security';

export interface TestAppOptions {
  /** Rutas de prueba que se registran antes del 404 final y del manejador central. */
  registerRoutes?: (app: Express) => void;
  /** Logger de captura propio; si falta se crea uno. */
  capture?: CaptureLogger;
  /** Base de datos de la app; si falta se inyecta una que falla al usarse (los tests sin BD no deben tocarla). */
  database?: Database;
  /** Ajustes de seguridad; por defecto `testSecurity()`. */
  security?: AppConfig['security'];
}

export interface TestApp {
  readonly app: ShutdownApp;
  readonly capture: CaptureLogger;
}

/** `Database` para los tests que no deben consultar nada: cualquier uso es un error del test. */
export function unusedDatabase(): Database {
  return {
    query: () => Promise.reject(new Error('Este test no debe usar la base de datos.')),
    close: () => Promise.resolve(),
  };
}

export interface BuildTestAppOptions {
  logger: Logger;
  database: Database;
  registerRoutes?: (app: Express) => void;
  /** Ajustes de seguridad; por defecto `testSecurity()` (key válida, sin proxies de confianza, cupos altos). */
  security?: AppConfig['security'];
}

/**
 * Único punto de los tests que llama a `createApp`: construye la app real y hace que toda petición lleve la API key
 * de pruebas (`withTestKey`); para una petición sin key se envía el marcador `X-Test-Omit-Key`.
 */
export function buildTestApp(options: BuildTestAppOptions): ShutdownApp {
  return withTestKey(
    createApp({
      logger: options.logger,
      database: options.database,
      security: options.security ?? testSecurity(),
      ...(options.registerRoutes === undefined ? {} : { registerRoutes: options.registerRoutes }),
    }),
  );
}

/** App real con un logger de captura y, por defecto, una base de datos que falla al usarse. */
export function createTestApp(options: TestAppOptions = {}): TestApp {
  const capture = options.capture ?? createCaptureLogger();
  const app = buildTestApp({
    logger: capture.logger,
    database: options.database ?? unusedDatabase(),
    ...(options.security === undefined ? {} : { security: options.security }),
    ...(options.registerRoutes === undefined ? {} : { registerRoutes: options.registerRoutes }),
  });
  return { app, capture };
}
