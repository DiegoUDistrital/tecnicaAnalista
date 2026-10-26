import { memo } from 'react';
import type { Task } from '../lib/task';
import { formatCreatedAt } from '../lib/task-date';
import type { Editing } from '../lib/task-ui-state';
import { EditForm, type EditActions } from './edit-form';

interface TaskCardProps {
  task: Task;
  /** Zona horaria de la fecha. En la página no se pasa (manda la del navegador); las pruebas fijan una. */
  timeZone?: string;
  /** Hay una petición en curso sobre esta tarea: los controles quedan con `aria-disabled` (no `disabled`). */
  busy?: boolean;
  /** Error de la última acción sobre esta tarea. */
  error?: string;
  onToggle?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  /** Borrador de edición, solo si ESTA tarea es la que se edita (las demás tarjetas no se repintan al escribir). */
  editing?: Editing;
  editActions?: EditActions;
  /** El padre guarda el botón de completar de cada tarea para llevarle el foco. */
  registerToggle?: (id: string, element: HTMLButtonElement | null) => void;
}

/**
 * Una tarea en pantalla. Todo el texto va como hijos de React, nunca como HTML: `<b>` o `<img>` se ven literales.
 * `wrap-anywhere` (se hereda por el contenido) y `min-w-0` evitan que un título sin espacios desborde la tarjeta.
 * Que no desborde en pantalla es RF-F26: se comprueba a mano.
 */
export const TaskCard = memo(function TaskCard({
  task,
  timeZone,
  busy = false,
  error,
  onToggle,
  onDelete,
  editing,
  editActions,
  registerToggle,
}: TaskCardProps) {
  return (
    <article data-task-id={task.id} className="wrap-anywhere min-w-0 rounded border p-3">
      {editing !== undefined && editActions !== undefined ? (
        <EditForm task={task} draft={editing} busy={busy} actions={editActions} />
      ) : (
        <>
          <h3 className="font-semibold">{task.title}</h3>
          {task.description === '' ? null : <p className="whitespace-pre-wrap text-sm">{task.description}</p>}
        </>
      )}
      <p className="text-xs text-gray-600">
        <time dateTime={task.createdAt}>{formatCreatedAt(task.createdAt, timeZone)}</time>
      </p>
      <p className="text-sm">{task.completed ? 'Completada' : 'Pendiente'}</p>
      {/* Nombre accesible fijo (no cambia con el estado); `aria-pressed` dice si está completada. */}
      <button
        type="button"
        aria-pressed={task.completed}
        aria-disabled={busy}
        ref={(element) => registerToggle?.(task.id, element)}
        onClick={() => onToggle?.(task)}
        className="mt-2 min-h-11 min-w-11 rounded border px-3 py-1 text-left aria-disabled:opacity-60"
      >
        {`Marcar «${task.title}» como completada`}
      </button>
      <button
        type="button"
        ref={(element) => editActions?.registerButton(task.id, element)}
        onClick={() => editActions?.open(task)}
        className="mt-2 ml-2 min-h-11 min-w-11 rounded border px-3 py-1"
      >
        {`Editar «${task.title}»`}
      </button>
      <button
        type="button"
        aria-disabled={busy}
        onClick={() => onDelete?.(task)}
        className="mt-2 ml-2 min-h-11 min-w-11 rounded border px-3 py-1 aria-disabled:opacity-60"
      >
        {`Eliminar «${task.title}»`}
      </button>
      {error === undefined ? null : (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </article>
  );
});
