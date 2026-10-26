import 'server-only';
import { createLogger, type Logger } from '../logging/logger';
import { CONFIG_VARIABLES, ConfigError, type ConfigVariable } from './config-error';

export interface FrontendConfig {
  /** Origen del backend (`esquema://host[:puerto]`), sin barra final. */
  readonly backendUrl: string;
  readonly apiKey: string;
  /** URL de conexión del rol `reader`. */
  readonly readerDatabaseUrl: string;
  /** Hosts permitidos, o `undefined` si no se valida el `Host`. */
  readonly allowedHosts: readonly string[] | undefined;
}

/** Entorno de entrada: `parseConfig` lee SOLO los nombres de `CONFIG_VARIABLES` y nunca lo recorre. */
export type ConfigEnv = Readonly<Record<string, string | undefined>>;

/** Valor de ejemplo de `API_KEY` en `frontend/.env.example`: no es un secreto y se rechaza. */
export const EXAMPLE_API_KEY = 'change-me-use-randomBytes-32';

// Misma regla que RF-G6 del backend (el frontend no importa código del backend): si una cambia, cambia la otra.
const API_KEY_FORMAT = /^[A-Za-z0-9_-]{43,128}$/;
const MIN_DISTINCT_CHARACTERS = 10;
const HOST_ENTRY = /^[a-z0-9.-]+(:[0-9]{1,5})?$/;
const BACKEND_FORBIDDEN = /[?#\\\s]/;
const DATABASE_PATH = /^\/[^/]+$/;
const READER_USER = 'reader';

/** Un valor obligatorio debe existir, no estar vacío y no tener espacios en los extremos. */
function required(raw: string | undefined): string | undefined {
  return raw !== undefined && raw !== '' && raw === raw.trim() ? raw : undefined;
}

function parseUrl(raw: string): URL | undefined {
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

function backendOrigin(value: string | undefined): string | undefined {
  const raw = required(value);
  const url = raw === undefined ? undefined : parseUrl(raw);
  if (raw === undefined || url === undefined || BACKEND_FORBIDDEN.test(raw) || raw.endsWith('/')) {
    return undefined;
  }
  const validShape = (url.protocol === 'http:' || url.protocol === 'https:') && url.pathname === '/';
  return validShape && url.username === '' && url.password === '' ? url.origin : undefined;
}

function apiKey(value: string | undefined): string | undefined {
  const valid =
    value !== undefined &&
    value !== EXAMPLE_API_KEY &&
    API_KEY_FORMAT.test(value) &&
    new Set(value).size >= MIN_DISTINCT_CHARACTERS;
  return valid ? value : undefined;
}

function decodedUser(url: URL): string | undefined {
  try {
    return decodeURIComponent(url.username);
  } catch {
    return undefined;
  }
}

function readerDatabaseUrl(value: string | undefined): string | undefined {
  const raw = required(value);
  const url = raw === undefined ? undefined : parseUrl(raw);
  if (raw === undefined || url === undefined || /[?#]/.test(raw)) {
    return undefined;
  }
  const valid =
    (url.protocol === 'postgresql:' || url.protocol === 'postgres:') &&
    decodedUser(url) === READER_USER &&
    url.password !== '' &&
    url.hostname !== '' &&
    DATABASE_PATH.test(url.pathname);
  return valid ? raw : undefined;
}

/** `undefined` si la lista es inválida; la variable ausente se trata antes (no se valida el `Host`). */
function hostList(raw: string): readonly string[] | undefined {
  const entries = raw.split(',');
  return entries.every((entry) => HOST_ENTRY.test(entry)) ? entries : undefined;
}

/**
 * Valida el entorno y devuelve la configuración, o lanza `ConfigError` con los NOMBRES de todas las variables
 * inválidas (en el orden fijo de `CONFIG_VARIABLES`), sin sus valores. Lee solo los cuatro nombres conocidos.
 */
export function parseConfig(env: ConfigEnv): FrontendConfig {
  const backend = backendOrigin(env.BACKEND_URL);
  const key = apiKey(env.API_KEY);
  const database = readerDatabaseUrl(env.READER_DATABASE_URL);
  const rawHosts = env.ALLOWED_HOSTS;
  const hosts = rawHosts === undefined ? undefined : hostList(rawHosts);

  const invalid: ConfigVariable[] = [];
  if (backend === undefined) invalid.push('BACKEND_URL');
  if (key === undefined) invalid.push('API_KEY');
  if (database === undefined) invalid.push('READER_DATABASE_URL');
  if (rawHosts !== undefined && hosts === undefined) invalid.push('ALLOWED_HOSTS');
  if (backend === undefined || key === undefined || database === undefined || invalid.length > 0) {
    throw new ConfigError(invalid);
  }
  return { backendUrl: backend, apiKey: key, readerDatabaseUrl: database, allowedHosts: hosts };
}

/** Copia solo los cuatro nombres de la lista cerrada: el resto de `process.env` nunca sale de aquí. */
export function pickConfigEnv(source: ConfigEnv): ConfigEnv {
  return Object.fromEntries(CONFIG_VARIABLES.map((name) => [name, source[name]]));
}

export interface ConfigProviderOptions {
  readEnv: () => ConfigEnv;
  logger?: Logger;
}

type Outcome = { config: FrontendConfig } | { error: ConfigError };

/**
 * Crea el proveedor perezoso de la configuración: no valida al crearse; la PRIMERA llamada valida y guarda el resultado
 * (válido o inválido). Si es inválido registra `config_invalid` UNA vez y lanza siempre el mismo `ConfigError`.
 */
export function createConfigProvider({
  readEnv,
  logger = createLogger(),
}: ConfigProviderOptions): () => FrontendConfig {
  let outcome: Outcome | undefined;
  const evaluate = (): Outcome => {
    try {
      return { config: parseConfig(readEnv()) };
    } catch (error) {
      if (!(error instanceof ConfigError)) {
        throw error;
      }
      logger.error('config_invalid', { error, variables: error.variables });
      return { error };
    }
  };
  return () => {
    outcome ??= evaluate();
    if ('error' in outcome) {
      throw outcome.error;
    }
    return outcome.config;
  };
}

/** Configuración del proceso: lee `process.env` (solo los cuatro nombres) la primera vez que se pide. */
export const getConfig = createConfigProvider({ readEnv: () => pickConfigEnv(process.env) });
