import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runDev } from '../scripts/dev/run-dev.js';
import { createFakeChild, tick, until } from './helpers/fake-child.js';

const ok = { code: 0, signal: null };

/**
 * @typedef {ReturnType<typeof createFakeChild>} FakeChild
 * @typedef {{ name: string, command: string, args: string[], env: Record<string, string> }} Spec
 * @typedef {{ code: number | null, signal: string | null, errorCode?: string }} Outcome
 */

/**
 * @param {{
 *   root?: string, outcomes?: Record<string, Outcome>, busyPorts?: number[], missing?: string[],
 *   fileExists?: (file: string) => boolean, parentEnv?: Record<string, string>, killFails?: boolean,
 * }} [options]
 */
function createHarness(options = {}) {
  const { root = path.resolve('raiz-falsa'), busyPorts = [], missing = [] } = options;
  /** @type {Record<string, Outcome>} */
  const outcomes = options.outcomes ?? { db: ok, build: ok };
  /** @type {Spec[]} */
  const started = [];
  /** @type {Record<string, FakeChild>} */
  const children = {};
  /** @type {string[]} */
  const written = [];
  /** @type {Array<() => void>} */
  const handlers = [];
  const disposed = vi.fn();
  const killTree = vi.fn(async (/** @type {import('../scripts/lib/process-tree.js').Child} */ child) => {
    if (options.killFails) throw new Error(`No se pudo detener el proceso ${child.name}`);
    /** @type {FakeChild} */ (child).finish({ code: null, signal: 'SIGTERM' });
  });
  const deps = {
    env: options.parentEnv ?? { PATH: '/bin' },
    execPath: process.execPath,
    write: (/** @type {string} */ text) => written.push(text),
    fileExists: options.fileExists ?? ((/** @type {string} */ file) => !missing.includes(path.relative(root, file))),
    isPortFree: async (/** @type {number} */ port) => !busyPorts.includes(port),
    startChild: (/** @type {Spec} */ spec) => {
      started.push(spec);
      const child = createFakeChild(spec.name);
      children[spec.name] = child;
      const outcome = outcomes[spec.name];
      if (outcome !== undefined) setImmediate(() => child.finish(outcome));
      return child;
    },
    killTree,
    onSignal: (/** @type {() => void} */ handler) => {
      handlers.push(handler);
      return disposed;
    },
  };
  const run = () => runDev({ root, platform: 'linux', deps });
  const names = () => started.map((spec) => spec.name);
  const interrupt = () => handlers.forEach((handler) => handler());
  return { run, started, children, written, killTree, disposed, names, interrupt };
}

/** Arranca todo hasta que backend y frontend están en marcha (devuelve un objeto: un async aplana la promesa). */
async function running(/** @type {ReturnType<typeof createHarness>} */ h) {
  const result = h.run();
  await until(() => h.names().length === 4);
  return { result };
}

describe('runDev: comprobaciones previas', () => {
  it('RF-I5: faltan archivos o dependencias, se dice qué hacer y no se lanza nada', async () => {
    const h = createHarness({ missing: ['.env', path.join('backend', 'node_modules')] });
    expect(await h.run()).toBe(1);
    expect(h.names()).toEqual([]);
    expect(h.written.join('')).toContain('[dev] Falta el archivo .env de la raíz: copie .env.example a .env');
    expect(h.written.join('')).toContain('`npm install` en backend/');
  });

  it('RF-I6: el puerto 3001 ocupado se nombra y no se lanza ningún proceso (ni docker)', async () => {
    const h = createHarness({ busyPorts: [3001] });
    expect(await h.run()).toBe(1);
    expect(h.names()).toEqual([]);
    expect(h.written).toEqual(['[dev] El puerto 3001 está ocupado: libérelo antes de arrancar\n']);
  });
});

