import path from 'node:path';
import { buildClosedEnv } from '../lib/closed-env.js';

export const BACKEND_PORT = 3000;
export const FRONTEND_PORT = 3001;
export const LOOPBACK = '127.0.0.1';

/**
 * @typedef {{ name: string, command: string, args: string[], cwd: string, env: Record<string, string> }} CommandSpec
 */

/**
 * Construye los cuatro comandos del arranque conjunto. Ninguno usa shell ni `npm`: el ejecutable de Node lanza el
 * JavaScript de `tsc` y de `next` directamente. No se lee ningún `.env`: Compose y `--env-file` lo leen ellos mismos
 * y el frontend lee el suyo por estar su directorio de trabajo en `frontend/`. Los argumentos solo llevan rutas.
 * @param {{ root: string, platform: string, parentEnv: Record<string, string | undefined>, execPath: string }} options
 * @returns {{ db: CommandSpec, build: CommandSpec, backend: CommandSpec, frontend: CommandSpec }}
 */
export function buildCommands({ root, platform, parentEnv, execPath }) {
  const closed = (/** @type {Record<string, string>} */ extra = {}) => buildClosedEnv(platform, parentEnv, extra);
  const backendDir = path.join(root, 'backend');
  const frontendDir = path.join(root, 'frontend');
  return {
    db: {
      name: 'db',
      command: 'docker',
      args: ['compose', '-f', 'docker-compose.dev.yml', 'up', '-d', '--wait'],
      cwd: root,
      env: closed(),
    },
    build: {
      name: 'build',
      command: execPath,
      args: [path.join(backendDir, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'],
      cwd: backendDir,
      env: closed(),
    },
    backend: {
      name: 'backend',
      command: execPath,
      args: [`--env-file=${path.join(root, '.env')}`, 'dist/index.js'],
      cwd: backendDir,
      // --env-file no pisa variables que ya existen en el entorno: así los puertos son fijos aunque el .env diga otro.
      env: closed({ PORT: String(BACKEND_PORT), HOST: LOOPBACK }),
    },
    frontend: {
      name: 'frontend',
      command: execPath,
      args: [
        path.join(frontendDir, 'node_modules', 'next', 'dist', 'bin', 'next'),
        'dev',
        '-H',
        LOOPBACK,
        '-p',
        String(FRONTEND_PORT),
      ],
      cwd: frontendDir,
      env: closed(),
    },
  };
}
