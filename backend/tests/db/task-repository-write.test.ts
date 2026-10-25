import { Pool, type Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/pool';
import { createTaskRepository, type TaskRepository } from '../../src/repositories/task-repository';
import { applySchema, getTestDatabase, resetSchema, truncateTasks } from '../helpers/test-database';

const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const HOSTILE_ID = 'not-a-uuid-SECRETO-ZZZ';

let owner: Client;
let writer: Client;
let repository: TaskRepository;

// Adaptador mínimo: el repositorio solo necesita `query`, así que una conexión directa del rol writer sirve.
function asDatabase(client: Pick<Client, 'query'>): Pick<Database, 'query'> {
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

async function seed(title: string, description = '', completed = false): Promise<string> {
  const result = await owner.query<{ id: string }>(
    'INSERT INTO tasks (title, description, completed) VALUES ($1, $2, $3) RETURNING id',
    [title, description, completed],
  );
  return (result.rows[0] as { id: string }).id;
}

async function readRaw(id: string): Promise<Record<string, unknown> | undefined> {
  const result = await owner.query('SELECT id, title, description, completed, "createdAt" FROM tasks WHERE id = $1', [
    id,
  ]);
  return result.rows[0] as Record<string, unknown> | undefined;
}

async function countRows(): Promise<number> {
  const result = await owner.query<{ total: string }>('SELECT count(*)::text AS total FROM tasks');
  return Number((result.rows[0] as { total: string }).total);
}

describe('Repositorio de tareas: update contra PostgreSQL real', () => {
  it('RF-C15: update de solo completed deja title y description intactos y devuelve las cinco columnas', async () => {
    const id = await seed('titulo', 'detalle');
    const row = await repository.update(id, { completed: true });
    expect(row).toMatchObject({ id, title: 'titulo', description: 'detalle', completed: true });
    expect(Object.keys(row ?? {}).sort()).toEqual(['completed', 'createdAt', 'description', 'id', 'title']);
    expect(await readRaw(id)).toMatchObject({ title: 'titulo', description: 'detalle', completed: true });
  });

  it('RF-C15: update de solo title deja description y completed intactos', async () => {
    const id = await seed('viejo', 'detalle', true);
    const row = await repository.update(id, { title: 'nuevo' });
    expect(row).toMatchObject({ title: 'nuevo', description: 'detalle', completed: true });
  });

  it('RF-C15: update de todos los campos los cambia todos', async () => {
    const id = await seed('viejo', 'detalle', false);
    const row = await repository.update(id, { title: 'nuevo', description: 'otro', completed: true });
    expect(row).toMatchObject({ id, title: 'nuevo', description: 'otro', completed: true });
  });

  it('RF-C15: description vacía ("") vacía la descripción', async () => {
    const id = await seed('t', 'detalle');
    const row = await repository.update(id, { description: '' });
    expect(row?.description).toBe('');
    expect(await readRaw(id)).toMatchObject({ description: '' });
  });

  it('RF-C15: un update idéntico a lo almacenado devuelve la fila (no es 404)', async () => {
    const id = await seed('igual', 'detalle', true);
    const row = await repository.update(id, { title: 'igual', description: 'detalle', completed: true });
    expect(row).toMatchObject({ id, title: 'igual', description: 'detalle', completed: true });
  });

  it('RF-C20: createdAt no cambia tras update y conserva el formato ISO con milisegundos truncados', async () => {
    const created = await owner.query<{ id: string }>(
      `INSERT INTO tasks (title, "createdAt") VALUES ('a', '2026-03-04 05:06:07.123987+00') RETURNING id`,
    );
    const id = (created.rows[0] as { id: string }).id;
    const before = await readRaw(id);
    const row = await repository.update(id, { completed: true });
    expect(row?.createdAt).toMatch(ISO_UTC);
    expect(row?.createdAt).toBe('2026-03-04T05:06:07.123Z');
    expect((await readRaw(id))?.['createdAt']).toEqual(before?.['createdAt']);
  });

  it('RF-C17: update de un id inexistente (incluido el UUID nulo) devuelve undefined y no crea filas', async () => {
    await seed('existente');
    expect(await repository.update(NIL_UUID, { completed: true })).toBeUndefined();
    expect(await repository.update('3f2b8c1e-0000-4000-8000-0000000000aa', { title: 'x' })).toBeUndefined();
    expect(await countRows()).toBe(1);
  });

  it('RF-C15: tras update de la tarea A, la tarea B no cambia', async () => {
    const a = await seed('a', 'da');
    const b = await seed('b', 'db');
    const beforeB = await readRaw(b);
    await repository.update(a, { title: 'a2', description: 'da2', completed: true });
    expect(await readRaw(b)).toEqual(beforeB);
  });

  it('RF-C15: con el DELETE ya confirmado antes del update, update da undefined (404) y no lanza', async () => {
    const id = await seed('efimera');
    await owner.query('DELETE FROM tasks WHERE id = $1', [id]);
    await expect(repository.update(id, { completed: true })).resolves.toBeUndefined();
  });

  it(`RF-C21: update con title '); DROP TABLE tasks;-- hostil se guarda literal; la tabla sigue`, async () => {
    const id = await seed('t');
    const hostile = `'); DROP TABLE tasks;--`;
    await repository.update(id, { title: hostile, description: `${hostile} ' OR '1'='1` });
    const rows = await repository.list();
    expect(rows.map((row) => [row.title, row.description])).toEqual([[hostile, `${hostile} ' OR '1'='1`]]);
    const exists = await owner.query<{ found: boolean }>(`SELECT to_regclass('public.tasks') IS NOT NULL AS found`);
    expect(exists.rows[0]?.found).toBe(true);
  });

  it('RF-C21: update con un id que no es UUID lanza el error de PostgreSQL (SQLSTATE 22P02)', async () => {
    await expect(repository.update(HOSTILE_ID, { completed: true })).rejects.toMatchObject({ code: '22P02' });
  });
});

describe('Repositorio de tareas: remove contra PostgreSQL real', () => {
  it('RF-C18/C19: remove borra la fila y devuelve true; un segundo remove devuelve false', async () => {
    const id = await seed('borrar');
    const other = await seed('queda');
    expect(await repository.remove(id)).toBe(true);
    expect(await readRaw(id)).toBeUndefined();
    expect(await repository.remove(id)).toBe(false);
    expect(await readRaw(other)).toBeDefined();
  });

  it('RF-C19: remove de un id inexistente (incluido el UUID nulo) devuelve false', async () => {
    expect(await repository.remove(NIL_UUID)).toBe(false);
  });

  it('RF-C21: remove con un id que no es UUID lanza el error de PostgreSQL (SQLSTATE 22P02)', async () => {
    await expect(repository.remove(HOSTILE_ID)).rejects.toMatchObject({ code: '22P02' });
  });

  it('RF-C19: 10 remove en Promise.all sobre el mismo id dan exactamente un true y nueve false', async () => {
    const id = await seed('carrera');
    const pool = new Pool({ connectionString: process.env['TEST_DATABASE_URL'] as string, max: 10 });
    try {
      const concurrent = createTaskRepository(asDatabase(pool));
      const results = await Promise.all(Array.from({ length: 10 }, () => concurrent.remove(id)));
      expect(results.filter((result) => result)).toHaveLength(1);
      expect(results.filter((result) => !result)).toHaveLength(9);
      expect(await countRows()).toBe(0);
    } finally {
      await pool.end();
    }
  });
});

describe('Repositorio de tareas: una sola sentencia', () => {
  // Espía sobre una Database real: registra cada texto SQL y delega en el servidor.
  function recordingRepository(): { repository: TaskRepository; statements: string[] } {
    const statements: string[] = [];
    const database: Pick<Database, 'query'> = {
      query: (text: string, values?: unknown[]) => {
        statements.push(text);
        return writer.query(text, values) as never;
      },
    };
    return { repository: createTaskRepository(database), statements };
  }

  it('RF-C19: remove emite una sola sentencia (espía sobre la Database real, sin SELECT)', async () => {
    const id = await seed('t');
    const { repository: spied, statements } = recordingRepository();
    expect(await spied.remove(id)).toBe(true);
    expect(statements).toHaveLength(1);
    expect(statements[0]).not.toMatch(/SELECT/i);
  });

  it('RF-C17: update emite una sola sentencia (espía sobre la Database real, sin SELECT)', async () => {
    const id = await seed('t');
    const { repository: spied, statements } = recordingRepository();
    expect(await spied.update(id, { completed: true })).toMatchObject({ id, completed: true });
    expect(statements).toHaveLength(1);
    expect(statements[0]).not.toMatch(/SELECT/i);
  });
});
