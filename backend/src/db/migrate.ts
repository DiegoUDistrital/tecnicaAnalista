import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import type { Logger } from '../logging/logger';

// Raíz del paquete backend. Desde src/db (tests) y desde dist/db (compilado) son dos niveles hacia arriba,
// así que prisma/permissions.sql se localiza igual en ambos casos y no hay que copiarlo a dist.
const PACKAGE_ROOT = resolve(__dirname, '..', '..');

/** Lee el script de permisos versionado (`prisma/permissions.sql`). */
export function readPermissionsSql(): string {
  return readFileSync(resolve(PACKAGE_ROOT, 'prisma', 'permissions.sql'), 'utf8');
}

/**
 * Lanza `prisma migrate deploy` como proceso hijo, sin shell, y devuelve su código de salida.
 * La URL de owner viaja solo en el entorno del hijo (OWNER_DATABASE_URL), nunca por argumento.
 * La salida del CLI (que no incluye contraseñas) se entrega a `output`.
 */
export function runPrismaMigrateDeploy(
  ownerUrl: string,
  output: (text: string) => void = (text) => process.stdout.write(text),
): Promise<number> {
  return new Promise((resolveCode, reject) => {
    const cli = require.resolve('prisma/build/index.js');
    const child = spawn(process.execPath, [cli, 'migrate', 'deploy'], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, OWNER_DATABASE_URL: ownerUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8').on('data', output);
    child.stderr.setEncoding('utf8').on('data', output);
    child.once('error', reject);
    child.once('close', (code) => {
      resolveCode(code ?? 1);
    });
  });
}

/**
 * Ejecuta el script de permisos con el rol owner. `client.query(sql)` sin parámetros usa el protocolo simple,
 * que acepta varias sentencias. Si una falla, la sesión se cierra y PostgreSQL deshace la transacción.
 */
export async function applyPermissions(ownerUrl: string, sqlText: string): Promise<void> {
  const client = new Client({ connectionString: ownerUrl });
  try {
    await client.connect();
    await client.query(sqlText);
  } finally {
    await client.end();
  }
}

export interface MigrateAndGrantOptions {
  ownerUrl: string;
  runMigrations?: (ownerUrl: string) => Promise<number>;
  apply?: (ownerUrl: string, sqlText: string) => Promise<void>;
  permissionsSql: string;
  logger: Logger;
}

/**
 * Migra y, solo si la migración termina bien, aplica los permisos.
 * Devuelve 0 si todo va bien o un código distinto de cero si algo falla.
 */
export async function migrateAndGrant(options: MigrateAndGrantOptions): Promise<number> {
  const {
    ownerUrl,
    runMigrations = runPrismaMigrateDeploy,
    apply = applyPermissions,
    permissionsSql,
    logger,
  } = options;

  let code: number;
  try {
    code = await runMigrations(ownerUrl);
  } catch (error) {
    logger.error('migration_failed', { thrown: error });
    return 1;
  }
  if (code !== 0) {
    logger.error('migration_failed', { context: { exitCode: code } });
    return code;
  }

  try {
    await apply(ownerUrl, permissionsSql);
  } catch (error) {
    logger.error('permissions_failed', { thrown: error });
    return 1;
  }
  logger.info('permissions_applied');
  return 0;
}

export interface DeployCommandDeps {
  runMigrations?: (ownerUrl: string) => Promise<number>;
  readPermissions?: () => string;
  run?: typeof migrateAndGrant;
}

/** Comando único de despliegue: lee OWNER_DATABASE_URL y el script de permisos y llama a `migrateAndGrant`. */
export async function runDeployCommand(
  env: Readonly<Record<string, string | undefined>>,
  logger: Logger,
  deps: DeployCommandDeps = {},
): Promise<number> {
  const { runMigrations, readPermissions = readPermissionsSql, run = migrateAndGrant } = deps;

  const ownerUrl = env['OWNER_DATABASE_URL'];
  if (ownerUrl === undefined || ownerUrl === '') {
    // Solo se nombra la variable: nunca su valor.
    logger.error('owner_database_url_missing');
    return 1;
  }

  let permissionsSql: string;
  try {
    permissionsSql = readPermissions();
  } catch (error) {
    logger.error('permissions_file_unreadable', { thrown: error });
    return 1;
  }

  return run({ ownerUrl, runMigrations, permissionsSql, logger });
}
