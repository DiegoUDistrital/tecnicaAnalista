import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type Instruction,
  nodeEngines,
  parseDockerfile,
  readRepoText,
  repoRoot,
  satisfiesEngines,
  stagesOf,
} from '../helpers/repo-files';

// Lee un archivo del repositorio o devuelve '' si aún no existe: así la falta del archivo falla por aserción.
function readOrEmpty(relativePath: string): string {
  return existsSync(resolve(repoRoot(), relativePath)) ? readRepoText(relativePath) : '';
}

const CREDENTIAL_NAME = /PASSWORD|SECRET|KEY|TOKEN|DATABASE_URL|CREDENTIAL/i;

/** Orígenes de un COPY (sin opciones `--...`); el último argumento es el destino. */
function copySources(instruction: Instruction): string[] {
  const tokens = instruction.args.split(/\s+/).filter((token) => !token.startsWith('--'));
  return tokens.slice(0, -1);
}

function copyFrom(instruction: Instruction): string | null {
  return /--from=(\S+)/.exec(instruction.args)?.[1] ?? null;
}

/** Nombres de variable declarados por un ARG o un ENV (`A=1 B=2`, `A 1` o `A`). */
function declaredNames(instruction: Instruction): string[] {
  const pairs = [...instruction.args.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=/g)].map((match) => match[1] ?? '');
  return pairs.length > 0 ? pairs : [instruction.args.split(/\s+/)[0] ?? ''];
}

function shellForm(instruction: Instruction | undefined): string {
  return instruction?.args ?? '';
}

describe('RF-P1: parseDockerfile (helper)', () => {
  it('RF-P1: une las líneas que terminan en barra invertida', () => {
    const parsed = parseDockerfile('FROM node:1.0.0 AS a\nRUN echo uno \\\n  dos\n');
    expect(parsed.map((instruction) => instruction.name)).toEqual(['FROM', 'RUN']);
    expect(parsed[1]?.args).toBe('echo uno dos');
  });

  it('RF-P1: ignora comentarios y líneas vacías', () => {
    const parsed = parseDockerfile('# comentario\n\nFROM node:1.0.0 AS a\n  # otro\nUSER 1:1\n');
    expect(parsed.map((instruction) => instruction.name)).toEqual(['FROM', 'USER']);
  });

  it('RF-P1: detecta un FROM sin AS (la etapa queda sin nombre)', () => {
    const parsed = parseDockerfile('FROM node:1.0.0\nUSER 1:1\n');
    expect(parsed.every((instruction) => instruction.stage === null)).toBe(true);
    expect(stagesOf(parsed).size).toBe(0);
  });

  it('RF-P3: satisfiesEngines acepta ^, >= y ||, rechaza lo que no cumple y lanza ante otro formato', () => {
    const engines = '^22.12.0 || ^24.0.0 || >=26.0.0';
    expect([22, 24, 26, 27].map((major) => satisfiesEngines(major, engines))).toEqual([true, true, true, true]);
    expect([20, 23, 25].map((major) => satisfiesEngines(major, engines))).toEqual([false, false, false]);
    expect(() => satisfiesEngines(26, '~26.0.0')).toThrow(/no admitido/);
  });
});

