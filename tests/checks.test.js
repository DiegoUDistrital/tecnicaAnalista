import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findBusyPorts, findMissingFiles } from '../scripts/dev/checks.js';

const root = path.resolve('raiz-falsa');

/** @param {string[]} missing rutas relativas que no existen */
const exists = (missing) => (/** @type {string} */ file) => !missing.includes(path.relative(root, file));

describe('findMissingFiles', () => {
  it('RF-I5: sin node_modules de backend o frontend el mensaje dice qué instalar y dónde', () => {
    const problems = findMissingFiles({
      root,
      fileExists: exists([path.join('backend', 'node_modules'), path.join('frontend', 'node_modules')]),
    });
    expect(problems).toEqual([
      'Faltan las dependencias del backend: ejecute `npm install` en backend/',
      'Faltan las dependencias del frontend: ejecute `npm install` en frontend/',
    ]);
  });

  it('RF-I5: sin .env o sin frontend/.env el mensaje dice qué copiar', () => {
    const problems = findMissingFiles({ root, fileExists: exists(['.env', path.join('frontend', '.env')]) });
    expect(problems).toEqual([
      'Falta el archivo .env de la raíz: copie .env.example a .env',
      'Falta el archivo frontend/.env: copie frontend/.env.example a frontend/.env',
    ]);
  });

  it('RF-I5: con todo en su sitio no hay nada que avisar', () => {
    expect(findMissingFiles({ root, fileExists: exists([]) })).toEqual([]);
  });
});

describe('findBusyPorts', () => {
  it('RF-I6: el puerto 3000 o 3001 ocupado se nombra', async () => {
    const asked = /** @type {Array<[number, string]>} */ ([]);
    const busy = await findBusyPorts({
      isPortFree: async (port, host) => {
        asked.push([port, host]);
        return port !== 3001;
      },
    });
    expect(busy).toEqual(['El puerto 3001 está ocupado: libérelo antes de arrancar']);
    expect(asked).toEqual([
      [3000, '127.0.0.1'],
      [3001, '127.0.0.1'],
    ]);
    const both = await findBusyPorts({ isPortFree: async () => false });
    expect(both).toHaveLength(2);
    expect(both[0]).toContain('3000');
  });

  it('RF-I6: con los dos puertos libres no hay avisos', async () => {
    expect(await findBusyPorts({ isPortFree: async () => true })).toEqual([]);
  });
});
