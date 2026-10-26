import 'server-only';
import type { BackendMethod, BackendResult } from './backend-client';
import { describeRetryAfter } from './retry-after';
import { errorResponse, jsonResponse, emptyResponse, UNAVAILABLE_MESSAGE, type Detail } from './responses';
import { toTask } from './task-shape';

const NO_CONNECTION = 'No se pudo conectar con el servicio. Inténtalo más tarde.';
const POST_UNCONFIRMED = 'No se pudo confirmar si la tarea se creó. Revisa la lista antes de volver a enviarla.';
const UNKNOWN_VALUE = 'Valor no válido.';

/**
 * Mensajes de `details` que se aceptan de Express, por campo: copia de `backend/src/validation/details.ts` (no se
 * importa código del backend). Cualquier otro texto se sustituye, para no reenviar nunca texto libre de Express.
 */
const BODY_MESSAGES = [
  'El cuerpo debe ser un objeto JSON válido.',
  'El cuerpo contiene campos no permitidos.',
  'Debe enviar al menos title, description o completed.',
  'Esta ruta no admite cuerpo.',
  'El cuerpo no coincide con la longitud declarada.',
];
const STRING_FIELD_MESSAGES = ['Debe ser una cadena de texto.', 'Contiene caracteres no permitidos.'];
const KNOWN_MESSAGES: Readonly<Record<string, readonly string[]>> = {
  body: BODY_MESSAGES,
  query: ['Parámetros de consulta no permitidos.'],
  id: ['El identificador no es un UUID válido.'],
  title: [...STRING_FIELD_MESSAGES, 'Debe tener entre 1 y 100 caracteres.'],
  description: [...STRING_FIELD_MESSAGES, 'Debe tener como máximo 500 caracteres.'],
  completed: ['Debe ser true o false.'],
};

/** Error 502/504: en un `POST` la tarea PUDO crearse aunque no llegara la respuesta (sin idempotencia). */
function gatewayError(status: 502 | 504, method: BackendMethod, message: string): Response {
  const code = status === 502 ? 'BAD_GATEWAY' : 'GATEWAY_TIMEOUT';
  return errorResponse(status, code, method === 'POST' ? POST_UNCONFIRMED : message);
}

/** Filtra los `details` de Express: solo campos conocidos; mensaje fuera de la lista = «Valor no válido.». */
function safeDetails(body: unknown): Detail[] {
  const error = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  const raw = typeof error === 'object' && error !== null ? (error as { code?: unknown; details?: unknown }) : {};
  if (raw.code !== 'VALIDATION_ERROR' || !Array.isArray(raw.details)) {
    return [];
  }
  const details: Detail[] = [];
  for (const entry of raw.details as unknown[]) {
    const { field, message } = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    if (typeof field === 'string' && Object.hasOwn(KNOWN_MESSAGES, field)) {
      const known = typeof message === 'string' && KNOWN_MESSAGES[field]?.includes(message) === true;
      details.push({ field, message: known ? message : UNKNOWN_VALUE });
    }
  }
  return details;
}

function mapSuccess(body: unknown, method: BackendMethod): Response {
  if (method === 'DELETE') {
    return body === undefined ? emptyResponse(204) : gatewayError(502, method, UNAVAILABLE_MESSAGE);
  }
  if (method === 'GET') {
    const tasks = Array.isArray(body) ? (body as unknown[]).map(toTask) : undefined;
    return tasks?.every((task) => task !== undefined) === true
      ? jsonResponse(200, tasks)
      : gatewayError(502, method, UNAVAILABLE_MESSAGE);
  }
  const task = toTask(body);
  return task === undefined
    ? gatewayError(502, method, UNAVAILABLE_MESSAGE)
    : jsonResponse(method === 'POST' ? 201 : 200, task);
}

/**
 * Traduce el resultado del reenvío a la respuesta del navegador (RF-F20), siempre desde tablas cerradas: nunca copia
 * texto ni cabeceras de Express. Todo lo que no es una fila de la tabla es 502 con el mensaje fijo.
 */
export function mapResult(result: BackendResult, method: BackendMethod): Response {
  switch (result.kind) {
    case 'ok':
      return mapSuccess(result.body, method);
    case 'validation': {
      const details = safeDetails(result.body);
      return details.length === 0
        ? gatewayError(502, method, UNAVAILABLE_MESSAGE)
        : errorResponse(400, 'VALIDATION_ERROR', 'Datos inválidos.', details);
    }
    case 'rate_limited': {
      const { message, retryAfter } = describeRetryAfter(result.retryAfter);
      return errorResponse(
        429,
        'TOO_MANY_REQUESTS',
        message,
        [],
        retryAfter === undefined ? {} : { 'Retry-After': retryAfter },
      );
    }
    case 'not_found':
      return errorResponse(404, 'NOT_FOUND', 'La tarea ya no existe.');
    case 'too_large':
      return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'El texto es demasiado largo.');
    case 'timeout':
      return gatewayError(504, method, NO_CONNECTION);
    case 'unreachable':
      return gatewayError(502, method, NO_CONNECTION);
    case 'invalid':
    case 'unexpected':
    case 'cancelled':
      return gatewayError(502, method, UNAVAILABLE_MESSAGE);
  }
}
