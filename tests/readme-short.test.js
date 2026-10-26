import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { headingLevel, readme, section } from './helpers/docs-corpus.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = ['desarrollo', 'backend', 'api', 'frontend', 'despliegue', 'comprobacion-manual', 'decisiones'];

/** @param {string} text */
const norm = (text) => text.replace(/\s+/g, ' ').toLowerCase();

/** Ancla de un encabezado como la calcula GitHub. @param {string} title */
const anchorOf = (title) =>
  title
    .replaceAll('`', '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

/** @param {string} text documento Markdown; devuelve el conjunto de anclas de sus encabezados */
function anchorsOf(text) {
  const anchors = new Set();
  const seen = new Map();
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced || headingLevel(line) === 0) continue;
    const base = anchorOf(line.replace(/^#+ /, ''));
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

describe('README corto y docs-tecnicos/', () => {
  it('RF-R4: el README tiene entre 250 y 400 líneas', () => {
    const lines = readme.split(/\r?\n/).length;
    expect(lines).toBeGreaterThanOrEqual(250);
    expect(lines).toBeLessThanOrEqual(400);
  });

  it('RF-R4: el README conserva las secciones esenciales y no tiene «Comprobación manual»', () => {
    for (const title of [
      'Arranque rápido',
      'Recorrido de una petición',
      'Versiones usadas',
      'Seguridad (resumen)',
      'Cupo compartido por diseño (desviación declarada)',
      'Pruebas',
      'Decisiones técnicas',
      'Riesgos residuales y limitaciones',
      'Trabajo futuro',
      'Documentación técnica',
    ]) {
      expect(section(title).length, `«${title}»`).toBeGreaterThan(0);
      expect(readme, `«${title}» en el README`).toMatch(new RegExp(`^#{2,3} ${title.replace(/[()]/g, '\\$&')}$`, 'm'));
    }
    expect(readme).not.toMatch(/^#{1,6} Comprobación manual$/m);
  });

  it('RF-R4: «Seguridad (resumen)» tiene entre 10 y 15 líneas y enlaza a backend.md', () => {
    const lines = section('Seguridad (resumen)')
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '' && !line.startsWith('#'));
    expect(lines.length).toBeGreaterThanOrEqual(10);
    expect(lines.length).toBeLessThanOrEqual(15);
    expect(section('Seguridad (resumen)')).toContain('docs-tecnicos/backend.md');
  });

  it('RF-R4: las pruebas manuales conservan las cifras exigidas', () => {
    const tests = norm(section('Pruebas'));
    expect(tests).toContain('4 cumple, 6 parcial y 10 no ejecutado');
    expect(tests).toContain('10 de los 20 pasos');
    expect(tests).toContain('2, 5, 6, 8, 9, 12, 13, 16, 18 y 19');
    expect(tests).toContain('6, 8 y 16');
  });

  it('RF-R4: «Decisiones técnicas» tiene D1 a D15 con tres viñetas y enlaza a decisiones.md', () => {
    const decisions = section('Decisiones técnicas');
    const blocks = decisions.split(/^(?=### D\d+\. )/m).filter((block) => block.startsWith('### D'));
    expect(blocks.map((block) => /^### D(\d+)\./.exec(block)?.[1])).toEqual(
      Array.from({ length: 15 }, (_, i) => String(i + 1)),
    );
    for (const block of blocks) {
      const bullets = block.split(/\r?\n/).filter((line) => line.startsWith('- '));
      expect(bullets.length, block.split('\n')[0]).toBe(3);
    }
    expect(decisions).toContain('docs-tecnicos/decisiones.md');
    expect(decisions).not.toMatch(/### D1[6-9]\.|### D2\d\./);
  });

  it('RF-R4: «Riesgos residuales y limitaciones» es breve y conserva los términos exigidos', () => {
    const risks = section('Riesgos residuales y limitaciones');
    expect(risks.split(/\r?\n/).length).toBeLessThanOrEqual(35);
    const text = norm(risks);
    for (const piece of [
      'cupo compartido',
      'sin login',
      'sin https',
      'ubuntu',
      '4 cumple, 6 parcial y 10 no ejecutado',
    ])
      expect(text, piece).toContain(piece);
  });

  it('RF-R4: existen los siete archivos de docs-tecnicos/, no están vacíos y el README los enlaza', () => {
    for (const name of DOCS) {
      const file = path.join(root, 'docs-tecnicos', `${name}.md`);
      expect(existsSync(file), `${name}.md existe`).toBe(true);
      expect(statSync(file).size, `${name}.md no vacío`).toBeGreaterThan(0);
      expect(readme, `enlace a ${name}.md`).toContain(`(docs-tecnicos/${name}.md`);
    }
    const documentation = section('Documentación técnica');
    for (const name of DOCS) expect(documentation, name).toContain(`(docs-tecnicos/${name}.md)`);
  });

  it('RF-R4: todo enlace a docs-tecnicos/ apunta a un archivo y a un encabezado existentes', () => {
    const links = [...readme.matchAll(/\]\((docs-tecnicos\/[^)#]+)(?:#([^)]+))?\)/g)];
    expect(links.length).toBeGreaterThan(7);
    for (const [, relative = '', anchor] of links) {
      const file = path.join(root, relative);
      expect(existsSync(file), relative).toBe(true);
      if (anchor) expect(anchorsOf(readFileSync(file, 'utf8')).has(anchor), `${relative}#${anchor}`).toBe(true);
    }
  });

  it('RF-R4: el índice del README solo tiene anclas internas existentes y enlaces a docs-tecnicos/', () => {
    const anchors = anchorsOf(readme);
    const index = section('Índice');
    for (const [, link = ''] of index.matchAll(/\]\(([^)]+)\)/g)) {
      if (link.startsWith('#')) expect(anchors.has(link.slice(1)), link).toBe(true);
      else expect(link, link).toMatch(/^docs-tecnicos\//);
    }
  });
});
