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

async function insert(title: string, description?: string): Promise<void> {
  if (description === undefined) {
    await owner.query('INSERT INTO tasks (title) VALUES ($1)', [title]);
  } else {
    await owner.query('INSERT INTO tasks (title, description) VALUES ($1, $2)', [title, description]);
  }
}

async function sqlstateOf(action: Promise<void>): Promise<string | undefined> {
  try {
    await action;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe('RF-D7: restricciones de la tabla tasks', () => {
  it('RF-D7: un título solo de espacios U+0020 se rechaza con 23514', async () => {
    expect(await sqlstateOf(insert('   '))).toBe('23514');
  });

  it('RF-D7: un título vacío se rechaza con 23514', async () => {
    expect(await sqlstateOf(insert(''))).toBe('23514');
  });

  it('RF-D7: un título de 101 caracteres se rechaza y uno de 100 se acepta', async () => {
    expect(await sqlstateOf(insert('a'.repeat(101)))).toBe('23514');
    expect(await sqlstateOf(insert('a'.repeat(100)))).toBeUndefined();
  });

  it('RF-D7: una descripción de 501 caracteres se rechaza y una de 500 se acepta', async () => {
    expect(await sqlstateOf(insert('t', 'a'.repeat(501)))).toBe('23514');
    expect(await sqlstateOf(insert('t', 'a'.repeat(500)))).toBeUndefined();
  });

  it('RF-D7: 100 emojis de un solo punto de código se aceptan y 101 se rechazan', async () => {
    expect(await sqlstateOf(insert('\u{1F600}'.repeat(100)))).toBeUndefined();
    expect(await sqlstateOf(insert('\u{1F600}'.repeat(101)))).toBe('23514');
  });

  it('RF-D7: una «e» con acento combinante cuenta como 2 caracteres', async () => {
    const combined = 'é';
    expect(await sqlstateOf(insert(combined.repeat(50)))).toBeUndefined();
    expect(await sqlstateOf(insert(combined.repeat(51)))).toBe('23514');
  });

  it('RF-D7: un título de solo U+00A0 se acepta (defensa en profundidad, no es espacio U+0020)', async () => {
    expect(await sqlstateOf(insert('  '))).toBeUndefined();
  });

  it('RF-D7: una inserción mínima obtiene id UUID, descripción vacía, completed false y createdAt', async () => {
    await insert('mínima');
    const result = await owner.query<{ id: string; description: string; completed: boolean; createdAt: Date | null }>(
      'SELECT id, description, completed, "createdAt" FROM tasks',
    );
    const row = result.rows[0];
    expect(row?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(row?.description).toBe('');
    expect(row?.completed).toBe(false);
    expect(row?.createdAt).toBeInstanceOf(Date);

    const window = await owner.query<{ recent: boolean }>(
      `SELECT abs(extract(epoch FROM (now() - "createdAt"))) < 60 AS recent FROM tasks`,
    );
    expect(window.rows[0]?.recent).toBe(true);
  });
});
