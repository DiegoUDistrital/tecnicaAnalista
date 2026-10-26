import 'server-only';

/** Causas de las respuestas que genera este servidor (no vienen de Express). */
export type OwnErrorKind =
  | 'forbidden'
  | 'invalid_id'
  | 'invalid_query'
  | 'invalid_body'
  | 'too_large'
  | 'unsupported_media'
  | 'timeout'
  | 'internal';

export interface Detail {
  field: string;
  message: string;
}

interface OwnErrorSpec {
  status: number;
  code: string;
  message: string;
  details: Detail[];
}

export const UNAVAILABLE_MESSAGE = 'El servicio no está disponible. Inténtalo más tarde.';
const NOT_ALLOWED = { status: 405, code: 'METHOD_NOT_ALLOWED', message: 'Operación no permitida.' } as const;

/** Tabla cerrada de RF-F20 («respuestas generadas por el propio servidor»): ningún texto sale de la petición. */
const OWN_ERRORS: Readonly<Record<OwnErrorKind, OwnErrorSpec>> = {
  forbidden: {
    status: 403,
    code: 'FORBIDDEN',
    message: 'Operación no permitida desde este origen.',
    details: [],
  },
  invalid_id: {
    status: 400,
    code: 'BAD_REQUEST',
    message: 'El identificador no es válido.',
    details: [{ field: 'id', message: 'El identificador no es un UUID válido.' }],
  },
  invalid_query: {
    status: 400,
    code: 'BAD_REQUEST',
    message: 'Parámetros de consulta no permitidos.',
    details: [{ field: 'query', message: 'Parámetros de consulta no permitidos.' }],
  },
  invalid_body: {
    status: 400,
    code: 'BAD_REQUEST',
    message: 'El cuerpo debe ser un objeto JSON válido.',
    details: [{ field: 'body', message: 'El cuerpo debe ser un objeto JSON válido.' }],
  },
  too_large: { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'El texto es demasiado largo.', details: [] },
  unsupported_media: {
    status: 415,
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'Formato de petición no admitido.',
    details: [],
  },
  timeout: {
    status: 408,
    code: 'REQUEST_TIMEOUT',
    message: 'La petición tardó demasiado. Inténtalo de nuevo.',
    details: [],
  },
  internal: { status: 500, code: 'INTERNAL_ERROR', message: UNAVAILABLE_MESSAGE, details: [] },
};

/** Toda respuesta de las rutas lleva `no-store`: nada de lo que devuelven se guarda en cachés. */
function headers(extra: Record<string, string> = {}): Headers {
  return new Headers({ 'Cache-Control': 'no-store', ...extra });
}

function errorBody(code: string, message: string, details: Detail[]): unknown {
  return { error: { code, message, details } };
}

export function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers({ 'Content-Type': 'application/json', ...extraHeaders }),
  });
}

export function emptyResponse(status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: headers(extraHeaders) });
}

/** Error con la forma `{error:{code,message,details}}` para los estados que traduce el mapeo de Express. */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  details: Detail[] = [],
  extraHeaders: Record<string, string> = {},
): Response {
  return jsonResponse(status, errorBody(code, message, details), extraHeaders);
}

export function ownError(kind: OwnErrorKind): Response {
  const { status, code, message, details } = OWN_ERRORS[kind];
  return jsonResponse(status, errorBody(code, message, details));
}

/** 405 con `Allow` fijo; la respuesta a `HEAD` no lleva cuerpo. */
export function methodNotAllowed(allow: string, method: string): Response {
  const extra = { Allow: allow };
  if (method === 'HEAD') {
    return emptyResponse(NOT_ALLOWED.status, extra);
  }
  return jsonResponse(NOT_ALLOWED.status, errorBody(NOT_ALLOWED.code, NOT_ALLOWED.message, []), extra);
}
