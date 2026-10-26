export type Env = Record<string, string | undefined>;

/**
 * Único lugar que construye el entorno mínimo válido para `loadConfig` (el resto de variables toma su valor por
 * defecto). `overrides` lo modifica; un valor `undefined` quita la variable.
 */
export function baseEnv(overrides: Env = {}): Env {
  return {
    DATABASE_URL: 'postgresql://writer:change-me@127.0.0.1:5433/todo_app',
    ...overrides,
  };
}
