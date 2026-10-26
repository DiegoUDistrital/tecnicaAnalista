import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPortFree } from './lib/ports.js';
import { killTree, startChild } from './lib/process-tree.js';
import { runDev } from './dev/run-dev.js';

const SIGNALS = /** @type {const} */ (['SIGINT', 'SIGTERM']);

/**
 * Punto de entrada de `npm run dev`: solo cablea la lógica de `run-dev.js` con los módulos reales y `process`.
 * @param {() => void} handler
 * @returns {() => void} función que retira los manejadores
 */
function onSignal(handler) {
  for (const signal of SIGNALS) process.on(signal, handler);
  return () => {
    for (const signal of SIGNALS) process.off(signal, handler);
  };
}

process.exitCode = await runDev({
  root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  platform: process.platform,
  deps: {
    env: process.env,
    execPath: process.execPath,
    write: (text) => process.stdout.write(text),
    fileExists: existsSync,
    isPortFree,
    startChild,
    killTree,
    onSignal,
  },
});
