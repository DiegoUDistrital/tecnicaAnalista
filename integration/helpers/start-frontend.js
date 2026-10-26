import path from 'node:path';
import { buildClosedEnv } from '../../scripts/lib/closed-env.js';
import { waitForPort } from '../../scripts/lib/ports.js';
import { killTree, startChild } from '../../scripts/lib/process-tree.js';

/**
 * Key de la prueba: formato válido (43 a 128 caracteres de A-Z a-z 0-9 _ -, 10 o más distintos). No es un secreto.
 */
export const TEST_API_KEY = 'integrationTestKey_0123456789-abcdefghijklmnopq';

/**
 * Arranca el frontend compilado (`next start`) con el entorno cerrado y la configuración de la prueba, apuntando a
 * un Express (el sustituto). El entorno del proceso manda sobre cualquier `frontend/.env` que exista.
 * @param {{ root: string, port: number, backendPort: number }} options
 * @returns {Promise<{ stop: () => Promise<void>, output: () => string }>}
 */
export async function startFrontend({ root, port, backendPort }) {
  const frontend = path.join(root, 'frontend');
  const env = buildClosedEnv(process.platform, process.env, {
    BACKEND_URL: `http://127.0.0.1:${backendPort}`,
    API_KEY: TEST_API_KEY,
    READER_DATABASE_URL: 'postgresql://reader:integration-test@127.0.0.1:5433/todo_app',
  });
  const child = startChild({
    name: 'frontend',
    command: process.execPath,
    args: [
      path.join(frontend, 'node_modules', 'next', 'dist', 'bin', 'next'),
      'start',
      '-H',
      '127.0.0.1',
      '-p',
      String(port),
    ],
    cwd: frontend,
    env,
  });
  let collected = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => (collected += chunk));
  const stop = () => killTree(child);
  try {
    await waitForPort(port, '127.0.0.1', 60000, 'frontend');
  } catch (error) {
    await stop();
    throw new Error(`${error instanceof Error ? error.message : 'fallo'}\n${collected.slice(-2000)}`, { cause: error });
  }
  return { stop, output: () => collected };
}
