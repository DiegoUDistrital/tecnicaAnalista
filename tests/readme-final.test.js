import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** README tal cual (para los patrones de línea con la bandera m). */
const raw = readFileSync(path.join(root, 'README.md'), 'utf8');
/** README normalizado: minúsculas y espacios colapsados (los textos se parten en líneas). */
const readme = raw.replace(/\s+/g, ' ').toLowerCase();

/** Lenguaje provisional que no debe volver. */
const PROVISIONAL = ['próximamente', 'estado actual', 'se documentará', 'en construcción'];

/**
 * «pendiente» tiene usos legítimos (tareas pendientes, migraciones pendientes): solo se prohíbe como marcador.
 */
const PENDING_MARKERS = [
  /^pendiente\.?$/m,
  /\(pendiente\)/i,
  /pendiente de (comprobar|documentar|redactar)/i,
  /(queda|quedan) pendientes?\b/i,
  /comprobación pendiente/i,
];

/** Frases que afirman cupo por persona o reenvío de la IP desde el frontend. */
const PER_PERSON_QUOTA = [
  'cada persona tiene su cupo',
  'cupo por persona',
  'cupo propio',
  'si el frontend no reenvía la suya',
  'el frontend reenvía la ip',
  'hasta que el frontend envíe',
  'hasta que el frontend reenvíe',
];

/** Documentos que no se suben a git: el README no puede remitir a ellos. */
const UNVERSIONED = ['specs/', 'docs/constitution', 'memory.md', 'claude.md', 'prueba técnica analista.pdf'];

describe('README final: lenguaje provisional y referencias', () => {
  it('RF-R4: el README no contiene lenguaje provisional', () => {
    for (const phrase of PROVISIONAL) expect(readme.includes(phrase), `«${phrase}»`).toBe(false);
  });

  it('RF-R4: «pendiente» solo se prohíbe como marcador provisional', () => {
    for (const pattern of PENDING_MARKERS) expect(raw.match(pattern)?.[0] ?? null, String(pattern)).toBeNull();
  });

  it('RF-R4: no contiene «Este PR deja el paquete del backend preparado»', () => {
    expect(readme.includes('este pr deja el paquete del backend preparado')).toBe(false);
  });

  it('RF-R4: no afirma cupo por persona ni reenvío de IP', () => {
    for (const phrase of PER_PERSON_QUOTA) expect(readme.includes(phrase), `«${phrase}»`).toBe(false);
  });

  it('RF-R4: no remite a archivos no versionados', () => {
    for (const reference of UNVERSIONED) expect(readme.includes(reference), `«${reference}»`).toBe(false);
  });
});

/** @param {string} relative ruta desde la raíz; devuelve el contenido del archivo */
const file = (relative) => readFileSync(path.join(root, relative), 'utf8');

/**
 * @param {string} title título exacto del encabezado (sin las almohadillas)
 * @returns {string} texto del encabezado hasta el siguiente del mismo nivel o superior; vacío si no existe
 */
