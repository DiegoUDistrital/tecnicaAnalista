import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export type FindingReason = 'imports-server' | 'reads-env' | 'imports-server-only';

export interface Finding {
  /** Archivo `'use client'` desde el que se llega al problema. */
  clientFile: string;
  reason: FindingReason;
}

const COMMENTS = String.raw`(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*`;
const CLIENT_DIRECTIVE = new RegExp(String.raw`^${COMMENTS}\s*['"]use client['"]`);
const SERVER_ONLY_FIRST = new RegExp(String.raw`^${COMMENTS}\s*import 'server-only';`);
const IMPORT_SPECIFIER = /(?:from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g;
const EXTENSIONS = ['', '.ts', '.tsx', `${sep}index.ts`, `${sep}index.tsx`];

/** Archivos `.ts`/`.tsx` (sin `.d.ts`) bajo `root`, recorridos de forma recursiva. */
export function listSourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) {
      return listSourceFiles(path);
    }
    return /\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

function specifiersOf(text: string): string[] {
  return [...text.matchAll(IMPORT_SPECIFIER)].map((match) => match[1] ?? '');
}

/** Archivo local al que apunta una importación relativa, o undefined si es un paquete o no existe. */
function resolveLocal(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  const base = resolve(dirname(from), specifier);
  return EXTENSIONS.map((extension) => `${base}${extension}`).find(
    (path) => existsSync(path) && statSync(path).isFile(),
  );
}

/**
 * Recorre cada archivo `'use client'` de `root` y todo lo que importa de forma transitiva (solo rutas relativas) y
 * devuelve los que llegan a `root/server`, leen `process.env` o importan `server-only`.
 */
export function scanClientFiles(root: string): Finding[] {
  const serverDirectory = join(root, 'server') + sep;
  const findings = new Map<string, Finding>();
  const report = (clientFile: string, reason: FindingReason): void => {
    findings.set(`${clientFile}|${reason}`, { clientFile, reason });
  };
  for (const clientFile of listSourceFiles(root)) {
    if (!CLIENT_DIRECTIVE.test(readFileSync(clientFile, 'utf8'))) {
      continue;
    }
    const pending = [clientFile];
    const visited = new Set<string>();
    for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
      if (visited.has(file)) {
        continue;
      }
      visited.add(file);
      if (file.startsWith(serverDirectory)) {
        report(clientFile, 'imports-server');
      }
      const text = readFileSync(file, 'utf8');
      if (/\bprocess\.env\b/.test(text)) {
        report(clientFile, 'reads-env');
      }
      for (const specifier of specifiersOf(text)) {
        if (specifier === 'server-only') {
          report(clientFile, 'imports-server-only');
        }
        const local = resolveLocal(file, specifier);
        if (local !== undefined) {
          pending.push(local);
        }
      }
    }
  }
  return [...findings.values()];
}

/** Archivos de `root` cuyo texto contiene `needle`. */
export function filesContaining(root: string, needle: string): string[] {
  return listSourceFiles(root).filter((file) => readFileSync(file, 'utf8').includes(needle));
}

/** Archivos de `root/server` que no empiezan con `import 'server-only';`. */
export function serverFilesWithoutServerOnly(root: string): string[] {
  const serverDirectory = join(root, 'server');
  if (!existsSync(serverDirectory)) {
    return [];
  }
  return listSourceFiles(serverDirectory).filter((file) => !SERVER_ONLY_FIRST.test(readFileSync(file, 'utf8')));
}
