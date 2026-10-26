import { spawn } from 'node:child_process';
import path from 'node:path';
import { buildClosedEnv } from './closed-env.js';

/**
 * @typedef {{ code: number | null, signal: string | null, errorCode?: string }} ExitInfo
 * @typedef {{
 *   name: string,
 *   pid: number | undefined,
 *   hasExited: () => boolean,
 *   exited: Promise<ExitInfo>,
 *   stdout: import('node:stream').Readable,
 *   stderr: import('node:stream').Readable,
 * }} Child
 */

/**
 * Lanza un proceso hijo sin shell y con el entorno que se le da (ya cerrado por el llamador).
 * En Linux el hijo lidera su propio grupo de procesos para poder detener también a sus nietos.
 * @param {{
 *   name: string, command: string, args: string[], cwd: string, env: Record<string, string>,
 *   platform?: string, spawnImpl?: typeof spawn,
 * }} options
 * @returns {Child}
 */
export function startChild({ name, command, args, cwd, env, platform = process.platform, spawnImpl = spawn }) {
  const proc = spawnImpl(command, args, {
    cwd,
    env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: platform !== 'win32',
  });
  let done = false;
  /** @type {Promise<ExitInfo>} */
  const exited = new Promise((resolve) => {
    proc.once('exit', (code, signal) => {
      done = true;
      resolve({ code, signal });
    });
    // El mensaje del error puede traer rutas: solo se conserva su código (por ejemplo ENOENT).
    proc.once('error', (/** @type {NodeJS.ErrnoException} */ error) => {
      done = true;
      resolve({ code: null, signal: null, errorCode: error.code });
    });
  });
  return { name, pid: proc.pid, hasExited: () => done, exited, stdout: proc.stdout, stderr: proc.stderr };
}

/**
 * Espera a que el hijo termine durante `ms`.
 * @param {Child} child
 * @param {number} ms
 * @returns {Promise<boolean>} true si terminó dentro del plazo
 */
async function exitedWithin(child, ms) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([child.exited.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Detiene a un hijo y a todos sus descendientes.
 * Windows: `taskkill /PID <pid> /T /F` (sin cierre ordenado). Otros: SIGTERM al grupo y, si no sale en `graceMs`,
 * SIGKILL. Si tras la parada el proceso sigue vivo, falla nombrándolo (nunca vuelca su entorno).
 * @param {Child} child
 * @param {{
 *   platform?: string, graceMs?: number, waitMs?: number, env?: Record<string, string | undefined>,
 *   spawnImpl?: typeof spawn, kill?: (pid: number, signal: NodeJS.Signals) => void,
 * }} [options]
 * @returns {Promise<void>}
 */
export async function killTree(child, options = {}) {
  const { platform = process.platform, graceMs = 5000, waitMs = 5000, env = process.env } = options;
  const { spawnImpl = spawn, kill = process.kill } = options;
  if (child.hasExited() || child.pid === undefined) return;

  if (platform === 'win32') {
    const closedEnv = buildClosedEnv(platform, env);
    const command = closedEnv.SystemRoot
      ? path.win32.join(closedEnv.SystemRoot, 'System32', 'taskkill.exe')
      : 'taskkill';
    spawnImpl(command, ['/PID', String(child.pid), '/T', '/F'], {
      env: closedEnv,
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    signalGroup(kill, child.pid, 'SIGTERM');
    if (await exitedWithin(child, graceMs)) return;
    signalGroup(kill, child.pid, 'SIGKILL');
  }

  if (!(await exitedWithin(child, waitMs))) {
    throw new Error(`No se pudo detener el proceso ${child.name}`);
  }
}

/**
 * @param {(pid: number, signal: NodeJS.Signals) => void} kill
 * @param {number} pid
 * @param {NodeJS.Signals} signal
 */
function signalGroup(kill, pid, signal) {
  try {
    kill(-pid, signal);
  } catch (error) {
    // El grupo ya no existe: no hay nada que detener.
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH') throw error;
  }
}
