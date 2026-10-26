import type { WriteResult } from './tasks-api';

export interface FormErrors {
  title?: string;
  description?: string;
  general?: string;
}

/** Errores de un 400: `title` y `description` junto a su campo; cualquier otro `field` va al mensaje general. */
export function fromInvalid(result: Extract<WriteResult, { kind: 'invalid' }>): FormErrors {
  const { details, message } = result;
  const known = ['title', 'description'];
  const hasOther = details.length === 0 || details.some((detail) => !known.includes(detail.field));
  return {
    title: details.find((detail) => detail.field === 'title')?.message,
    description: details.find((detail) => detail.field === 'description')?.message,
    general: hasOther ? message : undefined,
  };
}
