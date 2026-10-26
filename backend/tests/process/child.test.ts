import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { baseEnv, type Env } from '../helpers/config-env';
import { getFreePort, SENTINEL_PASSWORD } from '../helpers/server-fakes';

const BACKEND_DIR = resolve(__dirname, '..', '..');
const ENTRY = resolve(BACKEND_DIR, 'dist', 'index.js');
const VALID_URL = `postgresql://writer:${SENTINEL_PASSWORD}@127.0.0.1:5433/todo_app_test`;

/** Ejecuta el punto de entrada compilado con un entorno explícito (nunca hereda el del test ni imprime el `.env`). */
function runEntry(env: Env): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [ENTRY], {
    cwd: BACKEND_DIR,
    env: { ...(process.env['SystemRoot'] ? { SystemRoot: process.env['SystemRoot'] } : {}), ...env },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 20000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('procesos hijos sobre el código compilado', () => {
  beforeAll(() => {
    const compile = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'], {
      cwd: BACKEND_DIR,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 55000,
    });
    expect(compile.status, `${compile.stdout}${compile.stderr}`).toBe(0);
  });

  it('RF-S1: dos variables inválidas (001 y 002): código distinto de cero, startup_failed, nombres sin valores', () => {
    const { status, output } = runEntry(
      baseEnv({
        DATABASE_URL: VALID_URL,
        DB_POOL_MAX: 'valor-pool-invalido',
        PORT: 'valor-puerto-invalido',
      }),
    );

    expect(status).not.toBe(0);
    expect(output).toContain('"event":"startup_failed"');
    expect(output).toContain('DB_POOL_MAX');
    expect(output).toContain('PORT');
    expect(output).not.toContain('valor-pool-invalido');
    expect(output).not.toContain('valor-puerto-invalido');
    expect(output).not.toContain(SENTINEL_PASSWORD);
  });

  it('RF-S3: BD en un puerto cerrado: código distinto de cero, startup_failed y sin la contraseña', async () => {
    const closedPort = await getFreePort();
    const { status, output } = runEntry(
      baseEnv({
        DATABASE_URL: `postgresql://writer:${SENTINEL_PASSWORD}@127.0.0.1:${String(closedPort)}/todo_app_test`,
        DB_POOL_CONNECTION_TIMEOUT_MS: '100',
      }),
    );

    expect(status).not.toBe(0);
    expect(output).toContain('"event":"startup_failed"');
    expect(output).not.toContain(SENTINEL_PASSWORD);
  });
});
