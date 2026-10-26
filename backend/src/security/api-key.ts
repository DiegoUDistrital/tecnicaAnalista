import { createHash, timingSafeEqual } from 'node:crypto';
import { collectHeader } from '../http/input/content-headers';

/**
 * Valor de ejemplo de `API_KEY` en `.env.example`. No es un secreto y el arranque lo rechaza. Por diseño NO cumple el
 * formato de una key válida (es más corto que 43 caracteres), así que no puede coincidir con una key generada.
 */
export const EXAMPLE_API_KEY = 'change-me-use-randomBytes-32';

/** Alfabeto base64url y longitud de la key (`randomBytes(32)` da 43 caracteres). */
const KEY_FORMAT = /^[A-Za-z0-9_-]{43,128}$/;
const MIN_DISTINCT_CHARACTERS = 10;

/** Cabecera `Authorization`: esquema, UN espacio y la key candidata (1 a 128 caracteres del alfabeto). */
const AUTHORIZATION_FORMAT = /^([A-Za-z]+) ([A-Za-z0-9_-]{1,128})$/;

/**
 * Valida el valor de `API_KEY` y devuelve el mensaje fijo del fallo, o `undefined` si es válida. Comprueba formato y
 * que no sea trivial, NO la entropía real. Los mensajes nunca llevan el valor. `example` es un parámetro para poder
 * ejercitar la comprobación de igualdad aunque el ejemplo real no cumpla el formato.
 */
export function checkApiKey(raw: string | undefined, example: string = EXAMPLE_API_KEY): string | undefined {
  if (raw === undefined) {
    return 'API_KEY: obligatoria';
  }
  if (raw === example) {
    return 'API_KEY: no puede ser el valor de ejemplo';
  }
  if (!KEY_FORMAT.test(raw) || new Set(raw).size < MIN_DISTINCT_CHARACTERS) {
    return 'API_KEY: formato inválido';
  }
  return undefined;
}

/**
 * Key candidata de una petición, o `undefined` si el formato no es el estricto. Trabaja sobre `req.rawHeaders` (no
 * sobre `req.headers`, donde Node descarta las `Authorization` repetidas): la cabecera debe aparecer UNA sola vez.
 * El esquema `Bearer` no distingue mayúsculas (RFC 7235); el resto de la gramática, sí.
 */
export function readBearerKey(rawHeaders: readonly string[]): string | undefined {
  const [value, ...repeated] = collectHeader(rawHeaders, 'authorization');
  if (value === undefined || repeated.length > 0) {
    return undefined;
  }
  const match = AUTHORIZATION_FORMAT.exec(value);
  return match?.[1]?.toLowerCase() === 'bearer' ? match[2] : undefined;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Crea el comprobador de la key: calcula UNA vez el resumen SHA-256 de la key válida y compara con él el resumen de
 * cada candidata. Ambos miden siempre 32 bytes, así que `timingSafeEqual` nunca lanza por longitudes distintas ni el
 * tiempo depende del contenido. `compare` es un parámetro solo para poder espiarlo en los tests.
 */
export function createKeyChecker(
  apiKey: string,
  compare: (candidate: Buffer, expected: Buffer) => boolean = timingSafeEqual,
): (candidate: string) => boolean {
  const expected = sha256(apiKey);
  return (candidate) => compare(sha256(candidate), expected);
}
