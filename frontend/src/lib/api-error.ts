export interface ErrorDetail {
  field: string;
  message: string;
}

export interface ErrorBody {
  message: string | undefined;
  details: ErrorDetail[];
}

// Mismos literales que `NO_CONNECTION` y `POST_UNCONFIRMED` de `src/server/proxy/response-mapper.ts`. Se duplican a
// propósito: el código del navegador no puede importar el del servidor.
export const NO_CONNECTION_MESSAGE = 'No se pudo conectar con el servicio. Inténtalo más tarde.';
export const POST_UNCONFIRMED_MESSAGE =
  'No se pudo confirmar si la tarea se creó. Revisa la lista antes de volver a enviarla.';

/** Lista cerrada de códigos cuyo `message` se muestra tal cual. Cualquier otro (o un 405) usa el mensaje propio. */
const ERROR_CODES: readonly string[] = [
  'VALIDATION_ERROR',
  'BAD_REQUEST',
  'FORBIDDEN',
  'NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'TOO_MANY_REQUESTS',
  'UNSUPPORTED_MEDIA_TYPE',
  'REQUEST_TIMEOUT',
  'BAD_GATEWAY',
  'GATEWAY_TIMEOUT',
  'INTERNAL_ERROR',
];
const MAX_MESSAGE = 200;

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_MESSAGE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toDetail(value: unknown): ErrorDetail[] {
  return isRecord(value) && typeof value['field'] === 'string' && isText(value['message'])
    ? [{ field: value['field'], message: value['message'] }]
    : [];
}

/** Lee `{ error: { code, message, details } }` sin fiarse de su forma; lo que no encaja se descarta. */
export function readErrorBody(json: unknown): ErrorBody {
  const error = isRecord(json) ? json['error'] : undefined;
  if (!isRecord(error) || typeof error['code'] !== 'string' || !ERROR_CODES.includes(error['code'])) {
    return { message: undefined, details: [] };
  }
  const details = error['code'] === 'VALIDATION_ERROR' && Array.isArray(error['details']) ? error['details'] : [];
  return {
    message: isText(error['message']) ? error['message'] : undefined,
    details: details.flatMap(toDetail),
  };
}

/** Mensaje cuando no hay uno del servidor: el de un POST avisa de que quizá sí se creó. */
export function ownMessage(method: string): string {
  return method === 'POST' ? POST_UNCONFIRMED_MESSAGE : NO_CONNECTION_MESSAGE;
}
