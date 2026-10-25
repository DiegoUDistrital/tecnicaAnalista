import { randomBytes } from 'node:crypto';
import type { Client } from 'pg';

/** Prefijo de todas las restricciones temporales: permite limpiar las que haya dejado un test que murió. */
export const TEMPORARY_CHECK_PREFIX = 'tmp_check_';

// El título prohibido se escribe como literal SQL: solo se admiten caracteres que no necesitan escape.
const SAFE_LITERAL = /^[A-Za-z0-9 _-]+$/;

/** Nombres de las restricciones temporales que existen ahora en `tasks`. */
export async function listTemporaryChecks(owner: Client): Promise<string[]> {
  const found = await owner.query<{ conname: string }>(
    `SELECT conname FROM pg_constraint WHERE conrelid = to_regclass('public.tasks') AND conname LIKE $1`,
    [`${TEMPORARY_CHECK_PREFIX}%`],
  );
  return found.rows.map((row) => row.conname);
}

/** Elimina de `tasks` toda restricción con el prefijo temporal (residuos de un test que no pudo limpiar). */
export async function dropResidualChecks(owner: Client): Promise<void> {
  for (const name of await listTemporaryChecks(owner)) {
    await owner.query(`ALTER TABLE tasks DROP CONSTRAINT IF EXISTS "${name}"`);
  }
}

/**
 * Añade (con el rol owner) una restricción CHECK temporal de nombre único que rechaza `forbiddenTitle`, ejecuta
 * `run` y SIEMPRE la elimina al terminar, también si `run` lanza. La validación HTTP completa hace inalcanzable el
 * CHECK original de la migración; con este se provoca una violación real sin saltarse la API.
 */
export async function withTemporaryCheck<T>(owner: Client, forbiddenTitle: string, run: () => Promise<T>): Promise<T> {
  if (!SAFE_LITERAL.test(forbiddenTitle)) {
    throw new Error('El título prohibido solo admite letras, dígitos, espacio, guion y guion bajo.');
  }
  const name = `${TEMPORARY_CHECK_PREFIX}${randomBytes(6).toString('hex')}`;
  await owner.query(`ALTER TABLE tasks ADD CONSTRAINT "${name}" CHECK (title <> '${forbiddenTitle}')`);
  try {
    return await run();
  } finally {
    await owner.query(`ALTER TABLE tasks DROP CONSTRAINT IF EXISTS "${name}"`);
  }
}
