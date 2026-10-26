import 'server-only';

/** `fatal` rechaza UTF-8 inválido; `ignoreBOM: true` CONSERVA el BOM en el texto (y `JSON.parse` lo rechaza). */
const DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Cuerpo JSON estricto (RF-F19, paso 8): UTF-8 válido sin BOM, JSON válido, raíz objeto (no arreglo ni `null`) y sin
 * la clave `__proto__` en la raíz. Devuelve el objeto VUELTO A SERIALIZAR (sin espacios ni claves duplicadas, gana la
 * última): el texto crudo nunca se reenvía. `undefined` si algo falla (la ruta responde 400). No valida campos.
 */
export function parseJsonBody(bytes: Uint8Array): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(DECODER.decode(bytes));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Object.hasOwn(parsed, '__proto__')) {
    return undefined;
  }
  return JSON.stringify(parsed);
}
