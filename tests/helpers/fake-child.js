import { PassThrough } from 'node:stream';

/**
 * @typedef {{ code: number | null, signal: string | null, errorCode?: string }} ExitInfo
 */

/**
 * Hijo falso con la forma de `startChild`: termina cuando el test llama a `finish`.
 * @param {string} name
 */
export function createFakeChild(name) {
  let done = false;
  /** @type {(info: ExitInfo) => void} */
  let resolveExit = () => {};
  /** @type {Promise<ExitInfo>} */
  const exited = new Promise((resolve) => {
    resolveExit = resolve;
  });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  return {
    name,
    pid: 4000,
    hasExited: () => done,
    exited,
    stdout,
    stderr,
    /** @param {ExitInfo} info */
    finish(info) {
      done = true;
      resolveExit(info);
      stdout.end();
      stderr.end();
    },
  };
}

/** Deja correr los eventos pendientes de streams y promesas. */
export const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Espera (con tope) a que se cumpla una condición.
 * @param {() => boolean} condition
 * @returns {Promise<void>}
 */
export async function until(condition) {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) await tick();
  if (!condition()) throw new Error('La condición no se cumplió a tiempo');
}
