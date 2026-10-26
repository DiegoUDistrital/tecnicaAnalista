'use client';

import type { TaskFilter } from '../lib/task-filter';
import { TaskCard } from './task-card';
import { useTaskList } from './use-task-list';

const LOADING_TEXT = 'Cargando tareas…';
const EMPTY_TEXT: Record<TaskFilter, string> = {
  all: 'Aún no hay tareas…',
  completed: 'No hay tareas completadas.',
  pending: 'No hay tareas pendientes.',
};
const ALERT_CLASS = 'mt-3 flex flex-wrap items-center gap-3 rounded border border-red-300 p-3 text-sm text-red-700';

/**
 * Lista de tareas del filtro recibido. El padre no se desmonta al cambiar de filtro (lo garantiza la página), así que
 * aquí no hay `key` que dependa del filtro.
 */
export function TaskManager({ filter, total }: { filter: TaskFilter; total: number | null }) {
  const { tasks, status, loadError, refreshError, pending, reload } = useTaskList(filter);
  // `total` viene de los contadores (null si no están disponibles). Con carga o refresco en curso no se avisa.
  const truncated = status === 'ready' && pending === 0 && total !== null && total > tasks.length;

  return (
    <section>
      <h2 tabIndex={-1} className="mb-2 text-xl font-semibold">
        Tareas
      </h2>
      <div role="status" aria-live="polite" className="text-sm">
        {status === 'loading' ? <p>{LOADING_TEXT}</p> : null}
        {truncated ? <p>{`Mostrando las ${tasks.length} tareas más recientes de ${total}.`}</p> : null}
      </div>
      {status === 'error' ? (
        <div role="alert" className={ALERT_CLASS}>
          <p>{loadError}</p>
          <button type="button" className="rounded border px-3 py-1" onClick={() => reload('initial')}>
            Reintentar
          </button>
        </div>
      ) : null}
      {status === 'ready' && refreshError !== undefined ? (
        <div role="alert" className={ALERT_CLASS}>
          <p>{refreshError}</p>
          <button type="button" className="rounded border px-3 py-1" onClick={() => reload('background')}>
            Reintentar
          </button>
        </div>
      ) : null}
      {status === 'ready' && tasks.length === 0 ? <p className="mt-3">{EMPTY_TEXT[filter]}</p> : null}
      {tasks.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-3">
          {tasks.map((task) => (
            <li key={task.id}>
              <TaskCard task={task} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
