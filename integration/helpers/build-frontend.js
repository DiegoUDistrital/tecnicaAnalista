import path from 'node:path';
import { buildClosedEnv } from '../../scripts/lib/closed-env.js';
import { startChild } from '../../scripts/lib/process-tree.js';

/**
 * Compila el frontend (`next build`) con el entorno cerrado y SIN variables de configuración: la compilación no
 * necesita `.env` (configuración perezosa). Devuelve la salida si falla, nunca el entorno.
 * @param {string} root raíz del repositorio
 * @returns {Promise<void>}
 */
export async function buildFrontend(root) {
  const frontend = path.join(root, 'frontend');
  const child = startChild({
    name: 'frontend-build',
    command: process.execPath,
    args: [path.join(frontend, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'],
    cwd: frontend,
    env: buildClosedEnv(process.platform, process.env),
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => (output += chunk));
  const { code } = await child.exited;
  if (code !== 0) throw new Error(`next build terminó con código ${code}\n${output.slice(-2000)}`);
}
