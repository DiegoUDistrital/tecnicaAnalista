/**
 * Interpolador mínimo de variables al estilo de Docker Compose, para leer `docker-compose.yml` en los tests sin
 * Docker (`docker compose config` imprimiría las contraseñas). Solo admite las formas que usa la composición y lanza
 * ante cualquier otra, para no pasar en silencio.
 */

const TOKEN = /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([-?])([^}]*))?\}|\$\{[^}]*\}|\$[A-Za-z_]/g;

/**
 * - `$$` -> `$`
 * - `${X}` -> valor de X o cadena vacía
 * - `${X:-v}` -> valor de X, o `v` si no está definida o está vacía
 * - `${X:?msg}` -> valor de X; si no está definida o está vacía lanza un error que nombra X (nunca muestra valores)
 */
export function interpolate(text: string, env: Record<string, string | undefined>): string {
  return text.replace(TOKEN, (token, name?: string, operator?: string, argument?: string) => {
    if (token === '$$') return '$';
    if (name === undefined) throw new Error(`Forma de interpolación no admitida: «${token}»`);
    const value = env[name];
    if (operator === undefined) return value ?? '';
    const missing = value === undefined || value === '';
    if (operator === '-') return missing ? (argument ?? '') : value;
    if (missing) throw new Error(`${name}: ${argument ?? ''}`);
    return value;
  });
}

/** Nombres de las variables que referencia el texto con `${NOMBRE...}` (sin repetir; ignora `$$`). */
export function referencedVariables(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(TOKEN)) {
    if (match[1] !== undefined) names.add(match[1]);
  }
  return [...names];
}
