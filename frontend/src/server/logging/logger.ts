import 'server-only';
import { describeError, errorCode } from './error-fields';

/** Eventos cerrados del registro. Añadir uno exige hacerlo aquí y en su test. */
export type LogEvent = 'config_invalid' | 'route_failed';

/** Contexto de entrada: puede traer cualquier clave, pero solo las de la lista cerrada llegan a la salida. */
export type LogContext = Readonly<Record<string, unknown>>;

export interface LoggerOptions {
  /** Destino: recibe una línea JSON completa, con su salto de línea final. Por defecto, `process.stderr`. */
  write?: (line: string) => void;
  /** Reloj inyectable para los tests. */
  now?: () => Date;
}

export interface Logger {
  error(event: LogEvent, context?: LogContext): void;
}

type Fields = Record<string, string | number | string[]>;

const METHODS = ['GET', 'POST', 'PUT', 'DELETE'];
const ROUTES = ['/api/tasks', '/api/tasks/:id'];
const VARIABLES = ['BACKEND_URL', 'API_KEY', 'READER_DATABASE_URL', 'ALLOWED_HOSTS'];
const MIN_STATUS = 100;
const MAX_STATUS = 599;

const writeToStderr = (line: string): void => {
  process.stderr.write(line);
};

function oneOf(value: unknown, allowed: readonly string[]): string | undefined {
  return typeof value === 'string' && allowed.includes(value) ? value : undefined;
}

function validStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_STATUS && value <= MAX_STATUS
    ? value
    : undefined;
}

function allowedVariables(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const names: unknown[] = value;
  return names.filter((name): name is string => typeof name === 'string' && VARIABLES.includes(name));
}

/** Construye solo los campos de la lista cerrada, en orden fijo. */
function buildFields(context: LogContext): Fields {
  const fields: Fields = {};
  const method = oneOf(context.method, METHODS);
  if (method !== undefined) {
    fields.method = method;
  }
  const route = oneOf(context.route, ROUTES);
  if (route !== undefined) {
    fields.route = route;
  }
  const status = validStatus(context.status);
  if (status !== undefined) {
    fields.status = status;
  }
  if (Object.hasOwn(context, 'error')) {
    fields.errorName = describeError(context.error);
    const code = errorCode(context.error);
    if (code !== undefined) {
      fields.errorCode = code;
    }
  }
  const variables = allowedVariables(context.variables);
  if (variables.length > 0) {
    fields.variables = variables;
  }
  return fields;
}

/**
 * Crea el registro de errores del frontend: una línea JSON por evento con `time`, `level`, `event` y los campos
 * de la lista cerrada. Nunca escribe mensajes, trazas, URL, cabeceras, cuerpos, consultas, identificadores ni valores.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const write = options.write ?? writeToStderr;
  const now = options.now ?? (() => new Date());
  return {
    error: (event, context = {}) => {
      write(`${JSON.stringify({ time: now().toISOString(), level: 'error', event, ...buildFields(context) })}\n`);
    },
  };
}
