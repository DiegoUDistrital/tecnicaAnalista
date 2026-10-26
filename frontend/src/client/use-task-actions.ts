'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type Dispatch } from 'react';
import type { Task } from '../lib/task';
import { changedFields } from '../lib/task-edit';
import { validateDescription, validateTitle } from '../lib/task-text';
import type { Editing, UiAction } from '../lib/task-ui-state';
import type { EditableField, EditActions } from './edit-form';
import { fromInvalid } from './form-errors';
import type { TaskList } from './use-task-list';
import { deleteTask, updateTask, type WriteResult } from './tasks-api';

export const GONE_NOTICE = 'La tarea ya no existe.';
export const UPDATED_NOTICE = 'Lista actualizada.';

/** Qué hacer con el foco cuando llegue la lista nueva: los vecinos se guardan antes de que la tarjeta desaparezca. */
interface FocusIntent {
  id: string;
  nextId: string | undefined;
  prevId: string | undefined;
  /** Qué botón recupera el foco si la tarea sigue en la lista: el de completar o el de editar (al guardar). */
  target: 'toggle' | 'edit';
  /** Solo se atiende cuando la escritura terminó bien (o con 404): si falla no hay lista nueva que esperar. */
  armed: boolean;
}

interface Params {
  tasks: Task[];
  status: TaskList['status'];
  dispatch: Dispatch<UiAction>;
  /** La edición abierta (una sola a la vez); la guarda el padre para que sobreviva a los refrescos. */
  editing: Editing | undefined;
  /** Vuelve a pedir la lista y los contadores tras una escritura (RF-F15). */
  afterWrite: () => void;
}

interface RunOptions {
  target?: FocusIntent['target'];
  /** Qué hacer además del aviso cuando la escritura termina bien. */
  onOk?: () => void;
  /** Si se da, un 400 se resuelve aquí (junto a los campos) en lugar de como error de la tarjeta. */
  onInvalid?: (result: Extract<WriteResult, { kind: 'invalid' }>) => void;
}

type Field = HTMLInputElement | HTMLTextAreaElement;

/** El foco se puede mover si está en ningún sitio o dentro de la tarjeta: si la persona fue a otro campo, no. */
function focusIsFree(id: string): boolean {
  const active = document.activeElement;
  const owner = active?.closest('[data-task-id]')?.getAttribute('data-task-id');
  return active === null || active === document.body || owner === id;
}

/**
 * Acciones sobre una tarea que ya existe. Todas pasan por el mismo camino: un guardia síncrono por id (una marca que
 * se escribe antes de que React repinte, así un segundo clic no envía otra petición), el error junto a la tarea, el
 * 404 como aviso global y el foco hacia la tarjeta vecina cuando la tarea desaparece.
 */
