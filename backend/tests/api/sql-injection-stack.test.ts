import type { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApiApp, type ApiApp } from '../helpers/api-app';
import { getTestDatabase, truncateTasks } from '../helpers/test-database';

// Pila completa (Express, validación, repositorio y PostgreSQL real) con la key válida que inyecta el ayudante.
// Caracterización de la 005: estas pruebas nacen en verde; su fuerza está en las mutaciones de control.
const INJECTED_TITLE = "'); DROP TABLE tasks;--";
const INJECTED_DESCRIPTION = "x'; DELETE FROM tasks;--";
const HOSTILE_ID = "' OR 1=1";
const HOSTILE_COMPLETED = "true' OR '1'='1";
const UUID = '3f1c2d5e-8a0b-4c7d-9e1f-0a2b3c4d5e6f';

let api: ApiApp;
let owner: Client;

beforeAll(async () => {
  api = await startApiApp();
  owner = await getTestDatabase().ownerClient();
});

beforeEach(async () => {
  await truncateTasks();
});

afterAll(async () => {
  await owner.end();
  await api.close();
});

/** Inserta una tarea directamente (rol owner) para comprobar después que la tabla no cambia. */
async function seed(title: string): Promise<void> {
  await owner.query('INSERT INTO tasks (id, title) VALUES ($1, $2)', [UUID, title]);
}

async function storedTitles(): Promise<string[]> {
  const result = await owner.query<{ title: string }>('SELECT title FROM tasks ORDER BY title');
  return result.rows.map((row) => row.title);
}

async function tableExists(): Promise<boolean> {
  const result = await owner.query<{ found: boolean }>(`SELECT to_regclass('public.tasks') IS NOT NULL AS found`);
  return result.rows[0]?.found === true;
}

describe('RF-G19: inyección SQL con la pila completa y key válida', () => {
  it("RF-G19: título '); DROP TABLE tasks;-- se guarda literal (201) y la tabla queda intacta", async () => {
    await seed('existente');

    const created = await request(api.app)
      .post('/api/tasks')
      .send({ title: INJECTED_TITLE, description: INJECTED_DESCRIPTION });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ title: INJECTED_TITLE, description: INJECTED_DESCRIPTION });
    expect(await tableExists()).toBe(true);
    expect(await storedTitles()).toHaveLength(2);
    expect(await storedTitles()).toContain('existente');
    expect(await storedTitles()).toContain(INJECTED_TITLE);
    const listed = await request(api.app).get('/api/tasks');
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual(expect.arrayContaining([expect.objectContaining({ title: INJECTED_TITLE })]));
  });

  it("RF-G19: ?completed=true' OR '1'='1 da 400 y no devuelve ninguna tarea", async () => {
    await seed('existente');

    const res = await request(api.app).get(`/api/tasks?completed=${encodeURIComponent(HOSTILE_COMPLETED)}`);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(res.text).not.toContain('existente');
    expect(await storedTitles()).toEqual(['existente']);
  });

  it.each([
    ['DELETE', (path: string) => request(api.app).delete(path)],
    ['PUT', (path: string) => request(api.app).put(path).send({ completed: true })],
  ])("RF-G19: %s con id ' OR 1=1 da 400 y la tabla queda intacta", async (_method, send) => {
    await seed('existente');

    const res = await send(`/api/tasks/${encodeURIComponent(HOSTILE_ID)}`);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(await storedTitles()).toEqual(['existente']);
  });
});
