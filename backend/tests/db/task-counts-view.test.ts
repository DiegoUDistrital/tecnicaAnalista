import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applySchema, getTestDatabase, resetSchema, truncateTasks } from '../helpers/test-database';

let owner: Client;

beforeAll(async () => {
  await resetSchema();
  await applySchema();
  owner = await getTestDatabase().ownerClient();
});

beforeEach(async () => {
  await truncateTasks();
});

afterAll(async () => {
  await owner.end();
});

async function seed(completed: boolean, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await owner.query('INSERT INTO tasks (title, completed) VALUES ($1, $2)', [`tarea ${String(index)}`, completed]);
  }
}

describe('RF-D9: vista task_counts', () => {
  it('RF-D9: con 2 completadas y 3 pendientes devuelve 2 filas con el total correcto', async () => {
    await seed(true, 2);
    await seed(false, 3);
    const result = await owner.query('SELECT completed, total FROM task_counts ORDER BY completed');
    expect(result.rows).toEqual([
      { completed: false, total: 3 },
      { completed: true, total: 2 },
    ]);
  });

  it('RF-D9: un estado ausente no genera fila', async () => {
    await seed(true, 2);
    const result = await owner.query('SELECT completed, total FROM task_counts');
    expect(result.rows).toEqual([{ completed: true, total: 2 }]);
  });

  it('RF-D9: con la tabla vacía no devuelve filas', async () => {
    const result = await owner.query('SELECT completed, total FROM task_counts');
    expect(result.rows).toEqual([]);
  });

  it('RF-D9: total es un entero de 32 bits (int4) y el driver lo devuelve como number', async () => {
    await seed(false, 1);
    const result = await owner.query<{ total: unknown }>('SELECT total FROM task_counts');
    expect(typeof result.rows[0]?.total).toBe('number');
    const type = await owner.query<{ typname: string }>(
      `SELECT t.typname FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
        WHERE a.attrelid = 'public.task_counts'::regclass AND a.attname = 'total'`,
    );
    expect(type.rows[0]?.typname).toBe('int4');
  });
});

describe('RF-D10: propietario y opciones de la vista task_counts', () => {
  it('RF-D10: el propietario de la vista es owner', async () => {
    const result = await owner.query<{ owner: string }>(
      `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'public.task_counts'::regclass`,
    );
    expect(result.rows[0]?.owner).toBe('owner');
  });

  it('RF-D10: la vista no lleva security_invoker=true', async () => {
    const result = await owner.query<{ reloptions: string[] | null }>(
      `SELECT reloptions FROM pg_class WHERE oid = 'public.task_counts'::regclass`,
    );
    expect(result.rows[0]?.reloptions ?? []).not.toContain('security_invoker=true');
  });
});

describe('RF-D6: comentarios de la vista task_counts', () => {
  it('RF-D6: la vista y sus dos columnas tienen comentario en el catálogo', async () => {
    const view = await owner.query<{ comment: string | null }>(
      `SELECT obj_description('public.task_counts'::regclass, 'pg_class') AS comment`,
    );
    expect(view.rows[0]?.comment).toBeTruthy();
    for (const column of ['completed', 'total']) {
      const result = await owner.query<{ comment: string | null }>(
        `SELECT col_description('public.task_counts'::regclass, attnum) AS comment
           FROM pg_attribute WHERE attrelid = 'public.task_counts'::regclass AND attname = $1`,
        [column],
      );
      expect(result.rows[0]?.comment, `columna ${column}`).toBeTruthy();
    }
  });
});
