import type { Express } from 'express';
import type { TaskController } from '../controllers/task-controller';
import { withInput } from '../http/input/request-input';
import { registerRoute } from '../http/route-table';

/**
 * Rutas de `/api/tasks`: `GET` (lista) y `POST` (crear). Cualquier otro método recibe 405 con `Allow: GET, POST` (lo
 * genera la tabla de métodos, en el orden de sus claves). `/api/tasks/` y `/api/tasks/<id>` no existen todavía: 404.
 */
export function registerTaskRoutes(app: Express, controller: TaskController): void {
  registerRoute(app, '/api/tasks', {
    GET: withInput({ bodyMode: 'none' }, controller.list),
    POST: withInput({ bodyMode: 'required' }, controller.create),
  });
}
