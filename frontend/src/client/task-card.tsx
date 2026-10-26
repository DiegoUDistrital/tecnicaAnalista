import { memo } from 'react';
import type { Task } from '../lib/task';
import { formatCreatedAt } from '../lib/task-date';

interface TaskCardProps {
  task: Task;
  /** Zona horaria de la fecha. En la página no se pasa (manda la del navegador); las pruebas fijan una. */
  timeZone?: string;
}

/**
 * Una tarea en pantalla. Todo el texto va como hijos de React, nunca como HTML: `<b>` o `<img>` se ven literales.
 * `wrap-anywhere` (se hereda por el contenido) y `min-w-0` evitan que un título sin espacios desborde la tarjeta.
 * Que no desborde en pantalla es RF-F26: se comprueba a mano.
 */
export const TaskCard = memo(function TaskCard({ task, timeZone }: TaskCardProps) {
  return (
    <article className="wrap-anywhere min-w-0 rounded border p-3">
      <h3 className="font-semibold">{task.title}</h3>
      {task.description === '' ? null : <p className="whitespace-pre-wrap text-sm">{task.description}</p>}
      <p className="text-xs text-gray-600">
        <time dateTime={task.createdAt}>{formatCreatedAt(task.createdAt, timeZone)}</time>
      </p>
      <p className="text-sm">{task.completed ? 'Completada' : 'Pendiente'}</p>
    </article>
  );
});
