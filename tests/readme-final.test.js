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
