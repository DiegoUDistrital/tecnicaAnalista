/** Variables de sistema que Windows necesita para ejecutar programas (ninguna es secreta). */
const WINDOWS_SYSTEM_VARIABLES = ['SystemRoot', 'TEMP', 'TMP'];

/**
 * Busca una variable por su nombre. En Windows los nombres no distinguen mayúsculas ('Path' y 'PATH' son la misma).
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 * @param {boolean} ignoreCase
 * @returns {string | undefined}
 */
function lookup(env, name, ignoreCase) {
  if (!ignoreCase) return env[name];
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

/**
 * Construye el entorno de un proceso hijo desde cero: solo PATH (y, en Windows, SystemRoot, TEMP y TMP) más lo que
 * el comando pida en `extra`. Nada más del entorno del padre llega al hijo, así que ningún secreto se hereda.
 * @param {string} platform valor de process.platform
 * @param {Record<string, string | undefined>} parentEnv entorno del proceso que lanza
 * @param {Record<string, string>} [extra] variables propias del comando; pisan a las anteriores
 * @returns {Record<string, string>}
 */
export function buildClosedEnv(platform, parentEnv, extra = {}) {
  const isWindows = platform === 'win32';
  /** @type {Record<string, string>} */
  const env = {};
  const path = lookup(parentEnv, 'PATH', isWindows);
  if (path !== undefined) env.PATH = path;
  if (isWindows) {
    for (const name of WINDOWS_SYSTEM_VARIABLES) {
      const value = lookup(parentEnv, name, true);
      if (value !== undefined) env[name] = value;
    }
  }
  return { ...env, ...extra };
}
