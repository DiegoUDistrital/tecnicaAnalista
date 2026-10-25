import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';
import { DatabaseUnavailableError } from '../errors/database-unavailable-error';
import type { Logger } from '../logging/logger';
import { isDatabaseUnavailable } from './unavailable';

export interface PoolSettings {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

/** Lo mínimo que se usa de un Pool de pg; permite inyectar uno falso. */
export type PoolLike = Pick<Pool, 'on' | 'query' | 'end'>;

export interface Database {
  /** Ejecuta una consulta parametrizada. Los fallos de conexión salen como `DatabaseUnavailableError`. */
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
  /** Cierra el Pool esperando a las consultas en curso. Idempotente y seguro si se llama a la vez. */
  close(): Promise<void>;
}

/** Función pura: opciones del Pool de pg a partir de la configuración validada. */
export function buildPoolOptions(settings: PoolSettings): PoolConfig {
  return {
    connectionString: settings.connectionString,
    max: settings.max,
    idleTimeoutMillis: settings.idleTimeoutMillis,
    connectionTimeoutMillis: settings.connectionTimeoutMillis,
  };
}

/**
 * Crea el Pool con el rol writer. No expone `connect()`: la capa de datos solo ofrece `query` y `close`.
 * El error de un cliente inactivo se registra y NO termina el proceso (sin manejador, Node lo derribaría).
 */
export function createPool(
  settings: PoolSettings,
  logger: Logger,
  factory: (options: PoolConfig) => PoolLike = (options) => new Pool(options),
): Database {
  const pool = factory(buildPoolOptions(settings));
  pool.on('error', (error) => {
    logger.error('pool_client_error', { thrown: error });
  });

  let closing: Promise<void> | undefined;

  return {
    async query<Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<Row>> {
      if (closing !== undefined) {
        throw new DatabaseUnavailableError();
      }
      try {
        return await pool.query<Row>(text, values);
      } catch (error) {
        throw isDatabaseUnavailable(error) ? new DatabaseUnavailableError() : error;
      }
    },
    close(): Promise<void> {
      closing ??= pool.end();
      return closing;
    },
  };
}
