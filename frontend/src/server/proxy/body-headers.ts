import 'server-only';

/** Tope del cuerpo de `POST` y `PUT` en bytes (RF-F19). */
export const MAX_BODY_BYTES = 10_240;

export type BodyHeadersResult = 'ok' | 'invalid_body' | 'too_large' | 'unsupported_media';

/** `Content-Length` (pasos 5 de RF-F19): ausente pasa (se limitará en la lectura); si está, entero no negativo. */
function checkContentLength(headers: Headers): 'ok' | 'invalid_body' | 'too_large' {
  const value = headers.get('content-length');
  if (value === null) {
    return 'ok';
  }
  if (!/^\d+$/.test(value)) {
    return 'invalid_body';
  }
  return Number(value) > MAX_BODY_BYTES ? 'too_large' : 'ok';
}

/** `Content-Type` `application/json`, con o sin `charset=utf-8`, sin distinguir mayúsculas. */
function isJsonContentType(value: string | null): boolean {
  if (value === null) {
    return false;
  }
  const [mediaType, ...parameters] = value.split(';').map((part) => part.trim().toLowerCase());
  return mediaType === 'application/json' && parameters.every((parameter) => parameter === 'charset=utf-8');
}

function isIdentityEncoding(value: string | null): boolean {
  return value === null || value.trim().toLowerCase() === 'identity';
}

/**
 * Cabeceras del cuerpo de `POST` y `PUT` (RF-F19, pasos 5 y 6), sin leer el cuerpo. Gana el primer fallo del orden:
 * `Content-Length` (400 o 413), luego tipo y codificación (415).
 */
export function checkBodyHeaders(headers: Headers): BodyHeadersResult {
  const length = checkContentLength(headers);
  if (length !== 'ok') {
    return length;
  }
  if (!isJsonContentType(headers.get('content-type')) || !isIdentityEncoding(headers.get('content-encoding'))) {
    return 'unsupported_media';
  }
  return 'ok';
}
