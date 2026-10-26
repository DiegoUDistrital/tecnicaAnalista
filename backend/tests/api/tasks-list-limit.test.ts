import type { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApiApp, type ApiApp } from '../helpers/api-app';
import { getTestDatabase, truncateTasks } from '../helpers/test-database';

const FIVE_FIELDS = ['id', 'title', 'description', 'completed', 'createdAt'];

let api: ApiApp;
let owner: Client;

beforeAll(async () => {
  api = await startApiApp({ tasks: { listLimit: 3 } });
  owner = await getTestDatabase().ownerClient();
});

beforeEach(async () => {
  await truncateTasks();
});

afterAll(async () => {
  await owner.end();
  await api.close();
});

/** Inserta `t1`...`tN` con fechas crecientes; las pares quedan completadas. */
async function seed(count: number): Promise<void> {
  for (let n = 1; n <= count; n += 1) {
    await owner.query('INSERT INTO tasks (title, "createdAt", completed) VALUES ($1, $2::timestamptz, $3)', [
      `t${String(n)}`,
      `2026-01-01 00:00:${String(n).padStart(2, '0')}+00`,
      n % 2 === 0,
    ]);
  }
}

describe('RF-G17: tope de GET /api/tasks', () => {
  it('RF-G17: con tope 3 y 5 tareas GET devuelve 3, arreglo de cinco campos, sin ETag ni cabeceras', async () => {
    const empty = await request(api.app).get('/api/tasks');
    await seed(5);

    const res = await request(api.app).get('/api/tasks');

    expect(res.status).toBe(200);
    const tasks = res.body as Record<string, unknown>[];
    expect(Array.isArray(res.body)).toBe(true);
    expect(tasks.map((task) => task['title'])).toEqual(['t5', 't4', 't3']);
    for (const task of tasks) {
      expect(Object.keys(task)).toEqual(FIVE_FIELDS);
    }
    expect(res.headers['etag']).toBeUndefined();
    expect(Object.keys(res.headers).sort()).toEqual(Object.keys(empty.headers).sort());
  });
});
