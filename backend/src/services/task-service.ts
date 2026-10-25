import type { TaskRepository, TaskRow } from '../repositories/task-repository';

/** Tarea tal como sale por la API: exactamente cinco campos. */
export type Task = TaskRow;

export interface TaskService {
  /** Todas las tareas, de la más reciente a la más antigua; con `completed` solo completadas o solo pendientes. */
  list(completed?: boolean): Promise<Task[]>;
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

export function createTaskService(repository: Pick<TaskRepository, 'list'>): TaskService {
  return {
    async list(completed?: boolean): Promise<Task[]> {
      const rows = await repository.list(completed);
      return rows.map(toTask);
    },
  };
}
