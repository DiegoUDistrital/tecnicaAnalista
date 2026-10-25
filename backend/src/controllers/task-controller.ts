import type { Request } from 'express';
import { HttpError } from '../http/http-error';
import type { InputHandler } from '../http/input/request-input';
import type { TaskService } from '../services/task-service';
import { buildDetails } from '../validation/details';
import { evaluateQuery, hasQueryParameters } from '../validation/raw-query';
import { parseTaskId } from '../validation/task-id';
import { validateTaskUpdate } from '../validation/task-update';
import { validateDescription, validateTitle } from '../validation/text-fields';
import { POST_KEYS, hasUnknownKeys } from '../validation/unknown-keys';

export interface TaskController {
  list: InputHandler;
  create: InputHandler;
  update: InputHandler;
  remove: InputHandler;
}

/**
 * Último segmento de la ruta, CRUDO: `req.path` no lleva la consulta ni está decodificado (la ruta de identificador
 * es una expresión regular sin captura, así que Express tampoco lo decodificó). Lo valida `parseTaskId`.
 */
function rawIdOf(req: Request): string {
  return req.path.slice(req.path.lastIndexOf('/') + 1);
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

    // `PUT /api/tasks/:id`. Etapa 5: el identificador, SOLO (si es inválido no se miran consulta ni campos).
    // Etapa 6: consulta y campos, acumulados. Etapas 7 y 8: el servicio (404 si no existe; un fallo de BD es 500).
    async update(req, res, input) {
      const id = parseTaskId(rawIdOf(req));
      if (!id.ok) {
        throw new HttpError(400, buildDetails({ id: true }));
      }
      // La ruta usa `bodyMode: 'required'`: la entrada siempre entrega un objeto JSON.
      const update = validateTaskUpdate(input.body as Record<string, unknown>);
      const query = hasQueryParameters(input.rawQuery);
      if (!update.ok || query) {
        throw new HttpError(400, buildDetails({ ...(update.ok ? {} : update.problems), query }));
      }
      res.status(200).json(await service.update(id.value, update.changes));
    },

    // `DELETE /api/tasks/:id`: sin cuerpo (lo comprueba la entrada, etapa 4). Etapa 5: el identificador, SOLO.
    // Etapa 6: la consulta. Etapas 7 y 8: el servicio (404 si no existe, también al repetir el borrado).
    async remove(req, res, input) {
      const id = parseTaskId(rawIdOf(req));
      if (!id.ok) {
        throw new HttpError(400, buildDetails({ id: true }));
      }
      if (hasQueryParameters(input.rawQuery)) {
        throw new HttpError(400, buildDetails({ query: true }));
      }
      await service.remove(id.value);
      res.status(204).end();
    },
  };
}
