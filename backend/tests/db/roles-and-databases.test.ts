import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { getTestDatabase } from '../helpers/test-database';

const ROLES = ['owner', 'writer', 'reader'];

function databaseNames(): string[] {
  const names = [process.env['DB_NAME'], process.env['DB_NAME_TEST']];
  if (names.some((name) => name === undefined || name === '')) {
    throw new Error('Faltan DB_NAME o DB_NAME_TEST en el entorno: copie .env.example a .env en la raíz.');
  }
  return names as string[];
}

describe('RF-D16 (i): roles y bases creados por el script de inicio', () => {
  let client: Client;

  beforeAll(async () => {
    client = await getTestDatabase().ownerClient();
  });

  afterAll(async () => {
    await client.end();
  });

  it('RF-D16 (i): los tres roles existen, pueden iniciar sesión y no tienen atributos privilegiados', async () => {
    const result = await client.query<{
      rolname: string;
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
         FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname`,
      [ROLES],
    );
    expect(result.rows.map((row) => row.rolname)).toEqual(['owner', 'reader', 'writer']);
    for (const row of result.rows) {
      expect(row.rolcanlogin).toBe(true);
      expect(row.rolsuper).toBe(false);
      expect(row.rolcreatedb).toBe(false);
      expect(row.rolcreaterole).toBe(false);
      expect(row.rolreplication).toBe(false);
      expect(row.rolbypassrls).toBe(false);
    }
  });

  it('RF-D16 (i): ningún rol es miembro de otro, en ninguno de los dos sentidos', async () => {
    const asMember = await client.query(
      `SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = ANY($1)`,
      [ROLES],
    );
    const asGroup = await client.query(
      `SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE r.rolname = ANY($1)`,
      [ROLES],
    );
    expect(asMember.rowCount).toBe(0);
    expect(asGroup.rowCount).toBe(0);
  });

  it('RF-D16 (i): las dos bases existen, son de owner y están codificadas en UTF8', async () => {
    const names = databaseNames();
    const result = await client.query<{ datname: string; owner: string; encoding: string }>(
      `SELECT datname, pg_get_userbyid(datdba) AS owner, pg_encoding_to_char(encoding) AS encoding
         FROM pg_database WHERE datname = ANY($1) ORDER BY datname`,
      [names],
    );
    expect(result.rows.map((row) => row.datname)).toEqual([...names].sort());
    for (const row of result.rows) {
      expect(row.owner).toBe('owner');
      expect(row.encoding).toBe('UTF8');
    }
  });
});
