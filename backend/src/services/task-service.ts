import { HttpError } from '../http/http-error';
import type { NewTask, TaskChanges, TaskRepository, TaskRow } from '../repositories/task-repository';

/** Tarea tal como sale por la API: exactamente cinco campos. */
export type Task = TaskRow;

export interface TaskService {
  /** Todas las tareas, de la más reciente a la más antigua; con `completed` solo completadas o solo pendientes. */
  list(completed?: boolean): Promise<Task[]>;
  /** Crea una tarea con los textos ya validados y recortados; `id`, `completed` y `createdAt` los pone la BD. */
  create(input: NewTask): Promise<Task>;
  /** Actualiza solo los campos presentes en `changes`; lanza `HttpError` 404 si la tarea no existe. */
  update(id: string, changes: TaskChanges): Promise<Task>;
}

/** Copia solo los cinco campos del contrato: una columna que se añada a la tabla no llega a la respuesta. */
function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    completed: row.completed,
    createdAt: row.createdAt,
  };
}

export function createTaskService(repository: Pick<TaskRepository, 'list' | 'insert' | 'update'>): TaskService {
  return {
    async list(completed?: boolean): Promise<Task[]> {
      const rows = await repository.list(completed);
      return rows.map(toTask);
    },
    async create(input: NewTask): Promise<Task> {
      return toTask(await repository.insert(input));
    },
    async update(id: string, changes: TaskChanges): Promise<Task> {
      const row = await repository.update(id, changes);
      if (row === undefined) {
        throw new HttpError(404);
      }
      return toTask(row);
    },
  };
}
