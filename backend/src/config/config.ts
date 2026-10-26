import { isIP } from 'node:net';
import { ConfigError } from '../errors/config-error';
import { checkApiKey } from '../security/api-key';
import { parseTrustedProxies, type TrustedProxies } from '../security/trusted-proxies';

/** Configuración validada que usa el resto del backend. */
export interface AppConfig {
  databaseUrl: string;
  pool: {
    max: number;
    idleTimeoutMillis: number;
    connectionTimeoutMillis: number;
  };
  server: {
    port: number;
    host: string;
    shutdownTimeoutMs: number;
  };
  security: {
    apiKey: string;
    /** Direcciones de las que se cree `X-Forwarded-For`. */
    trustedProxies: TrustedProxies;
  };
}

type VariableSpec =
  | { name: string; kind: 'writer-url' }
  | { name: string; kind: 'api-key' }
  | { name: string; kind: 'trusted-proxies' }
  | { name: string; kind: 'host'; fallback: string }
  | { name: string; kind: 'int'; min: number; max: number; fallback: number };

/**
 * Esquema ÚNICO de variables validadas. El orden fija el orden de los mensajes de error.
 * Las specs siguientes añaden aquí sus variables.
 */
const VARIABLES: readonly VariableSpec[] = [
  { name: 'DATABASE_URL', kind: 'writer-url' },
  { name: 'DB_POOL_MAX', kind: 'int', min: 1, max: 100, fallback: 10 },
  { name: 'DB_POOL_IDLE_TIMEOUT_MS', kind: 'int', min: 1000, max: 600000, fallback: 30000 },
  { name: 'DB_POOL_CONNECTION_TIMEOUT_MS', kind: 'int', min: 100, max: 60000, fallback: 5000 },
  { name: 'PORT', kind: 'int', min: 1, max: 65535, fallback: 3000 },
  { name: 'HOST', kind: 'host', fallback: '127.0.0.1' },
  { name: 'SHUTDOWN_TIMEOUT_MS', kind: 'int', min: 1000, max: 120000, fallback: 10000 },
  { name: 'API_KEY', kind: 'api-key' },
  { name: 'TRUSTED_PROXIES', kind: 'trusted-proxies' },
];

/** Nombres de las variables del esquema (los usa el test de `.env.example`). */
export const CONFIG_VARIABLE_NAMES: readonly string[] = VARIABLES.map((variable) => variable.name);

const URL_FORMAT_MESSAGE = 'DATABASE_URL: formato inválido';
const URL_ROLE_MESSAGE = 'DATABASE_URL: debe usar el rol writer';

/** Dirección IP literal (v4 o v6) sin corchetes ni zona (`%eth0`): no se admiten nombres de host. */
function isLiteralIp(raw: string): boolean {
  return isIP(raw) !== 0 && !raw.includes('%');
}

/** Entero decimal ASCII sin signo ni ceros a la izquierda, dentro de [min, max]. */
function parseInteger(raw: string, min: number, max: number): number | undefined {
  if (!/^[1-9][0-9]*$/.test(raw)) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
}

/**
 * Cualquier espacio (incluidos los de los extremos) o carácter de control. Se comprueba antes de `new URL`
 * porque este recorta espacios de los extremos y elimina tabuladores y saltos de línea, de modo que una
 * variable mal formada se aceptaría en silencio.
 */
const WHITESPACE_OR_CONTROL = /[\s\p{Cc}]/u;

/** Devuelve el mensaje fijo del primer fallo de la URL, o `undefined` si es válida. */
function checkWriterUrl(raw: string): string | undefined {
  if (WHITESPACE_OR_CONTROL.test(raw) || raw.includes('?') || raw.includes('#')) {
    return URL_FORMAT_MESSAGE;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return URL_FORMAT_MESSAGE;
  }
  const hasSingleDatabaseSegment = /^\/[^/]+$/.test(url.pathname);
  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    url.hostname === '' ||
    !hasSingleDatabaseSegment ||
    url.password === ''
  ) {
    return URL_FORMAT_MESSAGE;
  }
  let user: string;
  try {
    user = decodeURIComponent(url.username);
  } catch {
    return URL_FORMAT_MESSAGE;
  }
  return user === 'writer' ? undefined : URL_ROLE_MESSAGE;
}

/**
 * Valida las variables de entorno recibidas (no lee `process.env`). Si alguna falta o es inválida,
 * lanza `ConfigError` nombrando todas las inválidas, sin incluir nunca sus valores.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const messages: string[] = [];
  const values = new Map<string, string | number>();
  let trustedProxies: TrustedProxies | undefined;

  for (const variable of VARIABLES) {
    const raw = env[variable.name];
    if (variable.kind === 'writer-url') {
      const message = raw === undefined ? 'DATABASE_URL: obligatoria' : checkWriterUrl(raw);
      if (message !== undefined) {
        messages.push(message);
      } else if (raw !== undefined) {
        values.set(variable.name, raw);
      }
      continue;
    }
    if (variable.kind === 'api-key') {
      const message = checkApiKey(raw);
      if (message !== undefined) {
        messages.push(message);
      } else if (raw !== undefined) {
        values.set(variable.name, raw);
      }
      continue;
    }
    if (variable.kind === 'trusted-proxies') {
      trustedProxies = parseTrustedProxies(raw);
      if (trustedProxies === undefined) {
        messages.push(`${variable.name}: lista inválida`);
      }
      continue;
    }
    if (variable.kind === 'host') {
      const host = raw ?? variable.fallback;
      if (isLiteralIp(host)) {
        values.set(variable.name, host);
      } else {
        messages.push(`${variable.name}: dirección IP inválida`);
      }
      continue;
    }
    const value = raw === undefined ? variable.fallback : parseInteger(raw, variable.min, variable.max);
    if (value === undefined) {
      messages.push(`${variable.name}: entero inválido o fuera de rango`);
    } else {
      values.set(variable.name, value);
    }
  }

  if (messages.length > 0) {
    throw new ConfigError(messages);
  }

  return {
    databaseUrl: String(values.get('DATABASE_URL')),
    pool: {
      max: Number(values.get('DB_POOL_MAX')),
      idleTimeoutMillis: Number(values.get('DB_POOL_IDLE_TIMEOUT_MS')),
      connectionTimeoutMillis: Number(values.get('DB_POOL_CONNECTION_TIMEOUT_MS')),
    },
    server: {
      port: Number(values.get('PORT')),
      host: String(values.get('HOST')),
      shutdownTimeoutMs: Number(values.get('SHUTDOWN_TIMEOUT_MS')),
    },
    // Sin mensajes de error, `trustedProxies` está definida (se asigna en cada vuelta de la variable).
    security: { apiKey: String(values.get('API_KEY')), trustedProxies: trustedProxies as TrustedProxies },
  };
}
