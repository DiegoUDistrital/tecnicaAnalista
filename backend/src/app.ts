import express, { type Express } from 'express';

export interface CreateAppOptions {
  /** Costura SOLO para tests: registra rutas extra antes de devolver la aplicación. */
  registerRoutes?: (app: Express) => void;
}

/**
 * Construye la aplicación Express sin arrancarla. Los ajustes se fijan antes de registrar rutas:
 * sin `X-Powered-By` ni ETag (la respuesta no debe depender de cabeceras de la petición) y con
 * comparación estricta de rutas (`/Health` y `/health/` no coinciden con `/health`).
 */
export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.set('case sensitive routing', true);
  app.set('strict routing', true);
  options.registerRoutes?.(app);
  return app;
}
