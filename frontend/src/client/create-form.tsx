'use client';

import { useRef, useState, type FormEvent } from 'react';
import { POST_UNCONFIRMED_MESSAGE } from '../lib/api-error';
import { validateDescription, validateTitle } from '../lib/task-text';
import { createTask, type WriteResult } from './tasks-api';
import { TextField } from './text-field';

interface CreateFormProps {
  /** Se llama al empezar un envío válido (el padre borra el aviso anterior). */
  onStart: () => void;
  /** Se llama cuando el servidor confirma la creación (el padre avisa y refresca lista y contadores). */
  onCreated: () => void;
}

interface FormErrors {
  title?: string;
  description?: string;
  general?: string;
}

type Field = HTMLInputElement | HTMLTextAreaElement | null;

/** Errores de un 400: `title` y `description` junto a su campo; cualquier otro `field` va al mensaje general. */
function fromInvalid(result: Extract<WriteResult, { kind: 'invalid' }>): FormErrors {
  const { details, message } = result;
  const known = ['title', 'description'];
  const hasOther = details.length === 0 || details.some((detail) => !known.includes(detail.field));
  return {
    title: details.find((detail) => detail.field === 'title')?.message,
    description: details.find((detail) => detail.field === 'description')?.message,
    general: hasOther ? message : undefined,
  };
}

export function CreateForm({ onStart, onCreated }: CreateFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  // Guardia síncrono: se escribe antes de que React repinte, así un segundo clic o Enter no envía otra petición.
  const inFlight = useRef(false);
  const titleField = useRef<Field>(null);
  const descriptionField = useRef<Field>(null);

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
      setTitle('');
      setDescription('');
      titleField.current?.focus();
      onCreated();
    } else if (result.kind === 'invalid') {
      setErrors(fromInvalid(result));
    } else {
      setErrors({ general: result.kind === 'error' ? result.message : POST_UNCONFIRMED_MESSAGE });
    }
  }

  return (
    <form
      aria-label="Nueva tarea"
      noValidate
      className="mb-6 flex flex-col gap-3"
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
      <button
        type="submit"
        aria-disabled={busy}
        className="min-h-11 min-w-11 self-start rounded border px-4 py-2 aria-disabled:opacity-60"
      >
        Crear tarea
      </button>
      {errors.general === undefined ? null : (
        <p role="alert" className="text-sm text-red-700">
          {errors.general}
        </p>
      )}
    </form>
  );
}