function section(title) {
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => headingLevel(line) > 0 && line.replace(/^#+ /, '') === title);
  if (start === -1) return '';
  const level = headingLevel(lines[start] ?? '');
  const end = lines.findIndex((line, i) => i > start && headingLevel(line) > 0 && headingLevel(line) <= level);
  return lines.slice(start, end === -1 ? undefined : end).join(String.fromCharCode(10));
}

/**
 * @param {string} text texto donde buscar
 * @param {RegExp} pattern expresión con un grupo de captura
 * @returns {string} el grupo capturado; falla si no hay coincidencia
 */
function capture(text, pattern) {
  const found = pattern.exec(text);
  if (!found) throw new Error(String(pattern));
  return found[1] ?? '';
}

/** @param {string} line línea del README; devuelve el nivel del encabezado (0 si no lo es) */
const headingLevel = (line) => (/^(#{1,6}) /.exec(line)?.[1] ?? '').length;

/** Normaliza un texto como el README (minúsculas y espacios colapsados). */
/** @param {string} text */
const norm = (text) => text.replace(/\s+/g, ' ').toLowerCase();

describe('README final: secciones de la entrada', () => {
  it('RF-R4: existen las secciones de resumen y alcance, índice, arranque rápido, arquitectura y estructura', () => {
    for (const title of [
      'Resumen y alcance',
      'Índice',
      'Arranque rápido',
      'Arquitectura',
      'Recorrido de una petición',
      'Estructura del repositorio',
      'Versiones usadas',
    ]) {
      expect(section(title).length, `«${title}»`).toBeGreaterThan(0);
    }
    expect(norm(section('Resumen y alcance')), 'alcance').toContain('fuera de alcance');
    expect(section('Índice'), 'índice con enlaces').toMatch(/\]\(#[a-z0-9áéíóúñ-]+\)/);
  });

  it('RF-R4: el arranque rápido cubre clonar, .env, secretos, up, abrir y down', () => {
    const quick = norm(section('Arranque rápido'));
    for (const piece of [
      'git clone',
      'copy-item .env.example .env',
      'cp .env.example .env',
      'randombytes(24)',
      'randombytes(32)',
      'postgres_password',
      'api_key',
      'rate_limit_max',
      'docker compose -f docker-compose.yml up -d --build --wait',
      'http://127.0.0.1:3001',
      'docker compose -f docker-compose.yml down',
    ]) {
      expect(quick, piece).toContain(piece);
    }
    expect(quick, 'down sin -v').not.toMatch(/docker compose [^`\n]*down -v/);
  });

  it('RF-R4: la arquitectura describe el recorrido de una petición de punta a punta', () => {
    const route = norm(section('Recorrido de una petición'));
    for (const piece of ['navegador', '/api/tasks', 'origen', 'api key', 'express', 'writer', 'postgresql', 'reader']) {
      expect(route, piece).toContain(piece);
    }
  });
});

describe('README final: versiones usadas', () => {
  const versions = norm(section('Versiones usadas'));
  const manifests = ['package.json', 'backend/package.json', 'frontend/package.json'].map((name) =>
    JSON.parse(file(name)),
  );
  const declared = Object.assign({}, ...manifests.flatMap((m) => [m.dependencies ?? {}, m.devDependencies ?? {}]));

  it('RF-R4: «Versiones usadas» coincide con los package.json', () => {
    for (const name of [
      'express',
      'express-rate-limit',
      'helmet',
      'pg',
      'prisma',
      '@prisma/adapter-pg',
      'next',
      'react',
      'react-dom',
      'tailwindcss',
      '@tailwindcss/postcss',
      'postcss',
      'typescript',
      'vitest',
      'eslint',
      'typescript-eslint',
      'prettier',
      'supertest',
      'jsdom',
      '@testing-library/react',
    ]) {
      expect(declared[name], `${name} existe en un package.json`).toBeDefined();
      expect(versions, name).toContain(`${name} ${declared[name]}`);
    }
    expect(versions, 'engines').toContain(manifests[0].engines.node);
  });

  it('RF-R4: «Versiones usadas» coincide con la composición y los Dockerfile', () => {
    const image = capture(file('docker-compose.yml'), /image: (postgres:[\w.]+)/);
    const base = capture(file('backend/Dockerfile'), /FROM (node:[\w.-]+) AS deps/);
    expect(versions, image).toContain(image);
    expect(versions, base).toContain(base);
    expect(versions, 'Compose comprobado').toContain('compose v5.3.1');
    expect(versions, 'Docker comprobado').toContain('docker 29.6.2');
  });
});

describe('README final: ejecución sin contradicciones', () => {
  const execution = ['Arranque rápido', 'Instalación', 'Arranque conjunto', 'Primera vez', 'Cómo ejecutar'];

  it('RF-R4: las secciones de ejecución no se contradicen en puertos', () => {
    for (const title of execution) {
      const ports = new Set(
        section(title)
          .match(/\b(?:127\.0\.0\.1|localhost):(\d+)/g)
          ?.map((m) => m.split(':')[1]),
      );
      for (const port of ports) expect(['3000', '3001', '5433'], `${title}: puerto ${port}`).toContain(port);
    }
    expect(section('Arranque conjunto')).toContain('127.0.0.1:3001');
    expect(section('Arranque rápido')).toContain('127.0.0.1:3001');
    expect(section('Primera vez')).toContain('http://127.0.0.1:3001');
    expect(section('Cómo ejecutar'), 'cómo ejecutar remite al arranque conjunto').toContain('«Arranque conjunto»');
  });

  it('RF-R4: las secciones de ejecución no se contradicen en comandos', () => {
    for (const title of execution) {
      const commands = section(title).match(/docker compose [^\n`]*/g) ?? [];
      for (const command of commands) {
        expect(command, `${title}: ${command}`).toMatch(/-f docker-compose(\.dev)?\.yml/);
        expect(command, `${title}: ${command}`).not.toMatch(/down -v/);
      }
    }
    for (const command of section('Arranque rápido').match(/docker compose [^\n`]*/g) ?? []) {
      expect(command, command).toContain('-f docker-compose.yml');
    }
    for (const title of ['Arranque conjunto', 'Primera vez']) {
      for (const command of section(title).match(/docker compose [^\n`]*/g) ?? []) {
        expect(command, command).toContain('-f docker-compose.dev.yml');
      }
    }
    expect(section('Arranque conjunto')).toContain('npm run dev');
    expect(section('Arranque rápido')).not.toContain('npm run dev');
  });

  it('RF-R4: la base de desarrollo y el despliegue no se presentan como provisionales', () => {
    expect(readme).not.toContain('el despliegue se documenta más adelante');
    expect(readme).not.toContain('se va completando por partes');
    expect(readme).not.toContain('se documentan cuando se añadan');
  });
});
