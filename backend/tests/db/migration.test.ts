import { beforeAll, describe, expect, it } from 'vitest';
import { applySchema, getTestDatabase, resetSchema, runPrisma } from '../helpers/test-database';

async function snapshotObjects(): Promise<string[]> {
  const owner = await getTestDatabase().ownerClient();
  try {
    const result = await owner.query<{ item: string }>(`
      SELECT 'rel:' || c.relname || ':' || c.relkind::text AS item
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
      UNION ALL SELECT 'con:' || conname || ':' || pg_get_constraintdef(oid) FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace
      UNION ALL SELECT 'idx:' || indexdef FROM pg_indexes WHERE schemaname = 'public'
      UNION ALL SELECT 'desc:' || objoid::regclass::text || ':' || objsubid || ':' || description
        FROM pg_description WHERE classoid = 'pg_class'::regclass
          AND objoid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)
      ORDER BY 1`);
    return result.rows.map((row) => row.item);
  } finally {
    await owner.end();
  }
}

const DRIFT_ARGS = [
  ...['migrate', 'diff', '--from-config-datasource'],
  ...['--to-schema', 'prisma/schema.prisma', '--exit-code'],
];

describe('RF-D6: migración de la tabla tasks', () => {
  beforeAll(async () => {
    await resetSchema();
    await applySchema();
  });

  it('RF-D6: reaplicar no cambia nada (sin migraciones pendientes y mismos objetos)', async () => {
    const before = await snapshotObjects();
    const output = runPrisma(['migrate', 'deploy']);
    expect(output.status).toBe(0);
    expect(output.stdout).toMatch(/No pending migrations to apply/);
    expect(await snapshotObjects()).toEqual(before);
  });

  it('RF-D6: los comentarios de la tabla y de sus columnas están en el catálogo', async () => {
    const owner = await getTestDatabase().ownerClient();
    try {
      const table = await owner.query<{ comment: string | null }>(
        `SELECT obj_description('public.tasks'::regclass, 'pg_class') AS comment`,
      );
      expect(table.rows[0]?.comment).toBeTruthy();
      for (const column of ['id', 'title', 'description', 'completed', 'createdAt']) {
        const result = await owner.query<{ comment: string | null }>(
          `SELECT col_description('public.tasks'::regclass, attnum) AS comment
             FROM pg_attribute WHERE attrelid = 'public.tasks'::regclass AND attname = $1`,
          [column],
        );
        expect(result.rows[0]?.comment, `columna ${column}`).toBeTruthy();
      }
    } finally {
      await owner.end();
    }
  });

  it('RF-D6: la segunda migración crea la vista task_counts (sin modelarla en schema.prisma)', async () => {
    const owner = await getTestDatabase().ownerClient();
    try {
      const migrations = await owner.query<{ migration_name: string }>(
        'SELECT migration_name FROM _prisma_migrations ORDER BY migration_name',
      );
      expect(migrations.rows.map((row) => row.migration_name.replace(/^\d+_/, ''))).toEqual([
        'create_tasks',
        'create_task_counts_view',
      ]);
      const view = await owner.query(`SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'task_counts'`);
      expect(view.rowCount).toBe(1);
    } finally {
      await owner.end();
    }
  });

  it('RF-D6: ningún comentario de los objetos contiene la palabra PASSWORD', async () => {
    const owner = await getTestDatabase().ownerClient();
    try {
      const result = await owner.query(
        `SELECT 1 FROM pg_description d JOIN pg_class c ON c.oid = d.objoid
          WHERE c.relnamespace = 'public'::regnamespace AND d.description ILIKE '%password%'`,
      );
      expect(result.rowCount).toBe(0);
    } finally {
      await owner.end();
    }
  });

  it('RF-D6: sin deriva entre la base migrada y schema.prisma (código 0)', () => {
    expect(runPrisma(DRIFT_ARGS).status).toBe(0);
  });

  it('RF-D6: control negativo, una columna añadida a mano produce deriva (código 2) y se limpia', async () => {
    const owner = await getTestDatabase().ownerClient();
    try {
      await owner.query('ALTER TABLE public.tasks ADD COLUMN extra text');
      try {
        expect(runPrisma(DRIFT_ARGS).status).toBe(2);
      } finally {
        await owner.query('ALTER TABLE public.tasks DROP COLUMN extra');
      }
      expect(runPrisma(DRIFT_ARGS).status).toBe(0);
    } finally {
      await owner.end();
    }
  });
});
