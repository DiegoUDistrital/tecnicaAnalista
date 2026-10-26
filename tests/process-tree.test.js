import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPortFree } from '../scripts/lib/ports.js';
import { killTree, startChild } from '../scripts/lib/process-tree.js';
import { rejectionOf } from './helpers/rejection.js';

/** @returns {any} un proceso falso con la forma mínima de ChildProcess */
function fakeProcess(pid = 4321) {
  const proc = new EventEmitter();
  return Object.assign(proc, { pid, stdout: new PassThrough(), stderr: new PassThrough() });
}

/** @param {{ platform?: string, env?: Record<string, string>, proc?: any }} [options] */
function launch({ platform = 'linux', env = { PATH: '/bin' }, proc = fakeProcess() } = {}) {
  const spawnImpl = vi.fn((/** @type {any[]} */ ..._args) => proc);
  const child = startChild({
    name: 'backend',
    command: '/usr/bin/node',
    args: ['dist/index.js'],
    cwd: '/repo/backend',
    env,
    platform,
    spawnImpl,
  });
  return { child, proc, spawnImpl };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startChild', () => {
  it('RNF-I2: el hijo se lanza con shell false y el entorno cerrado recibido', () => {
    const env = { PATH: '/bin', PORT: '3000' };
    const { child, spawnImpl } = launch({ env });
    expect(spawnImpl).toHaveBeenCalledWith('/usr/bin/node', ['dist/index.js'], {
      cwd: '/repo/backend',
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: true,
    });
    expect(child.name).toBe('backend');
    expect(child.pid).toBe(4321);
  });

  it('RNF-I2: en win32 el hijo no se separa en un grupo propio (detached false)', () => {
    const { spawnImpl } = launch({ platform: 'win32' });
    expect(spawnImpl.mock.calls[0]?.[2]).toMatchObject({ shell: false, detached: false });
  });

  it('RF-I7: exited entrega código y señal y hasExited pasa a verdadero', async () => {
    const { child, proc } = launch();
    expect(child.hasExited()).toBe(false);
    proc.emit('exit', 3, null);
    await expect(child.exited).resolves.toEqual({ code: 3, signal: null });
    expect(child.hasExited()).toBe(true);
  });

  it('RF-I6: si el ejecutable no se puede lanzar, exited cuenta el código del error y no su mensaje', async () => {
    const { child, proc } = launch();
    proc.emit('error', Object.assign(new Error('spawn secret-path ENOENT'), { code: 'ENOENT' }));
    await expect(child.exited).resolves.toEqual({ code: null, signal: null, errorCode: 'ENOENT' });
    expect(child.hasExited()).toBe(true);
  });
});

