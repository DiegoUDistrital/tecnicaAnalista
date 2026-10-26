import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDev } from '../scripts/dev/run-dev.js';
import { isPortFree } from '../scripts/lib/ports.js';
import { killTree, startChild } from '../scripts/lib/process-tree.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY_SENTINEL = 'CENTINELA-KEY-corta';
const URL_SENTINEL = 'CENTINELA-url-mal-formada';
const WAIT_FOREVER = 'setInterval(() => {}, 1000)';
const LISTEN_3001 = `require('node:net').createServer().listen(3001, '127.0.0.1'); ${WAIT_FOREVER}`;

// Los puertos 3000 y 3001 son fijos en el arranque conjunto: si el desarrollador los usa, la prueba se omite visible.
const portsFree = (await isPortFree(3000, '127.0.0.1')) && (await isPortFree(3001, '127.0.0.1'));
const itIfPortsFree = it.skipIf(!portsFree);
if (!portsFree) console.warn('OMITIDO: los puertos 3000 o 3001 están ocupados; libérelos para ejecutar esta prueba');

/** @type {string} */
let tempDir;
/** @type {string} */
let envFile;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'dev-invalid-env-'));
  envFile = path.join(tempDir, 'invalid.env');
  writeFileSync(envFile, `API_KEY=${KEY_SENTINEL}\nDATABASE_URL=${URL_SENTINEL}\n`);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Ejecuta runDev con el backend REAL compilado y el .env inválido de la prueba; docker y el frontend se sustituyen
 * por procesos de `node -e` (docker termina bien; el frontend escucha en 3001 y espera).
 * @param {{ isPortFree?: typeof isPortFree }} [overrides]
 */
async function runWithStubs(overrides = {}) {
  let output = '';
  /** @type {string[]} */
  const started = [];
  /** @type {import('../scripts/lib/process-tree.js').Child[]} */
  const children = [];
  const code = await runDev({
    root: ROOT,
    platform: process.platform,
    deps: {
      env: { ...process.env },
      execPath: process.execPath,
      write: (text) => {
        output += text;
      },
      fileExists: () => true,
      isPortFree,
      startChild: (spec) => {
        started.push(spec.name);
        const stubs = /** @type {Record<string, string>} */ ({ db: 'process.exit(0)', frontend: LISTEN_3001 });
        const stubScript = stubs[spec.name];
        const real =
          spec.name === 'backend'
            ? { ...spec, args: [`--env-file=${envFile}`, ...spec.args.slice(1)] }
            : stubScript === undefined
              ? spec
              : { ...spec, command: process.execPath, args: ['-e', stubScript], cwd: tempDir };
        const child = startChild(real);
        children.push(child);
        return child;
      },
      killTree,
      onSignal: () => () => {},
      ...overrides,
    },
  });
  return { code, output, started, children };
}

describe('npm run dev con el backend real y variables inválidas', () => {
  itIfPortsFree(
    'RF-I8: con API_KEY corta y DATABASE_URL mal formada la salida nombra ambas variables y ningún centinela',
    async () => {
      const { output } = await runWithStubs();
      expect(output).toContain('API_KEY');
      expect(output).toContain('DATABASE_URL');
      expect(output).not.toContain(KEY_SENTINEL);
      expect(output).not.toContain(URL_SENTINEL);
    },
  );

  itIfPortsFree(
    'RF-I6: backend inválido: el frontend se detiene, el código no es 0 y los puertos 3000/3001 quedan libres',
    async () => {
      const { code, output, children } = await runWithStubs();
      expect(code).toBe(1);
      expect(output).toContain('El proceso backend terminó');
      expect(children.every((child) => child.hasExited())).toBe(true);
      expect(await isPortFree(3000, '127.0.0.1')).toBe(true);
      expect(await isPortFree(3001, '127.0.0.1')).toBe(true);
    },
  );

  itIfPortsFree('RF-I6: con el puerto 3000 ocupado falla nombrando el puerto antes de lanzar nada', async () => {
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(3000, '127.0.0.1', () => resolve(undefined)));
    try {
      const { code, output, started } = await runWithStubs();
      expect(code).toBe(1);
      expect(output).toContain('3000');
      expect(started).toEqual([]);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });
});
