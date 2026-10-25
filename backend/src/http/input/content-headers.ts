/**
 * Reglas puras de `Content-Encoding` y `Content-Type`. Trabajan sobre la lista de TODAS las apariciones de la cabecera
 * (sacada de `req.rawHeaders`): Node deja en `req.headers` solo la primera `Content-Type` repetida y une las
 * `Content-Encoding` con coma, así que un duplicado no se vería. Ante la duda, se rechaza.
 */

/** Gramática cerrada de `Content-Type`: JSON, con `charset=utf-8` opcional y sin más parámetros. */
const JSON_CONTENT_TYPE = /^application\/json(?:[ \t]*;[ \t]*charset=utf-8)?$/i;

/** Valores de todas las apariciones de una cabecera (nombre sin distinguir mayúsculas), en su orden de llegada. */
export function collectHeader(rawHeaders: readonly string[], name: string): string[] {
  const wanted = name.toLowerCase();
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length - 1; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === wanted) {
      values.push(rawHeaders[index + 1] ?? '');
    }
  }
  return values;
}

/** Sin cabecera, o exactamente una con el valor `identity`. Lista, vacío o duplicado se rechazan. */
export function isIdentityEncoding(values: readonly string[]): boolean {
  return values.length === 0 || (values.length === 1 && values[0]?.trim().toLowerCase() === 'identity');
}

/** Exactamente una cabecera cuyo valor es `application/json`, con `; charset=utf-8` opcional. */
export function isJsonContentType(values: readonly string[]): boolean {
  return values.length === 1 && JSON_CONTENT_TYPE.test(values[0] ?? '');
}
