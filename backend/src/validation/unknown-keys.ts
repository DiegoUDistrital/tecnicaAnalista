const ALLOWED_KEYS: ReadonlySet<string> = new Set(['title', 'description']);

/**
 * Indica si el cuerpo de un POST tiene alguna clave propia que no sea `title` ni `description`. Usa solo
 * `Object.keys` (claves propias): `__proto__`, `constructor` o `toString` creados por `JSON.parse` cuentan como
 * cualquier otra clave, y el prototipo no influye en el resultado.
 */
export function hasUnknownKeys(body: Record<string, unknown>): boolean {
  return Object.keys(body).some((key) => !ALLOWED_KEYS.has(key));
}
