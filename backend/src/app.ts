import express, { type Express } from 'express';
import { createErrorHandler } from './http/error-handler';
import { health } from './http/health';
import { HttpError } from './http/http-error';
import { registerRoute } from './http/route-table';
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
 * Orden: rutas, 404 final y manejador central de errores.
 */
export function createApp(options: CreateAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.set('case sensitive routing', true);
  app.set('strict routing', true);
  // Con ETag desactivado, Express aún responde 304 a `If-None-Match: *` (la respuesta nunca debe depender de las
  // cabeceras de la petición); quitar la cabecera lo evita para todas las rutas.
  app.use((req, _res, next) => {
    delete req.headers['if-none-match'];
    next();
  });
  registerRoute(app, '/health', { GET: health });
  options.registerRoutes?.(app);
  app.use((_req, _res, next) => {
    next(new HttpError(404));
  });
  app.use(createErrorHandler(options.logger));
  return app;
}
