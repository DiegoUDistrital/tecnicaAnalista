import 'server-only';

/** Variables de entorno del frontend: lista cerrada, en el orden fijo en que se validan y se nombran. */
export const CONFIG_VARIABLES = ['BACKEND_URL', 'API_KEY', 'READER_DATABASE_URL', 'ALLOWED_HOSTS'] as const;

export type ConfigVariable = (typeof CONFIG_VARIABLES)[number];

/** Error de configuración: el mensaje y `variables` llevan solo NOMBRES de variables, nunca sus valores. */
export class ConfigError extends Error {
  readonly variables: readonly ConfigVariable[];

  constructor(variables: readonly ConfigVariable[]) {
    super(`Configuración del frontend inválida: ${variables.join(', ')}.`);
    this.name = 'ConfigError';
    this.variables = variables;
  }
}
