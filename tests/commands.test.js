import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKEND_PORT, buildCommands, FRONTEND_PORT, LOOPBACK } from '../scripts/dev/commands.js';

const root = path.resolve(import.meta.dirname, '..');
const execPath = process.execPath;
const parentEnv = { PATH: '/bin', API_KEY: 'centinela-api-key', DATABASE_URL: 'centinela-url', PORT: '9999' };

const build = (/** @type {string} */ platform = 'linux') => buildCommands({ root, platform, parentEnv, execPath });

describe('buildCommands', () => {
  it('RF-I5: los cuatro comandos usan process.execPath (menos docker), shell false y las rutas esperadas', () => {
    const { db, build: tsc, backend, frontend } = build();
    expect(db.command).toBe('docker');
    expect(db.args).toEqual(['compose', '-f', 'docker-compose.dev.yml', 'up', '-d', '--wait']);
    expect(db.cwd).toBe(root);
    for (const spec of [tsc, backend, frontend]) expect(spec.command).toBe(execPath);
    expect(tsc.args).toEqual([
      path.join(root, 'backend', 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      'tsconfig.build.json',
    ]);
    expect(tsc.cwd).toBe(path.join(root, 'backend'));
    expect(backend.args).toEqual([`--env-file=${path.join(root, '.env')}`, 'dist/index.js']);
    expect(backend.cwd).toBe(path.join(root, 'backend'));
    expect(frontend.args[0]).toBe(path.join(root, 'frontend', 'node_modules', 'next', 'dist', 'bin', 'next'));
    expect(frontend.cwd).toBe(path.join(root, 'frontend'));
    expect([db, tsc, backend, frontend].map((spec) => spec.name)).toEqual(['db', 'build', 'backend', 'frontend']);
    // startChild fija shell: false; aquí ningún comando intenta pedir un shell.
    for (const spec of [db, tsc, backend, frontend]) expect(spec).not.toHaveProperty('shell');
  });

  it('RF-I5: el argumento -H y -p del frontend coinciden con el script dev de frontend/package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'frontend', 'package.json'), 'utf8'));
    const [executable, ...expected] = pkg.scripts.dev.split(' ');
    expect(executable).toBe('next');
    expect(build().frontend.args.slice(1)).toEqual(expected);
    expect(expected).toEqual(['dev', '-H', LOOPBACK, '-p', String(FRONTEND_PORT)]);
  });

  it('RF-I5: el backend recibe PORT=3000 y HOST=127.0.0.1 y el frontend no recibe variables del backend', () => {
    const { backend, frontend } = build();
    expect(BACKEND_PORT).toBe(3000);
    expect(backend.env).toEqual({ PATH: '/bin', PORT: '3000', HOST: '127.0.0.1' });
    expect(Object.keys(frontend.env)).toEqual(['PATH']);
  });

  it('RF-I8: el entorno de cada hijo es el cerrado: nada del entorno del padre salvo PATH (y Windows)', () => {
    const win = buildCommands({
      root,
      platform: 'win32',
      parentEnv: { ...parentEnv, SystemRoot: 'C:\\Windows', TEMP: 'C:\\t', TMP: 'C:\\t' },
      execPath,
    });
    for (const spec of Object.values(win)) {
      expect(spec.env.API_KEY).toBeUndefined();
      expect(spec.env.DATABASE_URL).toBeUndefined();
      expect(spec.env.SystemRoot).toBe('C:\\Windows');
    }
    expect(win.db.env.PORT).toBeUndefined();
    expect(win.backend.env.PORT).toBe('3000');
  });

  it('RF-I5: el backend y docker leen el .env de la raíz y el frontend su propio archivo (por el cwd)', () => {
    const { db, backend, frontend } = build();
    expect(db.cwd).toBe(root);
    expect(backend.args[0]).toBe(`--env-file=${path.join(root, '.env')}`);
    expect(frontend.cwd).toBe(path.join(root, 'frontend'));
    expect(frontend.args.join(' ')).not.toContain('--env-file');
  });

  it('RF-I8: ningún argumento ni variable construida contiene valores de .env (.env centinela)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-commands-'));
    try {
      fs.writeFileSync(path.join(dir, '.env'), 'API_KEY=centinela-clave-123\nDATABASE_URL=centinela-url-456\n');
      const specs = buildCommands({ root: dir, platform: 'linux', parentEnv: { PATH: '/bin' }, execPath });
      expect(JSON.stringify(Object.values(specs))).not.toContain('centinela');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
