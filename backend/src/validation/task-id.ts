export type TaskIdResult = { ok: true; value: string } | { ok: false };

/** UUID completo 8-4-4-4-12 en hexadecimal ASCII. Sin bandera `i` ni `m`: `$` no admite un salto de línea final. */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Valida el segmento CRUDO del identificador (sin decodificar): lo decodifica UNA sola vez, exige un UUID completo y lo
 * devuelve en minúsculas. Nunca lanza: un porcentaje mal formado es simplemente un identificador inválido.
 */
export function parseTaskId(rawSegment: string): TaskIdResult {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawSegment);
  } catch {
    return { ok: false };
  }
  return UUID.test(decoded) ? { ok: true, value: decoded.toLowerCase() } : { ok: false };
}
