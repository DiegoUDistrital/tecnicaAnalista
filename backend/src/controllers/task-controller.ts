import { HttpError } from '../http/http-error';
import type { InputHandler } from '../http/input/request-input';
import type { TaskService } from '../services/task-service';
import { buildDetails } from '../validation/details';
import { evaluateQuery, hasQueryParameters } from '../validation/raw-query';
import { validateDescription, validateTitle } from '../validation/text-fields';
import { POST_KEYS, hasUnknownKeys } from '../validation/unknown-keys';

export interface TaskController {
  list: InputHandler;
  create: InputHandler;
}

/**
 * Controlador de tareas: traduce la entrada ya comprobada en llamadas al servicio. Es la etapa 6 de la tubería
 * (campos y consulta), la única que acumula: reúne todos los problemas en un único 400 con `details` en orden fijo.
 */
export function createTaskController(service: TaskService): TaskController {
  return {
    // `GET /api/tasks` solo admite el parámetro `completed`: `query` primero, luego `completed`.
    async list(_req, res, input) {
      const query = evaluateQuery(input.rawQuery);
      if (query.unknownParameters || query.completedInvalid) {
        throw new HttpError(400, buildDetails({ query: query.unknownParameters, completed: query.completedInvalid }));
      }
      res.status(200).json(await service.list(query.completed));
    },

    // `POST /api/tasks` no admite ningún parámetro de consulta y solo las claves `title` y `description`.
    async create(_req, res, input) {
      // La ruta usa `bodyMode: 'required'`: la entrada siempre entrega un objeto JSON.
      const body = input.body as Record<string, unknown>;
      const unknownKeys = hasUnknownKeys(body, POST_KEYS);
      const query = hasQueryParameters(input.rawQuery);
      const title = validateTitle(body['title']);
      // Ausente vale cadena vacía; presente (incluso `null`) se valida.
      const description = Object.hasOwn(body, 'description')
        ? validateDescription(body['description'])
        : ({ ok: true, value: '' } as const);
      if (unknownKeys || query || !title.ok || !description.ok) {
        throw new HttpError(
          400,
          buildDetails({
            ...(unknownKeys ? { body: 'unknownFields' as const } : {}),
            query,
            ...(title.ok ? {} : { title: title.problem }),
            ...(description.ok ? {} : { description: description.problem }),
          }),
        );
      }
      res.status(201).json(await service.create({ title: title.value, description: description.value }));
    },
  };
}
