/** Claves permitidas en el cuerpo de `POST /api/tasks`. */
export const POST_KEYS: ReadonlySet<string> = new Set(['title', 'description']);

/** Claves permitidas en el cuerpo de `PUT /api/tasks/:id`. */
export const PUT_KEYS: ReadonlySet<string> = new Set(['title', 'description', 'completed']);

/**
 * Indica si el cuerpo tiene alguna clave propia fuera de las permitidas. Usa solo `Object.keys` (claves propias):
 * `__proto__`, `constructor` o `toString` creados por `JSON.parse` cuentan como cualquier otra clave, y el prototipo
 * no influye en el resultado.
 */
export function hasUnknownKeys(body: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(body).some((key) => !allowed.has(key));
}
