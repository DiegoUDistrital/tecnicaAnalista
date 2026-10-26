import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listPrivileges, type Privilege } from '../helpers/privileges';
import { applySchema, getTestDatabase, resetSchema, truncateTasks } from '../helpers/test-database';

let owner: Client;
let writer: Client;
let reader: Client;

/** SQLSTATE del error que produce la sentencia, o undefined si se ejecuta sin error. */
async function sqlstateOf(client: Client, sql: string, values?: unknown[]): Promise<string | undefined> {
  try {
    await client.query(sql, values);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

const privilegesOf = (all: Privilege[], grantee: string, kinds: string[]): string[] =>
  all
    .filter((row) => row.grantee === grantee && kinds.includes(row.kind))
    .map((row) => `${row.kind}:${row.object}:${row.privilege}`);

beforeAll(async () => {
  await resetSchema();
  await applySchema();
  const database = getTestDatabase();
  owner = await database.ownerClient();
  writer = await database.writerClient();
  reader = await database.readerClient();
});

beforeEach(async () => {
  await truncateTasks();
});

afterAll(async () => {
  await Promise.all([owner.end(), writer.end(), reader.end()]);
});

describe('RF-D11: estado final en la base, el esquema y los privilegios por defecto', () => {
  it('RF-D11: PUBLIC no tiene ningún privilegio en la base ni en el esquema public', async () => {
    const all = await listPrivileges(owner);
    expect(privilegesOf(all, 'PUBLIC', ['database', 'schema'])).toEqual([]);
  });

  it('RF-D11: writer y reader tienen CONNECT en la base y USAGE en public, y nada más', async () => {
    const all = await listPrivileges(owner);
    const database = all.find((row) => row.kind === 'database')?.object ?? '';
    expect(database).not.toBe('');
    for (const role of ['writer', 'reader']) {
      expect(privilegesOf(all, role, ['database', 'schema'])).toEqual([
        `database:${database}:CONNECT`,
        'schema:public:USAGE',
      ]);
    }
  });

  it('RF-D11: pg_default_acl no tiene entradas para writer, reader ni PUBLIC', async () => {
    const result = await owner.query<{ grantee: string }>(
      `SELECT COALESCE(r.rolname, 'PUBLIC')::text AS grantee
       FROM pg_default_acl d
       CROSS JOIN LATERAL aclexplode(d.defaclacl) a
       LEFT JOIN pg_roles r ON r.oid = a.grantee`,
    );
    const grantees = result.rows.map((row) => row.grantee);
    expect(grantees).not.toContain('PUBLIC');
    expect(grantees).not.toContain('writer');
    expect(grantees).not.toContain('reader');
  });

  it('RF-D11: una tabla y una función nuevas de owner no son accesibles para writer ni reader', async () => {
    try {
      await owner.query('CREATE TABLE public.rf_d11_probe (id int)');
      await owner.query("CREATE FUNCTION public.rf_d11_probe_fn() RETURNS int LANGUAGE sql AS 'SELECT 1'");
      // La función nueva no es ejecutable por PUBLIC (efecto del privilegio por defecto revocado).
      const publicExecute = await owner.query(
        `SELECT 1 FROM pg_proc p
         CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
         WHERE p.proname = 'rf_d11_probe_fn' AND a.grantee = 0`,
      );
      expect(publicExecute.rowCount).toBe(0);
      for (const client of [writer, reader]) {
        expect(await sqlstateOf(client, 'SELECT * FROM public.rf_d11_probe')).toBe('42501');
        expect(await sqlstateOf(client, 'SELECT public.rf_d11_probe_fn()')).toBe('42501');
      }
    } finally {
      await owner.query('DROP FUNCTION IF EXISTS public.rf_d11_probe_fn()');
      await owner.query('DROP TABLE IF EXISTS public.rf_d11_probe');
    }
  });
});

describe('RF-D12: permisos de writer', () => {
  it.each([
    ['leer task_counts', 'SELECT * FROM task_counts'],
    ['leer _prisma_migrations', 'SELECT * FROM _prisma_migrations'],
    ['CREATE TABLE', 'CREATE TABLE rf_d12_probe (id int)'],
    ['CREATE TEMP TABLE', 'CREATE TEMP TABLE rf_d12_probe (id int)'],
    ['ALTER TABLE tasks', 'ALTER TABLE tasks ADD COLUMN rf_d12_probe int'],
    ['DROP TABLE tasks', 'DROP TABLE tasks'],
    ['TRUNCATE tasks', 'TRUNCATE tasks'],
    ['CREATE INDEX', 'CREATE INDEX rf_d12_probe_idx ON tasks (title)'],
    ['DROP VIEW task_counts', 'DROP VIEW task_counts'],
  ])('RF-D12: writer no puede %s (42501)', async (_name, sql) => {
    expect(await sqlstateOf(writer, sql)).toBe('42501');
  });
});

describe('RF-D13: permisos de reader', () => {
  it('RF-D13: reader lee task_counts', async () => {
    await owner.query("INSERT INTO tasks (title, completed) VALUES ('a', true), ('b', true), ('c', false)");
    const result = await reader.query('SELECT completed, total FROM task_counts ORDER BY completed');
    expect(result.rows).toEqual([
      { completed: false, total: 1 },
      { completed: true, total: 2 },
    ]);
  });

  it.each([
    ['leer tasks', 'SELECT * FROM tasks'],
    ['insertar en tasks', "INSERT INTO tasks (title) VALUES ('x')"],
    ['actualizar tasks', 'UPDATE tasks SET completed = true'],
    ['borrar de tasks', 'DELETE FROM tasks'],
    ['leer _prisma_migrations', 'SELECT * FROM _prisma_migrations'],
    ['CREATE TABLE', 'CREATE TABLE rf_d13_probe (id int)'],
    ['CREATE TEMP TABLE', 'CREATE TEMP TABLE rf_d13_probe (id int)'],
    ['ALTER TABLE tasks', 'ALTER TABLE tasks ADD COLUMN rf_d13_probe int'],
    ['DROP TABLE tasks', 'DROP TABLE tasks'],
    ['DROP VIEW task_counts', 'DROP VIEW task_counts'],
  ])('RF-D13: reader no puede %s (42501)', async (_name, sql) => {
    expect(await sqlstateOf(reader, sql)).toBe('42501');
  });
});

describe('RF-D17: la consulta 1 con los permisos reales', () => {
  it('RF-D17: la consulta 1 de queries.sql funciona con el rol writer', async () => {
    const text = readFileSync(resolve(__dirname, '..', '..', 'queries.sql'), 'utf8');
    const body = text.split(/^-- Consulta 1:/m)[1]?.split(/^-- Consulta 2:/m)[0] ?? '';
    const sql = body
      .split('\n')
      .slice(1)
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim()
      .replace(/;$/, '');
    await owner.query(
      `INSERT INTO tasks (title, completed, "createdAt") VALUES
       ('vieja', true, '2026-01-01T00:00:00Z'), ('nueva', true, '2026-01-02T00:00:00Z'),
       ('pendiente', false, '2026-01-03T00:00:00Z')`,
    );
    const done = await writer.query<{ title: string }>(sql, [true]);
    expect(done.rows.map((row) => row.title)).toEqual(['nueva', 'vieja']);
    const pending = await writer.query<{ title: string }>(sql, [false]);
    expect(pending.rows.map((row) => row.title)).toEqual(['pendiente']);
  });
});
