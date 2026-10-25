import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  applyPermissions,
  migrateAndGrant,
  readPermissionsSql,
  runDeployCommand,
  runPrismaMigrateDeploy,
} from '../../src/db/migrate';
import { createCaptureLogger } from '../helpers/capture-logger';
import { listPrivileges, listRelations, privilegeSnapshot } from '../helpers/privileges';
import { applySchema, getTestDatabase, resetSchema } from '../helpers/test-database';

const ownerUrl = (): string => process.env['TEST_OWNER_DATABASE_URL'] ?? '';
const quietMigrations = (url: string): Promise<number> => runPrismaMigrateDeploy(url, () => undefined);

async function snapshot(): Promise<string[]> {
  const owner = await getTestDatabase().ownerClient();
  try {
    return await privilegeSnapshot(owner);
  } finally {
    await owner.end();
  }
}

async function ownerQuery(sql: string): Promise<void> {
  const owner = await getTestDatabase().ownerClient();
  try {
    await owner.query(sql);
  } finally {
    await owner.end();
  }
}

beforeAll(async () => {
  await resetSchema();
  await applySchema();
});

afterAll(async () => {
  // Deja la base de pruebas con el estado final correcto para el siguiente archivo.
  await resetSchema();
  await applySchema();
});

describe('RF-D14 (0): atomicidad del script de permisos', () => {
  it('RF-D14 (0): una sentencia que falla a mitad no deja ningún cambio parcial', async () => {
    const before = await snapshot();
    const failing = `
      BEGIN;
      GRANT SELECT ON TABLE tasks TO reader;
      REVOKE ALL ON TABLE tasks FROM writer;
      SELECT 1 / 0;
      GRANT SELECT ON TABLE task_counts TO writer;
      COMMIT;`;
    await expect(applyPermissions(ownerUrl(), failing)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });
});

describe('RF-D14 (i): idempotencia', () => {
  it('RF-D14 (i): dos ejecuciones del comando terminan en 0 y dejan exactamente los mismos privilegios', async () => {
    const before = await snapshot();
    expect(before.length).toBeGreaterThan(0);
    const sql = readPermissionsSql();
    for (let run = 0; run < 2; run += 1) {
      const capture = createCaptureLogger();
      const code = await migrateAndGrant({
        ownerUrl: ownerUrl(),
        runMigrations: quietMigrations,
        permissionsSql: sql,
        logger: capture.logger,
      });
      expect(code).toBe(0);
      expect(await snapshot()).toEqual(before);
    }
  });

  it('RF-D14 (i): el comando completo (runDeployCommand) con la URL de owner termina en 0', async () => {
    const capture = createCaptureLogger();
    const code = await runDeployCommand({ OWNER_DATABASE_URL: ownerUrl() }, capture.logger, {
      runMigrations: quietMigrations,
    });
    expect(code).toBe(0);
    expect(capture.output()).toContain('permissions_applied');
    expect(capture.output()).not.toContain(ownerUrl());
  });
});

describe('RF-D14 (ii): el catálogo recorre todas las tablas y vistas de public', () => {
  it('RF-D14 (ii): writer y reader tienen exactamente lo de RF-D12/D13 y nada sobre otro objeto', async () => {
    const owner = await getTestDatabase().ownerClient();
    try {
      const relations = await listRelations(owner);
      expect(relations).toEqual(['_prisma_migrations', 'task_counts', 'tasks']);
      const all = await listPrivileges(owner);
      const onRelations = all.filter((row) => row.kind === 'table' || row.kind === 'view');
      const granted = (grantee: string): string[] =>
        onRelations
          .filter((row) => row.grantee === grantee)
          .map((row) => `${row.object}:${row.privilege}`)
          .sort();
      expect(granted('writer')).toEqual(['tasks:DELETE', 'tasks:INSERT', 'tasks:SELECT', 'tasks:UPDATE']);
      expect(granted('reader')).toEqual(['task_counts:SELECT']);
      expect(granted('PUBLIC')).toEqual([]);
      for (const row of onRelations.filter((entry) => entry.object === '_prisma_migrations')) {
        expect(row.grantee).toBe('owner');
      }
    } finally {
      await owner.end();
    }
  });
});

describe('RF-D14 (iii): un fallo de migración impide aplicar los permisos', () => {
  it('RF-D14 (iii): con contraseña errónea devuelve un código distinto de cero y no toca los privilegios', async () => {
    // Se provoca una desviación a mano: si los permisos se aplicaran, desaparecería.
    await ownerQuery('GRANT SELECT ON TABLE tasks TO reader');
    try {
      const drifted = await snapshot();
      const badUrl = new URL(ownerUrl());
      badUrl.password = 'contrasena-erronea-7';
      const capture = createCaptureLogger();
      const apply = vi.fn(applyPermissions);
      const code = await migrateAndGrant({
        ownerUrl: badUrl.toString(),
        runMigrations: quietMigrations,
        apply,
        permissionsSql: readPermissionsSql(),
        logger: capture.logger,
      });
      expect(code).not.toBe(0);
      expect(apply).not.toHaveBeenCalled();
      expect(capture.output()).toContain('migration_failed');
      expect(capture.output()).not.toContain('contrasena-erronea-7');
      expect(await snapshot()).toEqual(drifted);
    } finally {
      await ownerQuery('REVOKE SELECT ON TABLE tasks FROM reader');
    }
  });
});
