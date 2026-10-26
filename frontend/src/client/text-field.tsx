'use client';

import { useId } from 'react';
import { countCodePoints, trimText } from '../lib/task-text';

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Mensaje junto al campo (de la validación del cliente o del servidor). */
  error: string | undefined;
  /** Máximo que muestra el contador (`n/max`). No se usa `maxLength`: contaría unidades UTF-16, no caracteres. */
  max: number;
  multiline?: boolean;
  /** El padre guarda el elemento para llevarle el foco (callback para valer a `input` y a `textarea`). */
  inputRef: (element: HTMLInputElement | HTMLTextAreaElement | null) => void;
}

const FIELD_CLASS = 'min-h-11 w-full rounded border p-2';

/** Campo con etiqueta visible, contador sobre el texto recortado y error asociado con `aria-describedby`. */
export function TextField({ label, value, onChange, error, max, multiline = false, inputRef }: TextFieldProps) {
  const id = useId();
  const counterId = `${id}-counter`;
  const errorId = `${id}-error`;
  const common = {
    id,
    value,
    ref: inputRef,
    className: FIELD_CLASS,
    'aria-invalid': error === undefined ? undefined : true,
    'aria-describedby': error === undefined ? counterId : `${counterId} ${errorId}`,
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {multiline ? (
        <textarea {...common} rows={3} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input {...common} type="text" onChange={(event) => onChange(event.target.value)} />
      )}
      <span id={counterId} className="text-xs text-gray-600">
        {`${countCodePoints(trimText(value))}/${max}`}
      </span>
      {error === undefined ? null : (
        <p id={errorId} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
