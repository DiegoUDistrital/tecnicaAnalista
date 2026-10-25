import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyPermissions,
  migrateAndGrant,
  readPermissionsSql,
  runDeployCommand,
  runPrismaMigrateDeploy,
} from '../../src/db/migrate';
import type { Logger } from '../../src/logging/logger';
import { createCaptureLogger } from '../helpers/capture-logger';

const OWNER_URL = 'postgresql://owner:sentinel-pw-9@127.0.0.1:5433/todo_app';
const SQL = 'BEGIN; COMMIT;';

describe('RF-D14: migrateAndGrant (con dobles)', () => {
  it('RF-D14: si la migración falla no llama a apply y devuelve el código de la migración', async () => {
    const capture = createCaptureLogger();
    const apply = vi.fn().mockResolvedValue(undefined);
    const code = await migrateAndGrant({
      ownerUrl: OWNER_URL,
      runMigrations: vi.fn().mockResolvedValue(3),
      apply,
      permissionsSql: SQL,
      logger: capture.logger,
    });
    expect(code).toBe(3);
    expect(apply).not.toHaveBeenCalled();
    expect(capture.records()).toMatchObject([{ level: 'error', event: 'migration_failed', exitCode: 3 }]);
  });

  it('RF-D14: si la migración lanza una excepción devuelve 1 y no llama a apply', async () => {
    const capture = createCaptureLogger();
    const apply = vi.fn().mockResolvedValue(undefined);
    const code = await migrateAndGrant({
      ownerUrl: OWNER_URL,
      runMigrations: vi.fn().mockRejectedValue(new Error(`no arranca ${OWNER_URL}`)),
      apply,
      permissionsSql: SQL,
      logger: capture.logger,
    });
    expect(code).toBe(1);
    expect(apply).not.toHaveBeenCalled();
    expect(capture.output()).toContain('migration_failed');
    expect(capture.output()).not.toContain('sentinel-pw-9');
  });

  it('RF-D14: si apply falla devuelve un código distinto de cero y no registra datos del error', async () => {
    const capture = createCaptureLogger();
    const code = await migrateAndGrant({
      ownerUrl: OWNER_URL,
      runMigrations: vi.fn().mockResolvedValue(0),
      apply: vi.fn().mockRejectedValue(new Error(`fallo con ${OWNER_URL}`)),
      permissionsSql: SQL,
      logger: capture.logger,
    });
    expect(code).not.toBe(0);
    expect(capture.records()).toMatchObject([{ level: 'error', event: 'permissions_failed' }]);
    expect(capture.output()).not.toContain('sentinel-pw-9');
  });

  it('RF-D14: si todo va bien aplica los permisos con la URL y el SQL recibidos y devuelve 0', async () => {
    const capture = createCaptureLogger();
    const apply = vi.fn().mockResolvedValue(undefined);
    const runMigrations = vi.fn().mockResolvedValue(0);
    const code = await migrateAndGrant({
      ownerUrl: OWNER_URL,
      runMigrations,
      apply,
      permissionsSql: SQL,
      logger: capture.logger,
    });
    expect(code).toBe(0);
    expect(runMigrations).toHaveBeenCalledWith(OWNER_URL);
    expect(apply).toHaveBeenCalledWith(OWNER_URL, SQL);
    expect(capture.records()).toMatchObject([{ level: 'info', event: 'permissions_applied' }]);
  });
});

describe('RF-D14: runDeployCommand', () => {
  it.each([[{}], [{ OWNER_DATABASE_URL: '' }]])(
    'RF-D14: falla sin valor si falta OWNER_DATABASE_URL (%j)',
    async (env) => {
      const capture = createCaptureLogger();
      const run = vi.fn().mockResolvedValue(0);
      const code = await runDeployCommand(env, capture.logger, { run, readPermissions: () => SQL });
      expect(code).toBe(1);
      expect(run).not.toHaveBeenCalled();
      expect(capture.records()).toMatchObject([{ level: 'error', event: 'owner_database_url_missing' }]);
    },
  );

  it('RF-D14: con la variable definida lee el script y llama a migrateAndGrant', async () => {
    const capture = createCaptureLogger();
    const run = vi.fn().mockResolvedValue(0);
    const code = await runDeployCommand({ OWNER_DATABASE_URL: OWNER_URL }, capture.logger, {
      run,
      readPermissions: () => SQL,
    });
    expect(code).toBe(0);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ ownerUrl: OWNER_URL, permissionsSql: SQL }));
  });

  it('RF-D14: devuelve el código que devuelve migrateAndGrant', async () => {
    const run = vi.fn().mockResolvedValue(4);
    const code = await runDeployCommand({ OWNER_DATABASE_URL: OWNER_URL }, createCaptureLogger().logger, {
      run,
      readPermissions: () => SQL,
    });
    expect(code).toBe(4);
  });

  it('RF-D14: si no puede leer el script devuelve 1 sin llamar a migrateAndGrant', async () => {
    const capture = createCaptureLogger();
    const run = vi.fn().mockResolvedValue(0);
    const code = await runDeployCommand({ OWNER_DATABASE_URL: OWNER_URL }, capture.logger, {
      run,
      readPermissions: () => {
        throw new Error('no existe');
      },
    });
    expect(code).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(capture.records()).toMatchObject([{ event: 'permissions_file_unreadable' }]);
  });
});

describe('RF-D14: lectura del script y ejecución real', () => {
  it('RF-D14: readPermissionsSql lee prisma/permissions.sql', () => {
    expect(readPermissionsSql()).toMatch(/\bBEGIN;/);
  });

  it('RF-D14: applyPermissions rechaza si no puede conectar', async () => {
    await expect(applyPermissions('postgresql://owner:x@127.0.0.1:1/none', SQL)).rejects.toThrow();
  });

  it('RF-D14: runPrismaMigrateDeploy devuelve el código del CLI (conexión imposible: distinto de cero)', async () => {
    const chunks: string[] = [];
    const code = await runPrismaMigrateDeploy('postgresql://owner:x@127.0.0.1:1/none', (text) => chunks.push(text));
    expect(code).not.toBe(0);
  });
});

describe('RF-D14: migrate-cli', () => {
  afterEach(() => {
    vi.doUnmock('../../src/db/migrate');
    vi.resetModules();
  });

  it('RF-D14: al importarlo ejecuta runDeployCommand con el proceso real y fija process.exitCode', async () => {
    const previous = process.exitCode;
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const runDeployCommandMock = vi.fn((_env: unknown, logger: Logger) => {
      logger.info('probe');
      return Promise.resolve(7);
    });
    vi.resetModules();
    vi.doMock('../../src/db/migrate', () => ({ runDeployCommand: runDeployCommandMock }));
    try {
      await import('../../src/db/migrate-cli.js');
      await vi.waitFor(() => {
        expect(process.exitCode).toBe(7);
      });
      expect(runDeployCommandMock).toHaveBeenCalledWith(process.env, expect.anything());
      expect(write).toHaveBeenCalledWith(expect.stringContaining('"event":"probe"'));
    } finally {
      process.exitCode = previous;
      write.mockRestore();
    }
  });
});
