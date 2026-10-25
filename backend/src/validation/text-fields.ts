/** Primer problema de un campo de texto, en el orden de comprobación: tipo, caracteres, longitud. */
export type TextProblem = 'type' | 'characters' | 'length';

export type TextResult = { ok: true; value: string } | { ok: false; problem: TextProblem };

interface TextRule {
  readonly min: number;
  readonly max: number;
}

const TITLE_RULE: TextRule = { min: 1, max: 100 };
const DESCRIPTION_RULE: TextRule = { min: 0, max: 500 };

/** Sustituto UTF-16 suelto: con la bandera `u` un par válido es un solo punto de código y no coincide. */
const LONE_SURROGATE = /\p{Surrogate}/u;

/**
 * Valida un texto: recorta los espacios de los extremos con `trim()` (el conjunto de espacios de la spec), rechaza
 * NUL y sustitutos sueltos, y mide la longitud en puntos de código tras recortar. Devuelve el valor recortado.
 */
function validateText(value: unknown, rule: TextRule): TextResult {
  if (typeof value !== 'string') {
    return { ok: false, problem: 'type' };
  }
  const trimmed = value.trim();
  if (trimmed.includes('\u0000') || LONE_SURROGATE.test(trimmed)) {
    return { ok: false, problem: 'characters' };
  }
  const length = Array.from(trimmed).length;
  if (length < rule.min || length > rule.max) {
    return { ok: false, problem: 'length' };
  }
  return { ok: true, value: trimmed };
}

/** `title`: obligatorio, de 1 a 100 caracteres. */
export function validateTitle(value: unknown): TextResult {
  return validateText(value, TITLE_RULE);
}

/** `description`: de 0 a 500 caracteres (la ausencia se resuelve fuera, con cadena vacía). */
export function validateDescription(value: unknown): TextResult {
  return validateText(value, DESCRIPTION_RULE);
}
