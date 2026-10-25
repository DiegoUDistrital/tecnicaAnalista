import express, { type Express } from 'express';
import { createErrorHandler } from './http/error-handler';
import type { Logger } from './logging/logger';

export interface CreateAppOptions {
  /** Logger donde el manejador central registra los errores 5xx (`request_error`). */
  logger: Logger;
  /** Costura SOLO para tests: registra rutas extra antes del manejador central. */
  registerRoutes?: (app: Express) => void;
}

/**
 * Construye la aplicación Express sin arrancarla. Los ajustes se fijan antes de registrar rutas:
 * sin `X-Powered-By` ni ETag (la respuesta no debe depender de cabeceras de la petición) y con
 * comparación estricta de rutas (`/Health` y `/health/` no coinciden con `/health`).
 * El manejador central de errores se registra al final, después de todas las rutas.
 */
export function createApp(options: CreateAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.set('case sensitive routing', true);
  app.set('strict routing', true);
  options.registerRoutes?.(app);
  app.use(createErrorHandler(options.logger));
  return app;
}
