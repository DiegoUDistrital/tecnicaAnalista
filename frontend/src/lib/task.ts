/** Tarea tal como la devuelve `GET /api/tasks` (copia del tipo del servidor, que el navegador no puede importar). */
export interface Task {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  createdAt: string;
}

/** Guarda ligera: cinco campos con su tipo. El borde del servidor ya validó UUID, longitudes y fecha. */
export function isTask(value: unknown): value is Task {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const task = value as Record<string, unknown>;
  return (
    typeof task['id'] === 'string' &&
    typeof task['title'] === 'string' &&
    typeof task['description'] === 'string' &&
    typeof task['completed'] === 'boolean' &&
    typeof task['createdAt'] === 'string'
  );
}
