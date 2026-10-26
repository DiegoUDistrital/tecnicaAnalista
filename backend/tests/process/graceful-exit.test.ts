import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { baseEnv, type Env } from '../helpers/config-env';
import { getFreePort } from '../helpers/server-fakes';
import { getTestDatabase } from '../helpers/test-database';

// El cierre ordenado con una señal REAL no se puede probar en Windows (Node no entrega SIGTERM). Por eso el hijo usa
// un proceso FALSO (un EventEmitter) y el propio script emite la señal. El criterio es que el hijo termina solo, con
// código 0, sin llamar a process.exit: si quedara un temporizador vivo, el hijo no acabaría y el plazo lo mataría.

const BACKEND_DIR = resolve(__dirname, '..', '..');
const START_SERVER = resolve(BACKEND_DIR, 'dist', 'server', 'start-server.js');
const WRONG_BEARER = 'Bearer clave-erronea-de-prueba-0000000000000000000';
const RESULT_PREFIX = 'RESULT ';

/**
 * Script del hijo (`node -e`): arranca el `startServer` compilado con un proceso falso y el entorno del padre, pide
 * un 401 (sin key) y dos veces con key errónea (la segunda da 401 y bloquea la IP con el límite de 2; la tercera da
 * 429), emite SIGTERM falso y espera a que el servicio cierre. Imprime el resultado; no llama a process.exit.
 */
function childScript(): string {
  return [
    "const http = require('node:http');",
    "const { EventEmitter } = require('node:events');",
    `const { startServer } = require(${JSON.stringify(START_SERVER)});`,
    'const fake = new EventEmitter();',
    'const port = Number(process.env.PORT);',
    `const WRONG = ${JSON.stringify(WRONG_BEARER)};`,
    'function get(headers) {',
    '  return new Promise((resolveStatus, reject) => {',
    "    const options = { host: '127.0.0.1', port, path: '/api/tasks', method: 'GET', headers, agent: false };",
    '    const req = http.request(options, (res) => {',
    '      res.resume();',
    "      res.on('end', () => resolveStatus(res.statusCode));",
    '    });',
    "    req.on('error', reject);",
    '    req.end();',
    '  });',
    '}',
    'async function untilListening() {',
    '  for (let attempt = 0; attempt < 200; attempt += 1) {',
    '    try {',
    '      return await get({});',
    '    } catch (error) {',
    '      await new Promise((done) => setTimeout(done, 25));',
    '    }',
    '  }',
    "  throw new Error('el servicio no escucha');",
    '}',
    '(async () => {',
    '  const running = startServer({ env: process.env, process: fake });',
    '  const statuses = [];',
    '  statuses.push(await untilListening());',
    '  statuses.push(await get({ Authorization: WRONG }));',
    '  statuses.push(await get({ Authorization: WRONG }));',
    "  fake.emit('SIGTERM');",
    '  const code = await running;',
    `  process.stdout.write('${RESULT_PREFIX}' + JSON.stringify({ statuses, code }) + '\\n');`,
    '})().catch((error) => {',
    "  process.stdout.write('ERROR ' + String(error) + '\\n');",
    '  process.exitCode = 1;',
    '});',
  ].join('\n');
}

/** Ejecuta el hijo con un entorno explícito (nunca hereda el del test ni imprime el `.env`). Plazo: 20 s. */
function runChild(env: Env): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, ['-e', childScript()], {
    cwd: BACKEND_DIR,
    env: { ...(process.env['SystemRoot'] ? { SystemRoot: process.env['SystemRoot'] } : {}), ...env },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 20000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('cierre ordenado en un proceso hijo sobre el código compilado', () => {
  beforeAll(() => {
    // Mismo paso que tests/process/child.test.ts: el hijo carga el JavaScript de dist.
    const compile = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'], {
      cwd: BACKEND_DIR,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 55000,
    });
    expect(compile.status, `${compile.stdout}${compile.stderr}`).toBe(0);
  });

  it('RF-G7/G9: el hijo sirve 401 y 429, emite la señal y termina solo con código 0', async () => {
    // Guarda de la base de pruebas: el hijo solo puede conectarse a la base de tests.
    getTestDatabase();
    const port = await getFreePort();

    const { status, output } = runChild(
      baseEnv({
        DATABASE_URL: process.env['TEST_DATABASE_URL'],
        PORT: String(port),
        HOST: '127.0.0.1',
        RATE_LIMIT_AUTH_FAILURES_MAX: '2',
      }),
    );

    expect(status, output).toBe(0);
    const resultLine = output.split('\n').find((line) => line.startsWith(RESULT_PREFIX));
    expect(resultLine, output).toBeDefined();
    expect(JSON.parse((resultLine ?? '').slice(RESULT_PREFIX.length))).toEqual({ statuses: [401, 401, 429], code: 0 });
    expect(output).toContain('"event":"startup"');
    expect(output).toContain('"event":"shutdown_started"');
    expect(output).toContain('"event":"shutdown_completed","time"');
    expect(output).not.toContain('"event":"shutdown_timeout"');
  });
});
