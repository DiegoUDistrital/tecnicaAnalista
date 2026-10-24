import { describeThrown } from './error-fields';

/** Destino de salida: recibe una línea JSON completa, con su salto de línea final. */
export type LogWriter = (line: string) => void;

/** Contexto libre de entrada; solo los campos de la lista permitida llegan a la salida. */
export type LogContext = Readonly<Record<string, unknown>>;

export interface Logger {
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, options?: { context?: LogContext; thrown?: unknown }): void;
}

// Lista permitida (comparación exacta). Una spec que necesite otro nombre lo añade aquí y en su test.
const ALLOWED_CONTEXT_FIELDS = ['host', 'port', 'signal', 'exitCode', 'timeoutMs'] as const;

function pickAllowed(context: LogContext | undefined): Record<string, string | number | boolean> {
  const picked: Record<string, string | number | boolean> = {};
  if (context === undefined) {
    return picked;
  }
  for (const name of ALLOWED_CONTEXT_FIELDS) {
    const value = Object.hasOwn(context, name) ? context[name] : undefined;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      picked[name] = value;
    }
  }
  return picked;
}

/**
 * Crea un logger que escribe una línea JSON por registro en `write`.
 * Orden de claves: `level`, `event`, `time`, contexto, campos de error. Como `level`, `event` y `time` no están
 * en la lista permitida, el contexto no puede sobrescribirlos.
 */
export function createLogger(write: LogWriter, now: () => Date = () => new Date()): Logger {
  const emit = (level: string, event: string, fields: Record<string, unknown>): void => {
    write(`${JSON.stringify({ level, event, time: now().toISOString(), ...fields })}\n`);
  };
  return {
    info: (event, context) => {
      emit('info', event, pickAllowed(context));
    },
    warn: (event, context) => {
      emit('warn', event, pickAllowed(context));
    },
    error: (event, options) => {
      const fields = pickAllowed(options?.context);
      if (options !== undefined && Object.hasOwn(options, 'thrown')) {
        Object.assign(fields, describeThrown(options.thrown));
      }
      emit('error', event, fields);
    },
  };
}
