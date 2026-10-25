import type { Client } from 'pg';

export interface Privilege {
  /** Tipo de objeto: database, schema, table o view. */
  kind: string;
  object: string;
  /** Nombre del rol, o PUBLIC. */
  grantee: string;
  privilege: string;
}

// Los objetos con ACL nula (la de por defecto) se completan con acldefault, para que el resultado sea comparable.
const PRIVILEGES_SQL = `
  SELECT kind, object, grantee, privilege FROM (
    SELECT 'database' AS kind, d.datname::text AS object,
           COALESCE(r.rolname, 'PUBLIC')::text AS grantee, a.privilege_type::text AS privilege
    FROM pg_database d
    CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE d.datname = current_database()
    UNION ALL
    SELECT 'schema', n.nspname::text, COALESCE(r.rolname, 'PUBLIC')::text, a.privilege_type::text
    FROM pg_namespace n
    CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'public'
    UNION ALL
    SELECT CASE c.relkind WHEN 'v' THEN 'view' ELSE 'table' END, c.relname::text,
           COALESCE(r.rolname, 'PUBLIC')::text, a.privilege_type::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  ) all_privileges
  ORDER BY kind, object, grantee, privilege`;

/** Conjunto ordenado de privilegios sobre la base actual, el esquema public, sus tablas y sus vistas. */
export async function listPrivileges(client: Client): Promise<Privilege[]> {
  const result = await client.query<Privilege>(PRIVILEGES_SQL);
  return result.rows;
}

/** Lo mismo en texto, `kind:object:grantee:privilege`, listo para comparar con toEqual. */
export async function privilegeSnapshot(client: Client): Promise<string[]> {
  const rows = await listPrivileges(client);
  return rows.map((row) => `${row.kind}:${row.object}:${row.grantee}:${row.privilege}`);
}

/** Nombres de todas las tablas y vistas del esquema public, ordenados. */
export async function listRelations(client: Client): Promise<string[]> {
  const result = await client.query<{ relname: string }>(
    `SELECT c.relname::text AS relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') ORDER BY c.relname`,
  );
  return result.rows.map((row) => row.relname);
}
