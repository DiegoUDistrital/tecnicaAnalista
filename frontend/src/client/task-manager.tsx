'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useReducer, useRef, useTransition } from 'react';
import type { TaskFilter } from '../lib/task-filter';
import { initialUiState, uiReducer } from '../lib/task-ui-state';
import { BTN_SECONDARY } from '../lib/ui-classes';
import { CreateForm } from './create-form';
import { RetryIcon } from './icons';
import { TaskCard } from './task-card';
import { useTaskActions } from './use-task-actions';
import { useTaskList } from './use-task-list';

const CREATED_NOTICE = 'Tarea creada.';
const LOADING_TEXT = 'Cargando tareas…';
const EMPTY_TEXT: Record<TaskFilter, string> = {
  all: 'Aún no hay tareas…',
  completed: 'No hay tareas completadas.',
  pending: 'No hay tareas pendientes.',
};
const ALERT_CLASS =
  'mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800';
const SKELETON_ROWS = [0, 1, 2];

/**
 * Lista de tareas del filtro recibido. El padre no se desmonta al cambiar de filtro (lo garantiza la página), así que
 * aquí no hay `key` que dependa del filtro.
 */
export function TaskManager({ filter, total }: { filter: TaskFilter; total: number | null }) {
  const { tasks, status, loadError, refreshError, pending, reload } = useTaskList(filter);
  const router = useRouter();
  // `routerPending` dura hasta que Next entrega los contadores nuevos: es el refresco en curso de los contadores.
  const [routerPending, startTransition] = useTransition();
  const [ui, dispatch] = useReducer(uiReducer, initialUiState);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Las escrituras no se cancelan al desmontar (un POST cancelado puede haber creado la tarea): se ignora el resultado.
  const afterWrite = useCallback(() => {
    if (!mounted.current) {
      return;
    }
    reload('background');
    startTransition(() => router.refresh());
  }, [reload, router]);
  const { toggle, remove, registerToggle, headingRef, editActions } = useTaskActions({
    tasks,
    status,
    dispatch,
    editing: ui.editing,
    afterWrite,
  });

  const clearNotice = useCallback(() => dispatch({ type: 'noticeCleared' }), []);
  const created = useCallback(() => {
    dispatch({ type: 'noticeSet', notice: CREATED_NOTICE });
    afterWrite();
  }, [afterWrite]);

  // Al llegar una lista, se olvidan los errores y la edición de las tareas que ya no están. Mientras carga (la lista
  // va vacía) no se hace: al cambiar de filtro se conservan los de las tareas que siguen.
  useEffect(() => {
    if (status === 'ready') {
      dispatch({ type: 'listArrived', ids: tasks.map((task) => task.id) });
    }
  }, [tasks, status]);

  // `total` viene de los contadores (null si no están disponibles). Con carga, refresco o escritura no se avisa.
  const truncated =
    status === 'ready' &&
    pending === 0 &&
    !routerPending &&
    ui.busy.length === 0 &&
    total !== null &&
    total > tasks.length;

  return (
    <div>
      <CreateForm onStart={clearNotice} onCreated={created} />
      <section>
        <h2 ref={headingRef} tabIndex={-1} className="mb-2 text-xl font-semibold">
          Tareas
        </h2>
        <div role="status" aria-live="polite" className="text-sm">
          {status === 'loading' ? <p className="sr-only">{LOADING_TEXT}</p> : null}
          {ui.notice === undefined ? null : <p>{ui.notice}</p>}
          {truncated ? <p>{`Mostrando las ${tasks.length} tareas más recientes de ${total}.`}</p> : null}
        </div>
        {status === 'error' ? (
          <div role="alert" className={ALERT_CLASS}>
            <p>{loadError}</p>
            <button type="button" className={BTN_SECONDARY} onClick={() => reload('initial')}>
              <RetryIcon />
              Reintentar
            </button>
          </div>
        ) : null}
        {status === 'ready' && refreshError !== undefined ? (
          <div role="alert" className={ALERT_CLASS}>
            <p>{refreshError}</p>
            <button type="button" className={BTN_SECONDARY} onClick={() => reload('background')}>
              <RetryIcon />
              Reintentar
            </button>
          </div>
        ) : null}
        {status === 'loading' && tasks.length === 0 ? (
          <div aria-hidden="true" className="mt-3 flex flex-col gap-3">
            {SKELETON_ROWS.map((row) => (
              <div key={row} className="h-24 animate-none rounded-xl bg-slate-200" />
            ))}
          </div>
        ) : null}
        {status === 'ready' && tasks.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-600">
            {EMPTY_TEXT[filter]}
          </p>
        ) : null}
        {tasks.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-3">
            {tasks.map((task) => (
              <li key={task.id}>
                <TaskCard
                  task={task}
                  busy={ui.busy.includes(task.id)}
                  error={ui.taskErrors[task.id]}
                  onToggle={toggle}
                  onDelete={remove}
                  editing={ui.editing?.id === task.id ? ui.editing : undefined}
                  editActions={editActions}
                  registerToggle={registerToggle}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
