'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { validateDescription, validateTitle } from '../lib/task-text';
import { fromInvalid, type FormErrors } from './form-errors';
import { BTN_PRIMARY, BTN_SECONDARY } from '../lib/ui-classes';
import { PlusIcon } from './icons';
import { createTask } from './tasks-api';
import { TextField } from './text-field';

interface CreateFormProps {
  /** Se llama al empezar un envío válido (el padre borra el aviso anterior). */
  onStart: () => void;
  /** Se llama cuando el servidor confirma la creación (el padre avisa y refresca lista y contadores). */
  onCreated: () => void;
  /** Se llama al pulsar «Cancelar» (el padre cierra el panel sin enviar nada). */
  onCancel: () => void;
}

type Field = HTMLInputElement | HTMLTextAreaElement | null;

export function CreateForm({ onStart, onCreated, onCancel }: CreateFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  // Guardia síncrono: se escribe antes de que React repinte, así un segundo clic o Enter no envía otra petición.
  const inFlight = useRef(false);
  const titleField = useRef<Field>(null);
  const descriptionField = useRef<Field>(null);

  // El formulario solo existe con el panel abierto: al montarse, el foco pasa al título.
  useEffect(() => {
    titleField.current?.focus();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) {
      return;
    }
    const checkedTitle = validateTitle(title);
    const checkedDescription = validateDescription(description);
    if (!checkedTitle.ok || !checkedDescription.ok) {
      setErrors({
        title: checkedTitle.ok ? undefined : checkedTitle.message,
        description: checkedDescription.ok ? undefined : checkedDescription.message,
      });
      (checkedTitle.ok ? descriptionField : titleField).current?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setErrors({});
    onStart();
    const result = await createTask({ title: checkedTitle.value, description: checkedDescription.value });
    inFlight.current = false;
    setBusy(false);
    if (result.kind === 'ok') {
      // El padre cierra el panel (este formulario se desmonta y su borrador desaparece) y devuelve el foco al botón.
      onCreated();
    } else if (result.kind === 'invalid') {
      setErrors(fromInvalid(result));
    } else {
      setErrors({ general: result.message });
    }
  }

  return (
    <form
      aria-label="Nueva tarea"
      noValidate
      className="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <TextField
        label="Título"
        value={title}
        onChange={setTitle}
        error={errors.title}
        max={100}
        inputRef={(element) => {
          titleField.current = element;
        }}
      />
      <TextField
        label="Descripción"
        value={description}
        onChange={setDescription}
        error={errors.description}
        max={500}
        multiline
        inputRef={(element) => {
          descriptionField.current = element;
        }}
      />
      <div className="flex flex-wrap gap-2">
        <button type="submit" aria-disabled={busy} className={BTN_PRIMARY}>
          <PlusIcon />
          Crear tarea
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={onCancel}>
          Cancelar
        </button>
      </div>
      {errors.general === undefined ? null : (
        <p role="alert" className="text-sm text-red-800">
          {errors.general}
        </p>
      )}
    </form>
  );
}
