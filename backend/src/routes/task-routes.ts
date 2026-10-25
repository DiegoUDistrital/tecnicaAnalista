import type { Express } from 'express';
import type { TaskController } from '../controllers/task-controller';
import { withInput } from '../http/input/request-input';
import { registerRoute } from '../http/route-table';

/**
 * Ruta de identificador: una expresión regular SIN grupos de captura. Con `/api/tasks/:id` Express decodificaría el
 * segmento al enrutar y, con un porcentaje mal formado, fallaría ANTES de decidir el método (el 405 y el 400 `id`
 * serían un 500). Sin captura no decodifica nada; el controlador lee el segmento crudo y lo valida él. Solo coincide
 * con un segmento no vacío: `/api/tasks/<id>/` y las rutas anidadas dan 404.
 */
const TASK_ID_PATH = /^\/api\/tasks\/[^/]+$/;

/**
 * Rutas de tareas. `/api/tasks`: `GET` (lista) y `POST` (crear); cualquier otro método recibe 405 con
 * `Allow: GET, POST`. `/api/tasks/<id>`: `PUT` (actualizar); el resto recibe 405 con `Allow: PUT` (la tabla de
 * métodos genera `Allow` en el orden de sus claves). `/api/tasks/` no existe: 404.
 */
export function registerTaskRoutes(app: Express, controller: TaskController): void {
  registerRoute(app, '/api/tasks', {
    GET: withInput({ bodyMode: 'none' }, controller.list),
    POST: withInput({ bodyMode: 'required' }, controller.create),
  });
  registerRoute(app, TASK_ID_PATH, {
    PUT: withInput({ bodyMode: 'required' }, controller.update),
  });
}