describe('runDev: arranque', () => {
  it('RF-I5: orden db (con --wait), compilación, backend y frontend', async () => {
    const h = createHarness();
    const { result } = await running(h);
    expect(h.names()).toEqual(['db', 'build', 'backend', 'frontend']);
    expect(h.started[0]?.command).toBe('docker');
    expect(h.started[0]?.args).toContain('--wait');
    h.interrupt();
    expect(await result).toBe(0);
  });

  it('RF-I5: la salida de cada proceso lleva su prefijo', async () => {
    const h = createHarness();
    const { result } = await running(h);
    h.children.backend?.stdout.write('escuchando\n');
    h.children.frontend?.stderr.write('listo\n');
    await tick();
    expect(h.written).toContain('[backend] escuchando\n');
    expect(h.written).toContain('[frontend] listo\n');
    h.interrupt();
    await result;
  });

  it('RF-I6: si el backend termina, se detiene el frontend, el código no es 0 y se nombra el proceso', async () => {
    const h = createHarness();
    const { result } = await running(h);
    h.children.backend?.finish({ code: 3, signal: null });
    expect(await result).toBe(1);
    expect(h.killTree).toHaveBeenCalledTimes(1);
    expect(h.killTree.mock.calls[0]?.[0]).toBe(h.children.frontend);
    expect(h.written).toContain('[dev] El proceso backend terminó (código 3)\n');
    expect(h.disposed).toHaveBeenCalled();
  });

  it('RF-I6: lo mismo al revés: si el frontend termina se detiene el backend', async () => {
    const h = createHarness();
    const { result } = await running(h);
    h.children.frontend?.finish({ code: 1, signal: null });
    expect(await result).toBe(1);
    expect(h.killTree.mock.calls[0]?.[0]).toBe(h.children.backend);
    expect(h.written).toContain('[dev] El proceso frontend terminó (código 1)\n');
  });

  it('RF-I6: un hijo que termina con código 0 también es fallo', async () => {
    const h = createHarness();
    const { result } = await running(h);
    h.children.frontend?.finish(ok);
    expect(await result).toBe(1);
    expect(h.written).toContain('[dev] El proceso frontend terminó (código 0)\n');
  });

  it('RF-I6: un hijo terminado por señal o que no pudo lanzarse se describe sin volcar nada más', async () => {
    const bySignal = createHarness();
    const { result: first } = await running(bySignal);
    bySignal.children.backend?.finish({ code: null, signal: 'SIGKILL' });
    expect(await first).toBe(1);
    expect(bySignal.written).toContain('[dev] El proceso backend terminó (señal SIGKILL)\n');

    const missingBinary = createHarness({ outcomes: { db: { code: null, signal: null, errorCode: 'ENOENT' } } });
    expect(await missingBinary.run()).toBe(1);
    expect(missingBinary.written).toContain('[dev] El proceso db no pudo lanzarse (ENOENT)\n');
  });

  it('RF-I6: db o compilación con código distinto de 0 detienen todo y no lanzan los servidores', async () => {
    const dbFails = createHarness({ outcomes: { db: { code: 1, signal: null } } });
    expect(await dbFails.run()).toBe(1);
    expect(dbFails.names()).toEqual(['db']);
    expect(dbFails.written).toContain('[dev] El proceso db terminó (código 1)\n');

    const buildFails = createHarness({ outcomes: { db: ok, build: { code: 2, signal: null } } });
    expect(await buildFails.run()).toBe(1);
    expect(buildFails.names()).toEqual(['db', 'build']);
    expect(buildFails.written).toContain('[dev] El proceso build terminó (código 2)\n');
  });
});

