import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const docsDir = path.join(root, 'docs-tecnicos');

/** README tal cual. */
export const readme = readFileSync(path.join(root, 'README.md'), 'utf8');

/** Archivos `docs-tecnicos/*.md` en orden alfabético (vacío si la carpeta no existe). */
export const docsFiles = existsSync(docsDir)
  ? readdirSync(docsDir)
      .filter((name) => name.endsWith('.md'))
      .sort()
      .map((name) => ({ name: `docs-tecnicos/${name}`, text: readFileSync(path.join(docsDir, name), 'utf8') }))
  : [];

/** Todos los archivos de documentación (README primero) con su nombre. */
export const documents = [{ name: 'README.md', text: readme }, ...docsFiles];

/** README seguido de los archivos de documentación técnica, separados por un salto de línea. */
export const corpus = documents.map((document) => document.text).join('\n');

/** @param {string} line línea de Markdown; devuelve el nivel del encabezado (0 si no lo es) */
export const headingLevel = (line) => (/^(#{1,6}) /.exec(line)?.[1] ?? '').length;

/**
 * @param {string} text documento Markdown
 * @param {string} title título exacto del encabezado (sin las almohadillas)
 * @returns {string} texto del encabezado hasta el siguiente del mismo nivel o superior; vacío si no existe
 */
export function sectionOf(text, title) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => headingLevel(line) > 0 && line.replace(/^#+ /, '') === title);
  if (start === -1) return '';
  const level = headingLevel(lines[start] ?? '');
  const end = lines.findIndex((line, i) => i > start && headingLevel(line) > 0 && headingLevel(line) <= level);
  return lines.slice(start, end === -1 ? undefined : end).join(String.fromCharCode(10));
}

/**
 * @param {string} title título exacto del encabezado
 * @returns {string} la sección del primer documento que la contiene (README primero); vacío si no existe
 */
export function section(title) {
  for (const document of documents) {
    const found = sectionOf(document.text, title);
    if (found) return found;
  }
  return '';
}
