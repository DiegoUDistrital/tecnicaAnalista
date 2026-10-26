import 'server-only';
import { createLogger, type Logger } from '../logging/logger';
import { getReaderDatabase } from './reader-database';

export type Counters = { available: true; completed: number; pending: number; all: number } | { available: false };

/** Lo mínimo que se usa del cliente de Prisma: una consulta cruda con plantilla etiquetada. */
export interface ReaderDatabase {
  $queryRaw(strings: TemplateStringsArray): Promise<unknown>;
}

export interface ReadCountersOptions {
  /** Entrega la base de lectura; puede lanzar (por ejemplo, `ConfigError` si la configuración es inválida). */
  database?: () => ReaderDatabase;
  logger?: Logger;
  /** Plazo máximo de la lectura en milisegundos. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 2000;
const MAX_ROWS = 2;

/** La respuesta de la vista no tiene la forma esperada. */
export class CountersReadError extends Error {}

/** La lectura de los contadores superó el plazo. */
export class CountersTimeoutError extends Error {}

function isRow(value: unknown): value is { completed: boolean; total: number } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.completed === 'boolean' &&
    typeof row.total === 'number' &&
    Number.isSafeInteger(row.total) &&
    row.total >= 0
  );
}

/** Valida las filas de la vista y las convierte en contadores; lanza `CountersReadError` si no tienen la forma. */
export function toCounters(rows: unknown): Counters {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) {
    throw new CountersReadError('Unexpected shape of the counters result');
  }
  const valid: unknown[] = rows;
  const parsed = valid.filter(isRow);
  if (parsed.length !== valid.length || new Set(parsed.map((row) => row.completed)).size !== parsed.length) {
    throw new CountersReadError('Unexpected rows in the counters result');
  }
  const completed = parsed.find((row) => row.completed)?.total ?? 0;
  const pending = parsed.find((row) => !row.completed)?.total ?? 0;
  return { available: true, completed, pending, all: completed + pending };
}

/**
 * Lee los contadores de la vista `task_counts` con el rol `reader`. NUNCA lanza: ante cualquier fallo (conexión,
 * forma de las filas, configuración inválida o plazo agotado) registra el evento sin datos y devuelve
 * `available: false`. Si la consulta pierde la carrera con el plazo, sigue en curso sin bloquear la respuesta
 * (`Promise.race` ya la observa, así que un rechazo tardío no queda sin manejar).
 */
export async function readCounters({
  database = getReaderDatabase,
  logger = createLogger(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ReadCountersOptions = {}): Promise<Counters> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const query = database().$queryRaw`SELECT completed, total FROM task_counts`;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new CountersTimeoutError('Counters read timed out'));
      }, timeoutMs);
    });
    return toCounters(await Promise.race([query, deadline]));
  } catch (error) {
    logger.error('counters_failed', { error });
    return { available: false };
  } finally {
    clearTimeout(timer);
  }
}