describe('runDev: parada', () => {
  it('RF-I7: Ctrl+C (SIGINT) detiene backend y frontend con killTree, no toca el contenedor y sale con 0', async () => {
    const h = createHarness();
    const { result } = await running(h);
    h.interrupt();
    expect(await result).toBe(0);
    expect(h.killTree.mock.calls.map((call) => call[0])).toEqual([h.children.backend, h.children.frontend]);
    expect(h.names()).toEqual(['db', 'build', 'backend', 'frontend']);
  });

  it('RF-I7: Ctrl+C durante la compilación cancela el hijo en curso', async () => {
    const h = createHarness({ outcomes: { db: ok } });
    const result = h.run();
    await until(() => h.names().includes('build'));
    h.interrupt();
    expect(await result).toBe(0);
    expect(h.killTree.mock.calls.map((call) => call[0])).toEqual([h.children.build]);
    expect(h.names()).toEqual(['db', 'build']);
  });

  it('RF-I7: Ctrl+C durante el arranque de la base de datos cancela ese hijo y no sigue', async () => {
    const h = createHarness({ outcomes: {} });
    const result = h.run();
    await until(() => h.names().includes('db'));
    h.interrupt();
    expect(await result).toBe(0);
    expect(h.names()).toEqual(['db']);
  });

  it('RF-I7: ningún argumento de docker contiene down ni -v en ninguna ruta (éxito, fallo, Ctrl+C)', async () => {
    const stop = createHarness();
    const { result: stopped } = await running(stop);
    stop.interrupt();
    await stopped;
    const fail = createHarness();
    const { result: failed } = await running(fail);
    fail.children.backend?.finish({ code: 1, signal: null });
    await failed;
    const dbFails = createHarness({ outcomes: { db: { code: 1, signal: null } } });
    await dbFails.run();
    for (const h of [stop, fail, dbFails]) {
      const dockerCalls = h.started.filter((item) => item.command === 'docker');
      expect(dockerCalls.length).toBeGreaterThan(0);
      for (const spec of dockerCalls) {
        expect(spec.args).not.toContain('down');
        expect(spec.args).not.toContain('-v');
      }
    }
  });

  it('RNF-I3: un plazo agotado al detener falla nombrando el proceso', async () => {
    const h = createHarness({ killFails: true });
    const { result } = await running(h);
    h.interrupt();
    expect(await result).toBe(1);
    expect(h.written).toContain('[dev] No se pudo detener el proceso backend\n');
    expect(h.written).toContain('[dev] No se pudo detener el proceso frontend\n');
  });

  it('RNF-I3: si un hijo termina y el otro no se deja detener, escribe el motivo y sale con 1', async () => {
    const h = createHarness({ killFails: true });
    const { result } = await running(h);
    h.children.backend?.finish({ code: 1, signal: null });
    expect(await result).toBe(1);
    expect(h.written).toContain('[dev] No se pudo detener el proceso frontend\n');
  });
});

describe('runDev: secretos', () => {
  it('RF-I8: con .env centinela y docker simulado ningún centinela sale en salida, argumentos ni entorno', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-run-'));
    try {
      fs.mkdirSync(path.join(dir, 'frontend', 'node_modules'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'backend', 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.env'), 'API_KEY=centinela-clave-123\nDATABASE_URL=centinela-url-456\n');
      fs.writeFileSync(path.join(dir, 'frontend', '.env'), 'API_KEY=centinela-clave-123\n');
      const h = createHarness({
        root: dir,
        fileExists: fs.existsSync,
        parentEnv: { PATH: '/bin', API_KEY: 'centinela-padre-789', DATABASE_URL: 'centinela-padre-000' },
      });
      const { result } = await running(h);
      h.children.backend?.stdout.write('arrancado\n');
      await tick();
      h.interrupt();
      await result;
      expect(h.written).toContain('[backend] arrancado\n');
      expect(JSON.stringify(h.started)).not.toContain('centinela');
      expect(h.written.join('')).not.toContain('centinela');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('RF-I8: el script nunca llama a docker compose config', async () => {
    const h = createHarness();
    const { result } = await running(h);
    h.interrupt();
    await result;
    expect(h.started.every((spec) => !spec.args.includes('config'))).toBe(true);
  });
});
