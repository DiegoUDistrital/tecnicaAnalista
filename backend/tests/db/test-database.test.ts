import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTestDatabase, resetSchema, truncateTasks } from '../helpers/test-database';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('RNF-4: helper de la base de pruebas', () => {
  it('RNF-4: se conecta con las tres URL y current_user coincide con cada rol', async () => {
    const database = getTestDatabase();
    const connections = [
      ['owner', await database.ownerClient()],
      ['writer', await database.writerClient()],
      ['reader', await database.readerClient()],
    ] as const;
    try {
      for (const [role, client] of connections) {
        const result = await client.query<{ current_user: string }>('SELECT current_user');
        expect(result.rows[0]?.current_user).toBe(role);
      }
    } finally {
      await Promise.all(connections.map(([, client]) => client.end()));
    }
  });

  it('RNF-4: resetSchema deja el esquema public sin tablas', async () => {
    const owner = await getTestDatabase().ownerClient();
    try {
      await owner.query('CREATE TABLE public.reset_probe (id int)');
      await resetSchema();
      const tables = await owner.query(`SELECT 1 FROM pg_tables WHERE schemaname = 'public'`);
      expect(tables.rowCount).toBe(0);
      const schema = await owner.query<{ owner: string }>(
        `SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'public'`,
      );
      expect(schema.rows[0]?.owner).toBe('pg_database_owner');
    } finally {
      await owner.end();
    }
  });

  it('RNF-4: truncateTasks no falla si la tabla tasks aún no existe y vacía la tabla si existe', async () => {
    await resetSchema();
    await expect(truncateTasks()).resolves.toBeUndefined();
    const owner = await getTestDatabase().ownerClient();
    try {
      await owner.query('CREATE TABLE public.tasks (title text)');
      await owner.query(`INSERT INTO public.tasks VALUES ('a')`);
      await truncateTasks();
      const rows = await owner.query('SELECT 1 FROM public.tasks');
      expect(rows.rowCount).toBe(0);
    } finally {
      await resetSchema();
      await owner.end();
    }
  });

  it('RNF-4: falla con un mensaje que nombra la variable (sin URL) si falta una URL TEST_*', () => {
    vi.stubEnv('TEST_READER_DATABASE_URL', '');
    expect(() => getTestDatabase()).toThrowError(/TEST_READER_DATABASE_URL/);
    vi.stubEnv('TEST_READER_DATABASE_URL', undefined);
    expect(() => getTestDatabase()).toThrowError(/TEST_READER_DATABASE_URL/);
  });

  it('RNF-4: falla con un mensaje fijo sin URL si no hay conexión', async () => {
    const closed = 'postgresql://owner:sentinel-pw-3@127.0.0.1:1/todo_app_test';
    vi.stubEnv('TEST_OWNER_DATABASE_URL', closed);
    vi.stubEnv('TEST_DATABASE_URL', closed.replace('owner', 'writer'));
    vi.stubEnv('TEST_READER_DATABASE_URL', closed.replace('owner', 'reader'));
    const attempt = getTestDatabase().ownerClient();
    await expect(attempt).rejects.toThrowError(/No se pudo conectar/);
    await expect(attempt).rejects.not.toThrowError(/sentinel-pw-3|127\.0\.0\.1/);
  });
});