export function useTaskActions({ tasks, status, dispatch, editing, afterWrite }: Params) {
  const inFlight = useRef(new Set<string>());
  const focusIntent = useRef<FocusIntent>(undefined);
  const toggleButtons = useRef(new Map<string, HTMLButtonElement>());
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const editFields = useRef(new Map<string, Field>());
  /** Tarea cuyo título recibe el foco cuando su formulario aparezca (solo al abrirla, no al volver a pintarla). */
  const titleFocusFor = useRef<string>(undefined);
  const editButtonFocusFor = useRef<string>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Las acciones leen siempre lo último sin cambiar de identidad (así las tarjetas memorizadas no se repintan). Se
  // actualiza en el efecto de layout (síncrono con el pintado), no en uno pasivo, que podría llegar después de un clic.
  const tasksRef = useRef(tasks);
  const editingRef = useRef(editing);
  const afterWriteRef = useRef(afterWrite);
  useLayoutEffect(() => {
    tasksRef.current = tasks;
    editingRef.current = editing;
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
    async (id: string, request: () => Promise<WriteResult>, options: RunOptions = {}) => {
      inFlight.current.add(id);
      const index = tasksRef.current.findIndex((candidate) => candidate.id === id);
      focusIntent.current = {
        id,
        nextId: tasksRef.current[index + 1]?.id,
        prevId: tasksRef.current[index - 1]?.id,
        target: options.target ?? 'toggle',
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
          options.onOk?.();
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
      if (result.kind === 'invalid' && options.onInvalid) {
        options.onInvalid(result);
        return;
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

  const registerEditButton = useCallback((id: string, element: HTMLButtonElement | null) => {
    if (element === null) {
      editButtons.current.delete(id);
    } else {
      editButtons.current.set(id, element);
    }
  }, []);

  const registerField = useCallback((id: string, field: EditableField, element: Field | null) => {
    if (element === null) {
      editFields.current.delete(`${id}:${field}`);
    } else {
      editFields.current.set(`${id}:${field}`, element);
    }
  }, []);

  // Salir de la edición (Cancelar, Escape, guardar o no tener cambios): el foco vuelve al botón «Editar» de la tarea.
  // Durante la edición ese botón no está en pantalla (RF-V10): el foco se pide aquí y se da cuando reaparece.
  const leaveEdit = useCallback(
    (id: string) => {
      dispatch({ type: 'editClose', id });
      if (focusIsFree(id)) {
        editButtonFocusFor.current = id;
      }
    },
    [dispatch],
  );

  // Una sola edición a la vez: abrir otra con cambios sin guardar pide confirmación (misma comparación que al guardar).
  const open = useCallback(
    (task: Task) => {
      const current = editingRef.current;
      const original = current && tasksRef.current.find((candidate) => candidate.id === current.id);
      if (
        original &&
        Object.keys(changedFields(original, current)).length > 0 &&
        !window.confirm(`Hay cambios sin guardar en «${original.title}». ¿Descartarlos?`)
      ) {
        return;
      }
      titleFocusFor.current = task.id;
      dispatch({ type: 'editOpen', id: task.id, title: task.title, description: task.description });
    },
    [dispatch],
  );

  const change = useCallback(
    (id: string, field: EditableField, value: string) => dispatch({ type: 'editChange', id, field, value }),
    [dispatch],
  );

  const save = useCallback(
    (task: Task) => {
      const draft = editingRef.current;
      if (draft?.id !== task.id || inFlight.current.has(task.id)) {
        return;
      }
      const title = validateTitle(draft.title);
      const description = validateDescription(draft.description);
      if (!title.ok || !description.ok) {
        const errors = {
          title: title.ok ? undefined : title.message,
          description: description.ok ? undefined : description.message,
        };
        dispatch({ type: 'editErrors', id: task.id, errors });
        editFields.current.get(`${task.id}:${title.ok ? 'description' : 'title'}`)?.focus();
        return;
      }
      // Solo viaja lo que cambió; si no cambió nada (o solo espacios) no hay petición y se sale de la edición.
      const changes = changedFields(task, draft);
      if (Object.keys(changes).length === 0) {
        leaveEdit(task.id);
        return;
      }
      dispatch({ type: 'editErrors', id: task.id, errors: {} });
      void run(task.id, () => updateTask(task.id, changes), {
        target: 'edit',
        onOk: () => leaveEdit(task.id),
        onInvalid: (result) => dispatch({ type: 'editErrors', id: task.id, errors: fromInvalid(result) }),
      });
    },
    [dispatch, leaveEdit, run],
  );

  const editActions = useMemo<EditActions>(
    () => ({ open, change, save, cancel: leaveEdit, registerButton: registerEditButton, registerField }),
    [open, change, save, leaveEdit, registerEditButton, registerField],
  );

  // Al abrir la edición de una tarea el foco va a su título, cuando el formulario ya está pintado.
  const editingId = editing?.id;
  useEffect(() => {
    if (editingId !== undefined && titleFocusFor.current === editingId) {
      titleFocusFor.current = undefined;
      editFields.current.get(`${editingId}:title`)?.focus();
    }
  }, [editingId]);

  useEffect(() => {
    const id = editButtonFocusFor.current;
    editButtonFocusFor.current = undefined;
    if (id !== undefined && editingId !== id) {
      editButtons.current.get(id)?.focus();
    }
  }, [editingId]);

  // Tras pintar la lista nueva: el foco va a la tarjeta que ocupa el lugar de la que desapareció (o se queda).
  useEffect(() => {
    const intent = focusIntent.current;
    if (intent === undefined || !intent.armed || status !== 'ready') {
      return;
    }
    focusIntent.current = undefined;
    // Si la persona ya fue a otro sitio (otro campo), no se le quita el foco.
    if (!focusIsFree(intent.id)) {
      return;
    }
    const present = new Set(tasks.map((task) => task.id));
    const target = [intent.id, intent.nextId, intent.prevId].find((id) => id !== undefined && present.has(id));
    if (target === undefined) {
      headingRef.current?.focus();
    } else {
      (target === intent.id && intent.target === 'edit' ? editButtons : toggleButtons).current.get(target)?.focus();
    }
  }, [tasks, status]);

  return { toggle, remove, registerToggle, headingRef, editActions };
}
