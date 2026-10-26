/**
 * Validación de título y descripción en el navegador. Mismas reglas que Express (recorte con `trim()`, longitud en
 * puntos de código, sin NUL ni sustitutos sueltos), pero solo es una comodidad: la autoridad es Express.
 * Limitación: un emoji compuesto (con ZWJ) cuenta varios puntos de código, igual que en Express.
 */
export type TextResult = { ok: true; value: string } | { ok: false; message: string };

const MAX_TITLE = 100;
const MAX_DESCRIPTION = 500;
const FORBIDDEN_MESSAGE = 'Contiene caracteres no permitidos.';
const TITLE_LENGTH_MESSAGE = `Debe tener entre 1 y ${MAX_TITLE} caracteres.`;
const DESCRIPTION_LENGTH_MESSAGE = `Debe tener como máximo ${MAX_DESCRIPTION} caracteres.`;
const SURROGATE = /\p{Surrogate}/u;

export function trimText(text: string): string {
  return text.trim();
}

export function countCodePoints(text: string): number {
  return Array.from(text).length;
}

/** Recorta, comprueba los caracteres y después la longitud (el mismo orden que Express). */
function validate(raw: string, lengthProblem: (count: number) => string | undefined): TextResult {
  const value = trimText(raw);
  if (value.includes('\u0000') || SURROGATE.test(value)) {
    return { ok: false, message: FORBIDDEN_MESSAGE };
  }
  const message = lengthProblem(countCodePoints(value));
  return message === undefined ? { ok: true, value } : { ok: false, message };
}

export function validateTitle(raw: string): TextResult {
  return validate(raw, (count) => (count < 1 || count > MAX_TITLE ? TITLE_LENGTH_MESSAGE : undefined));
}

export function validateDescription(raw: string): TextResult {
  return validate(raw, (count) => (count > MAX_DESCRIPTION ? DESCRIPTION_LENGTH_MESSAGE : undefined));
}
