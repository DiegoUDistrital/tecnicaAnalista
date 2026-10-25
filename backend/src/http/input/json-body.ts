import { isUtf8 } from 'node:buffer';
import { buildDetails, type DetailProblems } from '../../validation/details';
import { HttpError } from '../http-error';

/** Objeto JSON ya interpretado (raíz del cuerpo). */
export type JsonObject = Record<string, unknown>;

/** Si la ruta exige un cuerpo JSON (`required`: POST y PUT) o no admite ninguno (`none`: GET y DELETE). */
export type BodyMode = 'none' | 'required';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function bodyError(problem: NonNullable<DetailProblems['body']>): HttpError {
  return new HttpError(400, buildDetails({ body: problem }));
}

/**
 * Etapa 4 (subcomprobaciones b a f) de la entrada: convierte los bytes del cuerpo en un objeto JSON. El primer
 * fallo gana, en este orden: (b) cuerpo no vacío en una ruta sin cuerpo (sea o no UTF-8 válido), (c) cuerpo vacío,
 * (d) UTF-8 mal formado o BOM, (e) JSON mal formado, (f) raíz que no es un objeto. Un byte que no forma UTF-8 NUNCA se
 * sustituye (se guardarían datos distintos de los enviados). Con claves repetidas gana la última (`JSON.parse`).
 * Devuelve `undefined` en una ruta sin cuerpo.
 */
export function parseJsonBody(bytes: Buffer, bodyMode: BodyMode): JsonObject | undefined {
  if (bodyMode === 'none') {
    if (bytes.length > 0) {
      throw bodyError('noBodyAllowed');
    }
    return undefined;
  }
  if (bytes.length === 0 || !isUtf8(bytes) || bytes.subarray(0, BOM.length).equals(BOM)) {
    throw bodyError('invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw bodyError('invalid');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw bodyError('invalid');
  }
  return parsed as JsonObject;
}
