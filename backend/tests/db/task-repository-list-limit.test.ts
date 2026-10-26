import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/pool';
import { createTaskRepository, type TaskRepository } from '../../src/repositories/task-repository';
import { applySchema, getTestDatabase, resetSchema, truncateTasks } from '../helpers/test-database';

let owner: Client;
let writer: Client;
let repository: TaskRepository;

function asDatabase(client: Client): Pick<Database, 'query'> {
  return { query: (text: string, values?: unknown[]) => client.query(text, values) };
}

beforeAll(async () => {
  await resetSchema();
  await applySchema();
  owner = await getTestDatabase().ownerClient();
  writer = await getTestDatabase().writerClient();
  repository = createTaskRepository(asDatabase(writer));
});

beforeEach(async () => {
  await truncateTasks();
});

afterAll(async () => {
  await writer.end();
  await owner.end();
});

/** Inserta `t1`...`tN` con fechas crecientes: `t1` es la más antigua y `tN` la más reciente. */
async function seed(count: number, completedOf: (n: number) => boolean = () => false): Promise<void> {
  for (let n = 1; n <= count; n += 1) {
    await owner.query('INSERT INTO tasks (title, "createdAt", completed) VALUES ($1, $2::timestamptz, $3)', [
      `t${String(n)}`,
      `2026-01-01 00:00:${String(n).padStart(2, '0')}+00`,
      completedOf(n),
    ]);
  }
}

async function titles(completed: boolean | undefined, limit: number): Promise<string[]> {
  return (await repository.list(completed, limit)).map((row) => row.title);
}

describe('RF-G17: tope de filas de la lista (PostgreSQL real)', () => {
  it.each([
    [5, 3, ['t5', 't4', 't3']],
    [5, 5, ['t5', 't4', 't3', 't2', 't1']],
    [5, 4, ['t5', 't4', 't3', 't2']],
    [2, 1000, ['t2', 't1']],
    [3, 1, ['t3']],
  ])('RF-G17: con %i tareas y tope %i devuelve las más recientes en orden', async (total, limit, expected) => {
    await seed(total);
    expect(await titles(undefined, limit)).toEqual(expected);
  });

  it('RF-G17: con el mismo createdAt el empate se resuelve por id ascendente antes de cortar', async () => {
    const ids = [
      '00000000-0000-4000-8000-00000000000c',
      '00000000-0000-4000-8000-00000000000a',
      '00000000-0000-4000-8000-00000000000b',
    ];
    for (const id of ids) {
      await owner.query('INSERT INTO tasks (id, title, "createdAt") VALUES ($1, $2, $3::timestamptz)', [
        id,
        `id-${id.slice(-1)}`,
        '2026-01-01 00:00:00+00',
      ]);
    }
    expect(await titles(undefined, 2)).toEqual(['id-a', 'id-b']);
  });

  it('RF-G17: ?completed true/false aplican el tope después del filtro', async () => {
    await seed(6, (n) => n % 2 === 0);
    expect(await titles(true, 2)).toEqual(['t6', 't4']);
    expect(await titles(false, 2)).toEqual(['t5', 't3']);
    expect(await titles(true, 10)).toEqual(['t6', 't4', 't2']);
  });

  it('RF-G17: 1 001 filas insertadas en bloque con el tope 1000 pasado explícito devuelven 1000', async () => {
    await owner.query(
      `INSERT INTO tasks (title, "createdAt")
       SELECT 'bulk-' || n, TIMESTAMPTZ '2026-01-01 00:00:00+00' + n * INTERVAL '1 second'
       FROM generate_series(1, 1001) AS n`,
    );
    const rows = await repository.list(undefined, 1000);
    expect(rows).toHaveLength(1000);
    expect(rows[0]?.title).toBe('bulk-1001');
    expect(rows.at(-1)?.title).toBe('bulk-2');
  });
});
