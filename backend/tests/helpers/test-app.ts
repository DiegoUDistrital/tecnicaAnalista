import type { Express } from 'express';
import { createApp } from '../../src/app';
import { createCaptureLogger, type CaptureLogger } from './capture-logger';

export interface TestAppOptions {
  /** Rutas de prueba que se registran antes del 404 final y del manejador central. */
  registerRoutes?: (app: Express) => void;
  /** Logger de captura propio; si falta se crea uno. */
  capture?: CaptureLogger;
}

export interface TestApp {
  readonly app: Express;
  readonly capture: CaptureLogger;
}

/** Único punto de los tests que llama a `createApp`: construye la app real con un logger de captura. */
export function createTestApp(options: TestAppOptions = {}): TestApp {
  const capture = options.capture ?? createCaptureLogger();
  const app = createApp({
    logger: capture.logger,
    ...(options.registerRoutes === undefined ? {} : { registerRoutes: options.registerRoutes }),
  });
  return { app, capture };
}
