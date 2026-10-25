import type { InputHandler } from '../http/input/request-input';
import { HttpError } from '../http/http-error';
import type { TaskService } from '../services/task-service';
import { buildDetails } from '../validation/details';
import { evaluateQuery } from '../validation/raw-query';

export interface TaskController {
  list: InputHandler;
}

/**
 * Controlador de tareas: traduce la entrada ya comprobada en llamadas al servicio. `GET /api/tasks` solo admite el
 * parámetro `completed`; los problemas de consulta se acumulan en un único 400 (`query` primero, luego `completed`).
 */
export function createTaskController(service: TaskService): TaskController {
  return {
    async list(_req, res, input) {
      const query = evaluateQuery(input.rawQuery);
      if (query.unknownParameters || query.completedInvalid) {
        throw new HttpError(400, buildDetails({ query: query.unknownParameters, completed: query.completedInvalid }));
      }
      res.status(200).json(await service.list(query.completed));
    },
  };
}
