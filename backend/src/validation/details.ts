import type { ErrorDetail } from '../http/http-error';
import type { TextProblem } from './text-fields';

/** Problemas reunidos por la tubería; cada clave ausente significa «sin problema». */
export interface DetailProblems {
  readonly body?: 'invalid' | 'unknownFields' | 'noBodyAllowed' | 'lengthMismatch';
  readonly query?: boolean;
  readonly title?: TextProblem;
  readonly description?: TextProblem;
  readonly completed?: boolean;
}

const BODY_MESSAGES = {
  invalid: 'El cuerpo debe ser un objeto JSON válido.',
  unknownFields: 'El cuerpo contiene campos no permitidos.',
  noBodyAllowed: 'Esta ruta no admite cuerpo.',
  lengthMismatch: 'El cuerpo no coincide con la longitud declarada.',
} as const;

const QUERY_MESSAGE = 'Parámetros de consulta no permitidos.';
const COMPLETED_MESSAGE = 'Debe ser true o false.';

const TITLE_MESSAGES = {
  type: 'Debe ser una cadena de texto.',
  characters: 'Contiene caracteres no permitidos.',
  length: 'Debe tener entre 1 y 100 caracteres.',
} as const;

const DESCRIPTION_MESSAGES = {
  type: 'Debe ser una cadena de texto.',
  characters: 'Contiene caracteres no permitidos.',
  length: 'Debe tener como máximo 500 caracteres.',
} as const;

/**
 * Ensambla `details` de un 400 con los mensajes literales del contrato, en el orden `body, query, title,
 * description, completed`: una entrada por campo con su primer problema. Nunca refleja valores ni nombres enviados.
 */
export function buildDetails(problems: DetailProblems): ErrorDetail[] {
  const details: ErrorDetail[] = [];
  if (problems.body !== undefined) {
    details.push({ field: 'body', message: BODY_MESSAGES[problems.body] });
  }
  if (problems.query === true) {
    details.push({ field: 'query', message: QUERY_MESSAGE });
  }
  if (problems.title !== undefined) {
    details.push({ field: 'title', message: TITLE_MESSAGES[problems.title] });
  }
  if (problems.description !== undefined) {
    details.push({ field: 'description', message: DESCRIPTION_MESSAGES[problems.description] });
  }
  if (problems.completed === true) {
    details.push({ field: 'completed', message: COMPLETED_MESSAGE });
  }
  return details;
}
