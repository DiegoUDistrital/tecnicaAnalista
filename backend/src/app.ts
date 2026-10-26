import express, { type Express } from 'express';
import type { AppConfig } from './config/config';
import { createTaskController } from './controllers/task-controller';
import type { Database } from './db/pool';
import { createErrorHandler } from './http/error-handler';
import { health } from './http/health';
import { HttpError } from './http/http-error';
import { registerRoute } from './http/route-table';
import type { Logger } from './logging/logger';
import { createTaskRepository } from './repositories/task-repository';
import { createAuthGuard } from './security/auth-guard';
import { createSecurityHeaders, noStore } from './security/response-headers';
import { registerTaskRoutes } from './routes/task-routes';
import { createTaskService } from './services/task-service';

export interface CreateAppOptions {
  /** Logger donde el manejador central registra los errores 5xx (`request_error`). */
  logger: Logger;
  /** Base de datos de la API: repositorio, servicio y controlador de tareas se construyen sobre ella. */
  database: Database;
  /** Ajustes de seguridad de la configuración: de ellos sale la API key que toda ruta salvo `/health` exige. */
  security: AppConfig['security'];
  /** Costura SOLO para tests: registra rutas extra antes del manejador central. */
  registerRoutes?: (app: Express) => void;
}

/**
 * Construye la aplicación Express sin arrancarla. Los ajustes se fijan antes de registrar rutas:
 * sin `X-Powered-By` ni ETag (la respuesta no debe depender de cabeceras de la petición) y con
 * comparación estricta de rutas (`/Health` y `/health/` no coinciden con `/health`) y sin intérprete de consulta (la
 * consulta se evalúa cruda: el intérprete descarta claves como `__proto__` y trunca a 1 000 parámetros).
 * Orden: cabeceras de `helmet` (toda respuesta), `/health` (la única ruta sin key), `Cache-Control: no-store`,
 * guarda de la API key, rutas de `/api/tasks`, rutas de prueba, 404 final y manejador central de errores.
 * La guarda es `app.use` sin ruta: protege TODO lo registrado después, así que una ruta
 * nueva nace protegida y la exención la decide el mismo enrutador que despacha `/health` (sin comparar cadenas).
 */
export function createApp(options: CreateAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.set('case sensitive routing', true);
  app.set('strict routing', true);
  app.set('query parser', false);
  // Con ETag desactivado, Express aún responde 304 a `If-None-Match: *` (la respuesta nunca debe depender de las
  // cabeceras de la petición); quitar la cabecera lo evita para todas las rutas.
  app.use((req, _res, next) => {
    delete req.headers['if-none-match'];
    next();
  });
  app.use(createSecurityHeaders());
  registerRoute(app, '/health', { GET: health });
  app.use(noStore);
  app.use(createAuthGuard(options.security.apiKey));
  registerTaskRoutes(app, createTaskController(createTaskService(createTaskRepository(options.database))));
  options.registerRoutes?.(app);
  app.use((_req, _res, next) => {
    next(new HttpError(404));
  });
  app.use(createErrorHandler(options.logger));
  return app;
}
