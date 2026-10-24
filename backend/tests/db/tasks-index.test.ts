import { beforeAll, describe, expect, it } from 'vitest';
import { applySchema, getTestDatabase, resetSchema } from '../helpers/test-database';

beforeAll(async () => {
  await resetSchema();
  await applySchema();
});

describe('RF-D8: índice sobre completed', () => {
  it('RF-D8: existe un índice de la única columna completed, no único y no parcial', async () => {
    const owner = await getTestDatabase().ownerClient();
    try {
      const result = await owner.query<{ columns: string[]; indisunique: boolean; indpred: string | null }>(
        `SELECT array_agg(a.attname::text ORDER BY k.ord) AS columns, i.indisunique, i.indpred::text AS indpred
           FROM pg_index i
           JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord) ON true
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
          WHERE i.indrelid = 'public.tasks'::regclass AND NOT i.indisprimary
          GROUP BY i.indexrelid, i.indisunique, i.indpred`,
      );
      const matching = result.rows.filter((row) => row.columns.length === 1 && row.columns[0] === 'completed');
      expect(matching).toHaveLength(1);
      expect(matching[0]?.indisunique).toBe(false);
      expect(matching[0]?.indpred).toBeNull();
    } finally {
      await owner.end();
    }
  });
});
