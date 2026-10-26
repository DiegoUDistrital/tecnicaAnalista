import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { filesContaining, scanClientFiles, serverFilesWithoutServerOnly } from '../helpers/client-scan';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../helpers/fixtures-client-scan/${name}/`, import.meta.url));
const SOURCE_ROOT = fileURLToPath(new URL('../../src/', import.meta.url));

/** Motivos encontrados, con el nombre de archivo del navegador (el primer archivo `'use client'`). */
function reasons(name: string): string[] {
  return scanClientFiles(fixture(name)).map((finding) => `${basename(finding.clientFile)}:${finding.reason}`);
}

describe('recorrido del código del navegador (ayudante)', () => {
  it("RF-F21: el recorrido detecta un archivo 'use client' que llega a src/server de forma transitiva", () => {
    expect(reasons('transitive')).toEqual(['panel.tsx:imports-server', 'panel.tsx:imports-server-only']);
  });

  it("RF-F21: el recorrido detecta un archivo 'use client' que lee process.env", () => {
    expect(reasons('reads-env')).toEqual(['panel.tsx:reads-env']);
  });

  it('RF-F21: el ayudante detecta NEXT_PUBLIC_ y un archivo de src/server sin import server-only', () => {
    expect(filesContaining(fixture('public-env'), 'NEXT_PUBLIC_').map((file) => basename(file))).toEqual(['leak.ts']);
    expect(serverFilesWithoutServerOnly(fixture('missing-server-only')).map((file) => basename(file))).toEqual([
      'loose.ts',
    ]);
    expect(serverFilesWithoutServerOnly(fixture('clean'))).toEqual([]);
    expect(serverFilesWithoutServerOnly(fixture('public-env'))).toEqual([]);
  });
});

describe('código real de src', () => {
  it("RF-F21: ningún archivo 'use client' llega a src/server, lee process.env ni importa server-only", () => {
    expect(scanClientFiles(SOURCE_ROOT)).toEqual([]);
  });

  it('RF-F21: ningún archivo del código tiene NEXT_PUBLIC_', () => {
    expect(filesContaining(SOURCE_ROOT, 'NEXT_PUBLIC_')).toEqual([]);
  });

  it("RF-F21: cada archivo de src/server empieza con import 'server-only'", () => {
    expect(serverFilesWithoutServerOnly(SOURCE_ROOT)).toEqual([]);
  });
});
