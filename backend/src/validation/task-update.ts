import type { TaskChanges } from '../repositories/task-repository';
import type { DetailProblems } from './details';
import { validateDescription, validateTitle } from './text-fields';
import { PUT_KEYS, hasUnknownKeys } from './unknown-keys';

export type TaskUpdateResult = { ok: true; changes: TaskChanges } | { ok: false; problems: DetailProblems };

/**
 * Valida el cuerpo de `PUT /api/tasks/:id` (la consulta la añade el controlador). Solo los campos presentes entran en
 * `changes`; los ausentes no aparecen ni como `undefined`. `body` es una única entrada: campos desconocidos, o bien
 * ningún campo (nunca las dos a la vez).
 */
export function validateTaskUpdate(body: Record<string, unknown>): TaskUpdateResult {
  const changes: TaskChanges = {};
  const problems: { -readonly [K in keyof DetailProblems]: DetailProblems[K] } = {};

  if (hasUnknownKeys(body, PUT_KEYS)) {
    problems.body = 'unknownFields';
  } else if (Object.keys(body).length === 0) {
    problems.body = 'noFields';
  }

  if (Object.hasOwn(body, 'title')) {
    const title = validateTitle(body['title']);
    if (title.ok) {
      changes.title = title.value;
    } else {
      problems.title = title.problem;
    }
  }
  if (Object.hasOwn(body, 'description')) {
    const description = validateDescription(body['description']);
    if (description.ok) {
      changes.description = description.value;
    } else {
      problems.description = description.problem;
    }
  }
  if (Object.hasOwn(body, 'completed')) {
    if (typeof body['completed'] === 'boolean') {
      changes.completed = body['completed'];
    } else {
      problems.completed = true;
    }
  }

  return Object.keys(problems).length === 0 ? { ok: true, changes } : { ok: false, problems };
}