describe('backend/Dockerfile', () => {
  const text = readOrEmpty('backend/Dockerfile');
  const instructions = parseDockerfile(text);
  const stages = stagesOf(instructions);
  const runtime = stages.get('runtime') ?? [];
  const migrate = stages.get('migrate') ?? [];

  it('RF-P1: backend/Dockerfile existe', () => {
    expect(text).not.toBe('');
  });

  it('RF-P1: backend/Dockerfile tiene las etapas deps, build, prod-deps, runtime y migrate, en ese orden', () => {
    expect([...stages.keys()]).toEqual(['deps', 'build', 'prod-deps', 'runtime', 'migrate']);
  });

  it('RF-P1: runtime no tiene RUN, no copia tests, src ni prisma y toma node_modules de prod-deps', () => {
    expect(runtime.length).toBeGreaterThan(0);
    expect(runtime.filter((instruction) => instruction.name === 'RUN')).toEqual([]);
    const copies = runtime.filter((instruction) => instruction.name === 'COPY');
    for (const copy of copies) {
      for (const source of copySources(copy)) {
        expect(source, `COPY ${copy.args}`).not.toMatch(/(^|\/)(tests?|src|prisma|prisma\.config\.ts)(\/|$)/);
      }
    }
    const modules = copies.filter((copy) => copySources(copy).some((source) => source.endsWith('node_modules')));
    expect(modules.map(copyFrom)).toEqual(['prod-deps']);
    expect(copies.some((copy) => copyFrom(copy) === 'build' && copySources(copy).includes('/app/dist'))).toBe(true);
  });

  it('RF-P1: migrate copia node_modules de deps, dist de build, prisma, prisma.config.ts y package.json', () => {
    const copies = migrate.filter((instruction) => instruction.name === 'COPY');
    const sources = (from: string | null): string[] =>
      copies.filter((copy) => copyFrom(copy) === from).flatMap((copy) => copySources(copy));
    expect(sources('deps')).toEqual(['/app/node_modules']);
    expect(sources('build')).toEqual(['/app/dist']);
    const local = sources(null);
    expect(local).toEqual(expect.arrayContaining(['package.json', 'prisma.config.ts', 'prisma']));
  });

  it('RF-P2: el último USER de runtime y de migrate es 10001:10001 (numérico y distinto de 0)', () => {
    for (const stage of [runtime, migrate]) {
      const users = stage.filter((instruction) => instruction.name === 'USER');
      expect(users.at(-1)?.args).toBe('10001:10001');
      expect(users.at(-1)?.args).toMatch(/^[1-9]\d*:[1-9]\d*$/);
    }
  });

  it('RF-P3: los FROM llevan etiqueta completa de Node, con una única mayor admitida por las engines', () => {
    const froms = instructions.filter((instruction) => instruction.name === 'FROM');
    expect(froms).toHaveLength(5);
    const majors = new Set<number>();
    for (const from of froms) {
      const match = /^node:(\d+)\.\d+\.\d+-bookworm-slim AS [a-z][a-z-]*$/.exec(from.args);
      expect(match, `FROM ${from.args}`).not.toBeNull();
      majors.add(Number(match?.[1]));
    }
    expect(majors.size).toBe(1);
    const [major = 0] = [...majors];
    for (const packageJson of ['backend/package.json', 'frontend/package.json']) {
      expect(satisfiesEngines(major, nodeEngines(packageJson)), packageJson).toBe(true);
    }
  });

  it('RF-P4: ningún ARG ni ENV tiene nombre de credencial, y no hay COPY de .env ni COPY de origen "." o "*"', () => {
    const declarations = instructions.filter((instruction) => ['ARG', 'ENV'].includes(instruction.name));
    for (const declaration of declarations) {
      for (const name of declaredNames(declaration))
        expect(name, `${declaration.name} ${name}`).not.toMatch(CREDENTIAL_NAME);
    }
    const copies = instructions.filter((instruction) => instruction.name === 'COPY');
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) {
      for (const source of copySources(copy)) {
        expect(source, `COPY ${copy.args}`).not.toMatch(/(^|\/)\.env/);
        expect(['.', './', '*', './*']).not.toContain(source);
      }
    }
  });

  it('RF-P8: el CMD de migrate es ["node","dist/db/migrate-cli.js"] y ninguna etapa usa npm ni --env-file', () => {
    expect(shellForm(migrate.filter((instruction) => instruction.name === 'CMD').at(-1))).toBe(
      '["node", "dist/db/migrate-cli.js"]',
    );
    expect(text).not.toMatch(/--env-file/);
    expect(
      instructions.filter((instruction) => /\bnpm start\b|\bnpm run (start|db:deploy)\b/.test(instruction.args)),
    ).toEqual([]);
    for (const stage of [runtime, migrate]) {
      expect(stage.filter((instruction) => instruction.name === 'CMD').at(-1)?.args).not.toMatch(/npm/);
    }
  });

  it('RF-P19: el CMD de runtime es ["node","dist/index.js"], en forma lista, sin npm ni shell', () => {
    const commands = runtime.filter((instruction) => instruction.name === 'CMD');
    expect(commands).toHaveLength(1);
    expect(shellForm(commands[0])).toBe('["node", "dist/index.js"]');
    expect(runtime.some((instruction) => instruction.name === 'ENTRYPOINT')).toBe(false);
  });
});

describe('backend/.dockerignore', () => {
  const text = readOrEmpty('backend/.dockerignore');
  const entries = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  const normalized = entries.map((entry) => entry.replace(/^\//, '').replace(/\/$/, ''));

  it('RF-P4: backend/.dockerignore existe', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('RF-P4: excluye .env, .env.*, node_modules, .git, dist, coverage y tests, y conserva !.env.example', () => {
    for (const required of ['.env', '.env.*', 'node_modules', '.git', 'dist', 'coverage', 'tests']) {
      expect(normalized, required).toContain(required);
    }
    expect(entries.indexOf('!.env.example')).toBeGreaterThan(entries.indexOf('.env.*'));
  });

  it('RF-P4: NO excluye lo que la construcción necesita (paquete, tsconfig, src, prisma)', () => {
    for (const needed of [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'src',
      'prisma',
      'prisma.config.ts',
    ]) {
      expect(normalized, needed).not.toContain(needed);
      expect(
        normalized.filter((entry) => !entry.startsWith('!') && (entry === '*' || entry === `${needed}/**`)),
      ).toEqual([]);
    }
  });
});
