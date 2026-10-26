import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/pool';
import { createTaskRepository, type TaskRepository } from '../../src/repositories/task-repository';
import { applySchema, getTestDatabase, resetSchema, truncateTasks } from '../helpers/test-database';

const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

let owner: Client;
let writer: Client;
let repository: TaskRepository;

// Adaptador mínimo: el repositorio solo necesita `query`, así que una conexión directa del rol writer sirve.
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

async function insertAt(title: string, createdAt: string, completed = false): Promise<string> {
  const result = await owner.query<{ id: string }>(
    'INSERT INTO tasks (title, "createdAt", completed) VALUES ($1, $2::timestamptz, $3) RETURNING id',
    [title, createdAt, completed],
  );
  return (result.rows[0] as { id: string }).id;
}

async function insertWithId(id: string, title: string, createdAt: string): Promise<void> {
  await owner.query('INSERT INTO tasks (id, title, "createdAt") VALUES ($1, $2, $3::timestamptz)', [
    id,
    title,
    createdAt,
  ]);
}

describe('Repositorio de tareas contra PostgreSQL real', () => {
  it('RF-C20: createdAt sale en ISO 8601 UTC con milisegundos y Z', async () => {
    await insertAt('a', '2026-03-04 05:06:07.123456+00');
    const [row] = await repository.list(undefined, 1000);
    expect(row?.createdAt).toMatch(ISO_UTC);
    expect(row?.createdAt).toBe('2026-03-04T05:06:07.123Z');
  });

  it('RF-C20: los microsegundos se truncan, no se redondean', async () => {
    await insertAt('a', '2026-03-04 05:06:07.123987+00');
    await insertAt('b', '2026-03-04 05:06:08.123999+00');
    await insertAt('c', '2026-03-04 05:06:09.999999+00');
    const dates = (await repository.list(undefined, 1000)).map((row) => [row.title, row.createdAt]);
    expect(Object.fromEntries(dates)).toEqual({
      a: '2026-03-04T05:06:07.123Z',
      b: '2026-03-04T05:06:08.123Z',
      c: '2026-03-04T05:06:09.999Z',
    });
  });

  it('RF-C14: ordena por createdAt descendente', async () => {
    await insertAt('viejo', '2026-01-01 00:00:00+00');
    await insertAt('nuevo', '2026-01-03 00:00:00+00');
    await insertAt('medio', '2026-01-02 00:00:00+00');
    expect((await repository.list(undefined, 1000)).map((row) => row.title)).toEqual(['nuevo', 'medio', 'viejo']);
  });

  it('RF-C14: con la misma marca desempata por id ascendente', async () => {
    const mark = '2026-01-01 00:00:00.5+00';
    await insertWithId('00000000-0000-4000-8000-00000000000c', 'c', mark);
    await insertWithId('00000000-0000-4000-8000-00000000000a', 'a', mark);
    await insertWithId('00000000-0000-4000-8000-00000000000b', 'b', mark);
    expect((await repository.list(undefined, 1000)).map((row) => row.title)).toEqual(['a', 'b', 'c']);
  });

  it('RF-C14: misma marca al milisegundo y distinta al microsegundo: se ordena por la marca completa', async () => {
    // El id mayor lleva la marca mayor al microsegundo: por marca completa va primero; por texto truncado iría después.
    await insertWithId('00000000-0000-4000-8000-000000000001', 'menor-marca', '2026-01-01 00:00:00.123100+00');
    await insertWithId('00000000-0000-4000-8000-000000000002', 'mayor-marca', '2026-01-01 00:00:00.123900+00');
    const rows = await repository.list(undefined, 1000);
    expect(rows.map((row) => row.title)).toEqual(['mayor-marca', 'menor-marca']);
    expect(rows[0]?.createdAt).toBe(rows[1]?.createdAt);
  });

  // Opción elegida: se ejecuta el mismo SQL del repositorio en una conexión con otra zona horaria de sesión.
  it('RF-C20: la hora mostrada no depende de la zona horaria de la sesión', async () => {
    await insertAt('a', '2026-03-04 05:06:07.123456+00');
    const other = await getTestDatabase().writerClient();
    try {
      await other.query(`SET TIME ZONE 'Asia/Tokyo'`);
      const shown = await other.query<{ tz: string }>("SELECT current_setting('TimeZone') AS tz");
      expect(shown.rows[0]?.tz).toBe('Asia/Tokyo');
      const [row] = await createTaskRepository(asDatabase(other)).list(undefined, 1000);
      expect(row?.createdAt).toBe('2026-03-04T05:06:07.123Z');
    } finally {
      await other.end();
    }
  });

  it('RF-C14: insert devuelve la fila creada con completed falso y exactamente las cinco columnas', async () => {
    const row = await repository.insert({ title: 'nueva', description: 'detalle' });
    expect(Object.keys(row).sort()).toEqual(['completed', 'createdAt', 'description', 'id', 'title']);
    expect(row).toMatchObject({ title: 'nueva', description: 'detalle', completed: false });
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(row.createdAt).toMatch(ISO_UTC);
  });

  it('RF-C21: se permiten títulos duplicados', async () => {
    const first = await repository.insert({ title: 'igual', description: '' });
    const second = await repository.insert({ title: 'igual', description: '' });
    expect(first.id).not.toBe(second.id);
    expect(await repository.list(undefined, 1000)).toHaveLength(2);
  });

  it(`RF-C21: un título con '); DROP TABLE tasks;-- se guarda literal y la tabla sigue intacta`, async () => {
    const hostile = `'); DROP TABLE tasks;--`;
    await repository.insert({ title: hostile, description: hostile });
    const rows = await repository.list(undefined, 1000);
    expect(rows.map((row) => [row.title, row.description])).toEqual([[hostile, hostile]]);
    const exists = await owner.query<{ found: boolean }>(`SELECT to_regclass('public.tasks') IS NOT NULL AS found`);
    expect(exists.rows[0]?.found).toBe(true);
  });

  it('RF-C21: list con filtro devuelve solo completadas o solo pendientes', async () => {
    await insertAt('hecha', '2026-01-01 00:00:00+00', true);
    await insertAt('pendiente', '2026-01-02 00:00:00+00', false);
    expect((await repository.list(true, 1000)).map((row) => row.title)).toEqual(['hecha']);
    expect((await repository.list(false, 1000)).map((row) => row.title)).toEqual(['pendiente']);
    expect(await repository.list(undefined, 1000)).toHaveLength(2);
  });
});
