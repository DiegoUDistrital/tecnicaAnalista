import { loadWriterDatabaseUrl } from '../config/config';
import type { Logger } from '../logging/logger';
import { createPool, type Database } from './pool';
import { buildSeedTasks } from './seed-data';

// Una sola sentencia: o entran todas las filas o ninguna. `ON CONFLICT DO NOTHING` solo pide el permiso
// INSERT del rol writer y no toca lo que ya existe (DO UPDATE pediría UPDATE y pisaría las ediciones).
const INSERT_SEED_SQL = `INSERT INTO tasks (id, title, description, completed, "createdAt")
SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::bool[], $5::timestamptz[])
ON CONFLICT (id) DO NOTHING`;

// El comando hace una sola consulta: un pool mínimo basta (sin variables de entorno nuevas).
const SEED_POOL = { max: 1, idleTimeoutMillis: 1000, connectionTimeoutMillis: 5000 };

export interface SeedResult {
  inserted: number;
  existing: number;
}

/** Inserta las tareas de ejemplo que aún no existen y cuenta cuántas entraron y cuántas ya estaban. */
export async function seedTasks(db: Pick<Database, 'query'>, now: Date): Promise<SeedResult> {
  const rows = buildSeedTasks(now);
  const result = await db.query(INSERT_SEED_SQL, [
    rows.map((row) => row.id),
    rows.map((row) => row.title),
    rows.map((row) => row.description),
    rows.map((row) => row.completed),
    rows.map((row) => row.createdAt),
  ]);
  const inserted = result.rowCount ?? 0;
  return { inserted, existing: rows.length - inserted };
}

/**
 * Comando `npm run db:seed`: lee DATABASE_URL (solo rol writer), inserta las tareas de ejemplo y resume el
 * resultado. Devuelve 0 si va bien o 1 si falla; solo registra campos de la lista cerrada, sin valores.
 */
export async function runSeedCommand(
  env: Readonly<Record<string, string | undefined>>,
  logger: Logger,
): Promise<number> {
  try {
    const connectionString = loadWriterDatabaseUrl(env);
    const db = createPool({ connectionString, ...SEED_POOL }, logger);
    try {
      const { inserted, existing } = await seedTasks(db, new Date());
      logger.info(`Datos de ejemplo: ${String(inserted)} insertadas, ${String(existing)} ya existían`);
    } finally {
      await db.close();
    }
    return 0;
  } catch (error) {
    logger.error('seed_failed', { thrown: error });
    return 1;
  }
}
