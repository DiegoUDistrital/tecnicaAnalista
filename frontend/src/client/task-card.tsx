import { memo } from 'react';
import type { Task } from '../lib/task';
import { formatCreatedAt } from '../lib/task-date';
import type { Editing } from '../lib/task-ui-state';
import { BTN_ICON, BTN_ICON_DANGER } from '../lib/ui-classes';
import { EditForm, type EditActions } from './edit-form';
import { CheckIcon, PencilIcon, TrashIcon } from './icons';

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
    <article
      data-task-id={task.id}
      className={`wrap-anywhere min-w-0 rounded-xl border border-slate-200 p-4 shadow-sm ${
        task.completed ? 'bg-slate-50' : 'bg-white'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {editing !== undefined && editActions !== undefined ? (
            <EditForm task={task} draft={editing} busy={busy} actions={editActions} />
          ) : (
            <>
              <h3 className={`text-base font-semibold ${task.completed ? 'text-slate-500 line-through' : ''}`}>
                {task.title}
              </h3>
              {task.description === '' ? null : (
                <p className="whitespace-pre-wrap text-sm text-slate-700">{task.description}</p>
              )}
            </>
          )}
          <p className="text-xs text-slate-600">
            <time dateTime={task.createdAt}>{formatCreatedAt(task.createdAt, timeZone)}</time>
          </p>
          <p
            className={`w-fit rounded-full px-2 text-xs font-medium ${
              task.completed ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
            }`}
          >
            {task.completed ? 'Completada' : 'Pendiente'}
          </p>
        </div>
        {/* Nombre accesible fijo (no cambia con el estado); `aria-pressed` dice si está completada. */}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <button
            type="button"
            aria-pressed={task.completed}
            aria-disabled={busy}
            ref={(element) => registerToggle?.(task.id, element)}
            onClick={() => onToggle?.(task)}
            title={`Marcar «${task.title}» como completada`}
            className={BTN_ICON}
          >
            <CheckIcon />
            <span className="sr-only">{`Marcar «${task.title}» como completada`}</span>
          </button>
          <button
            type="button"
            ref={(element) => editActions?.registerButton(task.id, element)}
            onClick={() => editActions?.open(task)}
            title={`Editar «${task.title}»`}
            className={BTN_ICON}
          >
            <PencilIcon />
            <span className="sr-only">{`Editar «${task.title}»`}</span>
          </button>
          <button
            type="button"
            aria-disabled={busy}
            onClick={() => onDelete?.(task)}
            title={`Eliminar «${task.title}»`}
            className={BTN_ICON_DANGER}
          >
            <TrashIcon />
            <span className="sr-only">{`Eliminar «${task.title}»`}</span>
          </button>
        </div>
      </div>
      {error === undefined ? null : (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </article>
  );
});
