import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySchema, getTestDatabase, resetSchema, truncateTasks } from '../helpers/test-database';

/** Parte el texto por los marcadores de consulta y devuelve la sentencia de cada una (sin comentarios). */
function extractStatements(text: string): string[] {
  const parts = text.split(/^-- Consulta \d+:/m).slice(1);
  return parts.map((part) => {
    // La primera línea es el resto del comentario del marcador.
    const [markerRest = '', ...lines] = part.split('\n');
    const isComment = (line: string): boolean => line.trim().startsWith('--');
    if ([markerRest, ...lines.filter(isComment)].some((comment) => comment.includes(';'))) {
      throw new Error('Los comentarios de queries.sql no pueden contener ";"');
    }
    const code = lines
      .filter((line) => !isComment(line))
      .join('\n')
      .trim();
    // Con exactamente una sentencia, el único ';' del texto es el último carácter.
    if (code.split(';').length !== 2 || !code.endsWith(';')) {
      throw new Error('Cada consulta debe tener exactamente una sentencia terminada en ";"');
    }
    return code.slice(0, -1);
  });
}

const queriesText = readFileSync(resolve(__dirname, '..', '..', 'queries.sql'), 'utf8');

let owner: Client;

beforeAll(async () => {
  await resetSchema();
  await applySchema();
  owner = await getTestDatabase().ownerClient();
  await truncateTasks();
});

afterAll(async () => {
  await owner.end();
});

describe('RF-D17: mecanismo de extracción de sentencias', () => {
  it('RF-D17: un ";" dentro de un comentario hace fallar la extracción', () => {
    const bad = '-- Consulta 1: texto; con punto y coma\nSELECT 1;\n-- Consulta 2: ok\nSELECT 2;\n';
    expect(() => extractStatements(bad)).toThrow(/no pueden contener/);
    const badLine = '-- Consulta 1: ok\n-- otra línea; mala\nSELECT 1;\n';
    expect(() => extractStatements(badLine)).toThrow(/no pueden contener/);
  });

  it('RF-D17: dos sentencias en una consulta o ninguna terminación hacen fallar la extracción', () => {
    expect(() => extractStatements('-- Consulta 1: a\nSELECT 1; SELECT 2;\n')).toThrow();
    expect(() => extractStatements('-- Consulta 1: a\nSELECT 1\n')).toThrow();
  });

  it('RF-D17: un texto correcto devuelve las sentencias sin el punto y coma', () => {
    const good = '-- Consulta 1: a\nSELECT 1;\n-- Consulta 2: b\nSELECT 2;\n';
    expect(extractStatements(good)).toEqual(['SELECT 1', 'SELECT 2']);
  });
});

describe('RF-D17: backend/queries.sql', () => {
  const statements = extractStatements(queriesText);
  const [listQuery, countQuery] = statements;

  it('RF-D17: contiene exactamente dos consultas, cada una con una sola sentencia', () => {
    expect(statements).toHaveLength(2);
  });

  it('RF-D17: los marcadores de consulta existen y la consulta 1 explica que psql -f no sirve', () => {
    expect(queriesText).toContain('-- Consulta 1:');
    expect(queriesText).toContain('-- Consulta 2:');
    expect(queriesText).toMatch(/psql -f/);
  });

  beforeAll(async () => {
    await owner.query('TRUNCATE TABLE tasks');
    const tied = '2026-01-02T10:00:00.000Z';
    const rows = [
      ['00000000-0000-4000-8000-000000000003', 'empate B', true, tied],
      ['00000000-0000-4000-8000-000000000001', 'empate A', true, tied],
      ['00000000-0000-4000-8000-000000000009', 'más reciente', true, '2026-01-03T10:00:00.000Z'],
      ['00000000-0000-4000-8000-000000000005', 'antigua', true, '2026-01-01T10:00:00.000Z'],
      ['00000000-0000-4000-8000-000000000007', 'pendiente 1', false, '2026-01-01T10:00:00.000Z'],
      ['00000000-0000-4000-8000-000000000008', 'pendiente 2', false, '2026-01-04T10:00:00.000Z'],
    ];
    for (const [id, title, completed, createdAt] of rows) {
      await owner.query('INSERT INTO tasks (id, title, completed, "createdAt") VALUES ($1, $2, $3, $4)', [
        id,
        title,
        completed,
        createdAt,
      ]);
    }
  });

  it('RF-D17: la consulta 1 filtra por completed y ordena por createdAt desc e id asc', async () => {
    const done = await owner.query<{ title: string }>(listQuery ?? '', [true]);
    expect(done.fields.map((field) => field.name)).toEqual(['id', 'title', 'description', 'completed', 'createdAt']);
    expect(done.rows.map((row) => row.title)).toEqual(['más reciente', 'empate A', 'empate B', 'antigua']);

    const pending = await owner.query<{ title: string }>(listQuery ?? '', [false]);
    expect(pending.rows.map((row) => row.title)).toEqual(['pendiente 2', 'pendiente 1']);
  });

  it('RF-D17: la consulta 2 coincide con la vista task_counts normalizada por completed', async () => {
    const direct = await owner.query(countQuery ?? '');
    expect(direct.fields.map((field) => field.name)).toEqual(['completed', 'total']);
    const view = await owner.query('SELECT completed, total FROM task_counts ORDER BY completed');
    expect(direct.rows).toEqual(view.rows);
    expect(direct.rows).toEqual([
      { completed: false, total: 2 },
      { completed: true, total: 4 },
    ]);
  });
});