describe('killTree', () => {
  it('RF-I7: en Windows killTree llama a taskkill /PID <pid> /T /F sin shell', async () => {
    const { child, proc } = launch({ platform: 'win32' });
    const killer = vi.fn((/** @type {any[]} */ ..._args) => {
      const taskkill = fakeProcess(1);
      setImmediate(() => {
        taskkill.emit('exit', 0, null);
        proc.emit('exit', 1, null);
      });
      return taskkill;
    });
    await killTree(child, {
      platform: 'win32',
      graceMs: 50,
      waitMs: 500,
      env: { SystemRoot: 'C:\\Windows', API_KEY: 'sentinel-key' },
      spawnImpl: killer,
    });
    expect(killer).toHaveBeenCalledTimes(1);
    const [command, args, options] = killer.mock.calls[0] ?? [];
    expect(command).toBe('C:\\Windows\\System32\\taskkill.exe');
    expect(args).toEqual(['/PID', '4321', '/T', '/F']);
    expect(options.shell).toBe(false);
    expect(JSON.stringify(options.env)).not.toContain('sentinel-key');
  });

  it('RF-I7: en Windows sin SystemRoot se usa taskkill del PATH', async () => {
    const { child, proc } = launch({ platform: 'win32' });
    const killer = vi.fn((/** @type {any[]} */ ..._args) => {
      setImmediate(() => proc.emit('exit', 1, null));
      return fakeProcess(1);
    });
    await killTree(child, { platform: 'win32', graceMs: 50, waitMs: 500, env: {}, spawnImpl: killer });
    expect(killer.mock.calls[0]?.[0]).toBe('taskkill');
  });

  it('RF-I7: en Linux envía SIGTERM al grupo (-pid) y, pasado el plazo, SIGKILL', async () => {
    const { child, proc } = launch();
    const kill = vi.fn((/** @type {number} */ _pid, /** @type {string} */ signal) => {
      if (signal === 'SIGKILL') setImmediate(() => proc.emit('exit', null, 'SIGKILL'));
    });
    await killTree(child, { platform: 'linux', graceMs: 20, waitMs: 500, kill });
    expect(kill.mock.calls).toEqual([
      [-4321, 'SIGTERM'],
      [-4321, 'SIGKILL'],
    ]);
  });

  it('RF-I7: en Linux, si el hijo sale con SIGTERM no se envía SIGKILL', async () => {
    const { child, proc } = launch();
    const kill = vi.fn((/** @type {any[]} */ ..._args) => {
      setImmediate(() => proc.emit('exit', null, 'SIGTERM'));
    });
    await killTree(child, { platform: 'linux', graceMs: 500, waitMs: 500, kill });
    expect(kill.mock.calls).toEqual([[-4321, 'SIGTERM']]);
  });

  it('RF-I7: killTree sobre un hijo que ya terminó no hace nada', async () => {
    const { child, proc } = launch();
    proc.emit('exit', 0, null);
    await tick();
    const kill = vi.fn();
    const spawnImpl = vi.fn();
    await killTree(child, { platform: 'linux', graceMs: 10, waitMs: 10, kill });
    await killTree(child, { platform: 'win32', graceMs: 10, waitMs: 10, spawnImpl });
    expect(kill).not.toHaveBeenCalled();
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('RF-I7: si el grupo ya no existe (ESRCH) no es un error, y cualquier otro error sí', async () => {
    const first = launch();
    const gone = vi.fn(() => {
      setImmediate(() => first.proc.emit('exit', 0, null));
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    });
    await expect(
      killTree(first.child, { platform: 'linux', graceMs: 10, waitMs: 500, kill: gone }),
    ).resolves.toBeUndefined();

    const second = launch();
    const denied = vi.fn(() => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' });
    });
    await expect(killTree(second.child, { platform: 'linux', graceMs: 10, waitMs: 10, kill: denied })).rejects.toThrow(
      'denied',
    );
  });

  it('RNF-I3: si el proceso no sale tras la parada el error lo nombra y no vuelca su entorno', async () => {
    const env = { PATH: '/bin', API_KEY: 'sentinel-key' };
    const linux = launch({ env });
    const error = await rejectionOf(
      killTree(linux.child, { platform: 'linux', graceMs: 10, waitMs: 30, kill: vi.fn() }),
    );
    expect(error.message).toContain('backend');
    expect(error.message).not.toContain('sentinel-key');

    const win = launch({ platform: 'win32', env });
    const windowsError = await rejectionOf(
      killTree(win.child, { platform: 'win32', graceMs: 10, waitMs: 30, env: {}, spawnImpl: () => fakeProcess(1) }),
    );
    expect(windowsError.message).toContain('backend');
    expect(windowsError.message).not.toContain('sentinel-key');
  });
});

describe('killTree con procesos reales', () => {
  // eslint-disable-next-line max-len -- el nombre del test cita la tarea literalmente
  it('RF-I7: un proceso con un nieto (node que lanza node) desaparece entero tras killTree y su puerto queda libre', async () => {
    const grandchild =
      "const s = require('node:net').createServer().listen(0, '127.0.0.1', () => " +
      "console.log('PORT ' + s.address().port)); setInterval(() => {}, 1000);";
    const parent =
      "const { spawn } = require('node:child_process');" +
      `spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: ['ignore', 'inherit', 'inherit'] });` +
      'setInterval(() => {}, 1000);';
    const child = startChild({
      name: 'tree',
      command: process.execPath,
      args: ['-e', parent],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' },
      platform: process.platform,
    });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('el nieto no anunció su puerto')), 10000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (/** @type {string} */ text) => {
        const match = /PORT (\d+)/.exec(text);
        if (match?.[1] !== undefined) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
    });
    expect(await isPortFree(Number(port), '127.0.0.1')).toBe(false);

    await killTree(child, { platform: process.platform, graceMs: 3000, waitMs: 8000, env: process.env });

    let free = false;
    for (let attempt = 0; attempt < 50 && !free; attempt += 1) {
      free = await isPortFree(Number(port), '127.0.0.1');
      if (!free) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(free).toBe(true);
  }, 30000);
});
