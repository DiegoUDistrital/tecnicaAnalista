'use client';

import type { FormEvent, KeyboardEvent } from 'react';
import type { Task } from '../lib/task';
import type { Editing } from '../lib/task-ui-state';
import { BTN_PRIMARY, BTN_SECONDARY } from '../lib/ui-classes';
import { PlusIcon, XIcon } from './icons';
import { TextField } from './text-field';

export type EditableField = 'title' | 'description';

/** Todo lo que la tarjeta puede hacer con la edición. El objeto es estable: la tarjeta memorizada no se repinta. */
export interface EditActions {
  open: (task: Task) => void;
  change: (id: string, field: EditableField, value: string) => void;
  save: (task: Task) => void;
  cancel: (id: string) => void;
  /** El padre guarda el botón «Editar» y los campos de cada tarea para llevarles el foco. */
  registerButton: (id: string, element: HTMLButtonElement | null) => void;
  registerField: (id: string, field: EditableField, element: HTMLInputElement | HTMLTextAreaElement | null) => void;
}

interface EditFormProps {
  task: Task;
  /** Borrador de esta tarea: vive en el padre para sobrevivir a los refrescos y a los cambios de filtro. */
  draft: Editing;
  busy: boolean;
  actions: EditActions;
}

/** Formulario de edición dentro de la tarjeta. Los campos son los mismos que los de crear (`TextField`). */
export function EditForm({ task, draft, busy, actions }: EditFormProps) {
  function submit(event: FormEvent) {
    event.preventDefault();
    actions.save(task);
  }

  function keyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      actions.cancel(task.id);
    }
  }

  return (
    <form
      aria-label={`Editar «${task.title}»`}
      noValidate
      className="flex flex-col gap-3"
      onSubmit={submit}
      onKeyDown={keyDown}
    >
      <TextField
        label="Título"
        value={draft.title}
        onChange={(value) => actions.change(task.id, 'title', value)}
        error={draft.errors.title}
        max={100}
        inputRef={(element) => actions.registerField(task.id, 'title', element)}
      />
      <TextField
        label="Descripción"
        value={draft.description}
        onChange={(value) => actions.change(task.id, 'description', value)}
        error={draft.errors.description}
        max={500}
        multiline
        inputRef={(element) => actions.registerField(task.id, 'description', element)}
      />
      <div className="flex flex-wrap gap-2">
        <button type="submit" aria-disabled={busy} className={BTN_PRIMARY}>
          <PlusIcon />
          Guardar
        </button>
        <button type="button" onClick={() => actions.cancel(task.id)} className={BTN_SECONDARY}>
          <XIcon />
          Cancelar
        </button>
      </div>
      {draft.errors.general === undefined ? null : (
        <p role="alert" className="text-sm text-red-800">
          {draft.errors.general}
        </p>
      )}
    </form>
  );
}
