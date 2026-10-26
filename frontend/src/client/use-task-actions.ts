'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch } from 'react';
import type { Task } from '../lib/task';
import type { UiAction } from '../lib/task-ui-state';
import type { TaskList } from './use-task-list';
import { deleteTask, updateTask, type WriteResult } from './tasks-api';

export const GONE_NOTICE = 'La tarea ya no existe.';
export const UPDATED_NOTICE = 'Lista actualizada.';

/** Qué hacer con el foco cuando llegue la lista nueva: los vecinos se guardan antes de que la tarjeta desaparezca. */
interface FocusIntent {
  id: string;
  nextId: string | undefined;
  prevId: string | undefined;
  /** Solo se atiende cuando la escritura terminó bien (o con 404): si falla no hay lista nueva que esperar. */
  armed: boolean;
}

interface Params {
  tasks: Task[];
  status: TaskList['status'];
  dispatch: Dispatch<UiAction>;
  /** Vuelve a pedir la lista y los contadores tras una escritura (RF-F15). */
  afterWrite: () => void;
}

/**
 * Acciones sobre una tarea que ya existe. Todas pasan por el mismo camino: un guardia síncrono por id (una marca que
 * se escribe antes de que React repinte, así un segundo clic no envía otra petición), el error junto a la tarea, el
 * 404 como aviso global y el foco hacia la tarjeta vecina cuando la tarea desaparece.
 */
export function useTaskActions({ tasks, status, dispatch, afterWrite }: Params) {
  const inFlight = useRef(new Set<string>());
  const focusIntent = useRef<FocusIntent>(undefined);
  const toggleButtons = useRef(new Map<string, HTMLButtonElement>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Las acciones leen siempre lo último sin cambiar de identidad (así las tarjetas memorizadas no se repintan). Se
  // actualiza en el efecto de layout (síncrono con el pintado), no en uno pasivo, que podría llegar después de un clic.
  const tasksRef = useRef(tasks);
  const afterWriteRef = useRef(afterWrite);
  useLayoutEffect(() => {
    tasksRef.current = tasks;
    afterWriteRef.current = afterWrite;
  });

  const registerToggle = useCallback((id: string, element: HTMLButtonElement | null) => {
    if (element === null) {
      toggleButtons.current.delete(id);
    } else {
      toggleButtons.current.set(id, element);
    }
  }, []);

  // El guardia (`inFlight.has`) lo comprueba quien llama, antes de cualquier pregunta al usuario.
  const run = useCallback(
    async (id: string, request: () => Promise<WriteResult>) => {
      inFlight.current.add(id);
      const index = tasksRef.current.findIndex((candidate) => candidate.id === id);
      focusIntent.current = {
        id,
        nextId: tasksRef.current[index + 1]?.id,
        prevId: tasksRef.current[index - 1]?.id,
        armed: false,
      };
      dispatch({ type: 'noticeCleared' });
      dispatch({ type: 'taskErrorCleared', id });
      dispatch({ type: 'busyAdd', id });
      const result = await request();
      inFlight.current.delete(id);
      dispatch({ type: 'busyRemove', id });
      const mine = focusIntent.current?.id === id ? focusIntent.current : undefined;
      if (result.kind === 'ok' || result.kind === 'not_found') {
        if (result.kind === 'ok') {
          dispatch({ type: 'noticeSet', notice: UPDATED_NOTICE });
        } else {
          dispatch({ type: 'taskGone', id });
          dispatch({ type: 'noticeSet', notice: GONE_NOTICE });
        }
        if (mine) {
          mine.armed = true;
        }
        afterWriteRef.current();
        return;
      }
      if (mine) {
        focusIntent.current = undefined;
      }
      dispatch({ type: 'taskErrorSet', id, message: result.message });
    },
    [dispatch],
  );

  const toggle = useCallback(
    (task: Task) => {
      if (!inFlight.current.has(task.id)) {
        void run(task.id, () => updateTask(task.id, { completed: !task.completed }));
      }
    },
    [run],
  );

  // El guardia va antes del `confirm`: un segundo clic con la petición en curso no vuelve a preguntar.
  const remove = useCallback(
    (task: Task) => {
      if (!inFlight.current.has(task.id) && window.confirm(`¿Eliminar «${task.title}»? No se puede deshacer.`)) {
        void run(task.id, () => deleteTask(task.id));
      }
    },
    [run],
  );

  // Tras pintar la lista nueva: el foco va a la tarjeta que ocupa el lugar de la que desapareció (o se queda).
  useEffect(() => {
    const intent = focusIntent.current;
    if (intent === undefined || !intent.armed || status !== 'ready') {
      return;
    }
    focusIntent.current = undefined;
    const active = document.activeElement;
    const owner = active?.closest('[data-task-id]')?.getAttribute('data-task-id');
    // Si la persona ya fue a otro sitio (otro campo), no se le quita el foco.
    if (active !== null && active !== document.body && owner !== intent.id) {
      return;
    }
    const present = new Set(tasks.map((task) => task.id));
    const target = [intent.id, intent.nextId, intent.prevId].find((id) => id !== undefined && present.has(id));
    (target === undefined ? headingRef.current : toggleButtons.current.get(target))?.focus();
  }, [tasks, status]);

  return { toggle, remove, registerToggle, headingRef };
}
