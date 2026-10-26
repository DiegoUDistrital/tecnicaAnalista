'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Task } from '../lib/task';
import type { TaskFilter } from '../lib/task-filter';
import { fetchTasks } from './tasks-api';

export type LoadMode = 'initial' | 'background';

export interface TaskList {
  tasks: Task[];
  status: 'loading' | 'ready' | 'error';
  /** Mensaje de la carga inicial fallida (solo con `status === 'error'`). */
  loadError: string | undefined;
  /** Mensaje de un refresco en segundo plano fallido (la lista anterior sigue visible). */
  refreshError: string | undefined;
  /** Peticiones de lista en curso, incluidos los refrescos en segundo plano. */
  pending: number;
  reload: (mode: LoadMode) => void;
}

const REFRESH_FAILED = 'No se pudo actualizar la lista.';

/**
 * Carga la lista del filtro recibido. Cada petición lleva un número y su propio AbortController: solo la última
 * puede cambiar el estado, así una respuesta lenta del filtro anterior nunca pisa a la nueva.
 */
export function useTaskList(filter: TaskFilter): TaskList {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState<TaskList['status']>('loading');
  const [loadError, setLoadError] = useState<string>();
  const [refreshError, setRefreshError] = useState<string>();
  const [pending, setPending] = useState(0);

  const filterRef = useRef(filter);
  const sequence = useRef(0);
  const controller = useRef<AbortController>(undefined);
  // Filtro de la lista que se está mostrando; `undefined` si no hay ninguna (cargando o con error).
  const shownFilter = useRef<TaskFilter>(undefined);

  const load = useCallback(async (mode: LoadMode) => {
    const requested = filterRef.current;
    const effectiveMode = shownFilter.current === requested ? mode : 'initial';
    const id = ++sequence.current;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    if (effectiveMode === 'initial') {
      shownFilter.current = undefined;
      setTasks([]);
      setStatus('loading');
      setLoadError(undefined);
    }
    setPending((count) => count + 1);
    const result = await fetchTasks(requested, current.signal);
    setPending((count) => count - 1);
    if (id !== sequence.current || result.kind === 'aborted') {
      return;
    }
    if (result.kind === 'ok') {
      shownFilter.current = requested;
      setTasks(result.tasks);
      setStatus('ready');
      setRefreshError(undefined);
    } else if (effectiveMode === 'initial') {
      setStatus('error');
      setLoadError(result.message);
    } else {
      setRefreshError(REFRESH_FAILED);
    }
  }, []);

  useEffect(() => {
    filterRef.current = filter;
    void load('initial');
    return () => controller.current?.abort();
  }, [filter, load]);

  const reload = useCallback((mode: LoadMode) => void load(mode), [load]);

  return { tasks, status, loadError, refreshError, pending, reload };
}
