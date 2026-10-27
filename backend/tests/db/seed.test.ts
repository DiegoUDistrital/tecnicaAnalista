import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadWriterDatabaseUrl } from '../../src/config/config';
import { buildSeedTasks, SEED_TASKS } from '../../src/db/seed-data';
import { runSeedCommand, seedTasks } from '../../src/db/seed';
import { validateDescription, validateTitle } from '../../src/validation/text-fields';
import { createCaptureLogger } from '../helpers/capture-logger';
import { applySchema, getTestDatabase, resetSchema, truncateTasks } from '../helpers/test-database';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let writer: Client;

beforeAll(async () => {
  await resetSchema();
  await applySchema();
  writer = await getTestDatabase().writerClient();
});

beforeEach(async () => {
  await truncateTasks();
});

afterAll(async () => {
  await writer.end();
});

async function countTasks(): Promise<{ total: number; completed: number }> {
  const result = await writer.query<{ total: string; completed: string }>(
    'SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE completed) AS completed FROM tasks',
  );
  return { total: Number(result.rows[0]?.total), completed: Number(result.rows[0]?.completed) };
}

describe('RF-1: inserción de las tareas de ejemplo', () => {
  it('RF-1: inserta 15 tareas, con pendientes y completadas, con y sin descripción', async () => {
    const result = await seedTasks(writer, NOW);
    expect(result).toEqual({ inserted: 15, existing: 0 });
    const counts = await countTasks();
    expect(counts.total).toBe(15);
    expect(counts.completed).toBeGreaterThan(0);
    expect(counts.completed).toBeLessThan(15);
    const withoutDescription = await writer.query("SELECT 1 FROM tasks WHERE description = ''");
    expect(withoutDescription.rowCount).toBeGreaterThan(0);
    expect(withoutDescription.rowCount).toBeLessThan(15);
  });

  it('RF-1: las fechas de creación van escalonadas hacia atrás desde now', () => {
    const rows = buildSeedTasks(NOW);
    expect(rows).toHaveLength(15);
    expect(rows[0]?.createdAt.getTime()).toBe(NOW.getTime() - 3_600_000);
    expect(rows[14]?.createdAt.getTime()).toBe(NOW.getTime() - 15 * 3_600_000);
  });
});

describe('RF-2: datos válidos', () => {
  it('RF-2: títulos y descripciones cumplen las reglas de la aplicación y uno de título mide 100', () => {
    for (const task of SEED_TASKS) {
      expect(validateTitle(task.title)).toEqual({ ok: true, value: task.title });
      expect(validateDescription(task.description)).toEqual({ ok: true, value: task.description });
    }
    expect(SEED_TASKS.some((task) => Array.from(task.title).length === 100)).toBe(true);
  });

  it('RF-2: los identificadores son UUID v4 y no se repiten', () => {
    const ids = SEED_TASKS.map((task) => task.id);
    expect(ids.every((id) => UUID_V4.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(15);
  });
});

describe('RF-3: repetición segura', () => {
  it('RF-3: dos ejecuciones dejan 15 tareas y la segunda informa 0 insertadas y 15 existentes', async () => {
    await seedTasks(writer, NOW);
    const second = await seedTasks(writer, NOW);
    expect(second).toEqual({ inserted: 0, existing: 15 });
    expect((await countTasks()).total).toBe(15);
  });

  it('RF-3: no modifica una tarea de ejemplo editada y recrea una borrada', async () => {
    await seedTasks(writer, NOW);
    const [first, second] = SEED_TASKS;
    await writer.query("UPDATE tasks SET title = 'Editada' WHERE id = $1", [first?.id]);
    await writer.query('DELETE FROM tasks WHERE id = $1', [second?.id]);
    expect(await seedTasks(writer, NOW)).toEqual({ inserted: 1, existing: 14 });
    const edited = await writer.query<{ title: string }>('SELECT title FROM tasks WHERE id = $1', [first?.id]);
    expect(edited.rows[0]?.title).toBe('Editada');
  });
});

describe('RF-4: solo el rol writer', () => {
  it('RF-4: loadWriterDatabaseUrl acepta la URL de writer y rechaza la de owner o reader sin mostrar valores', () => {
    const writerUrl = process.env['TEST_DATABASE_URL'];
    expect(loadWriterDatabaseUrl({ DATABASE_URL: writerUrl })).toBe(writerUrl);
    for (const name of ['TEST_OWNER_DATABASE_URL', 'TEST_READER_DATABASE_URL']) {
      const otherRoleUrl = process.env[name] ?? '';
      expect(() => loadWriterDatabaseUrl({ DATABASE_URL: otherRoleUrl })).toThrow(
        'DATABASE_URL: debe usar el rol writer',
      );
    }
    expect(() => loadWriterDatabaseUrl({})).toThrow('DATABASE_URL: obligatoria');
  });
});

describe('RF-5: comando de datos de ejemplo', () => {
  it('RF-5: con la base lista imprime el resumen, devuelve 0 y no deja el pool abierto', async () => {
    const capture = createCaptureLogger();
    const env = { DATABASE_URL: process.env['TEST_DATABASE_URL'] };
    expect(await runSeedCommand(env, capture.logger)).toBe(0);
    expect(await runSeedCommand(env, capture.logger)).toBe(0);
    expect(capture.records()).toMatchObject([
      { level: 'info', event: 'Datos de ejemplo: 15 insertadas, 0 ya existían' },
      { level: 'info', event: 'Datos de ejemplo: 0 insertadas, 15 ya existían' },
    ]);
    expect((await countTasks()).total).toBe(15);
  });

  it('RF-5: sin tabla de tareas falla con código distinto de 0 y sin valores en la salida', async () => {
    await resetSchema();
    try {
      const capture = createCaptureLogger();
      const code = await runSeedCommand({ DATABASE_URL: process.env['TEST_DATABASE_URL'] }, capture.logger);
      expect(code).not.toBe(0);
      expect(capture.records()).toMatchObject([{ level: 'error', event: 'seed_failed' }]);
      const output = capture.output();
      expect(output).not.toContain(process.env['TEST_DATABASE_URL'] ?? 'x');
      for (const task of SEED_TASKS) {
        expect(output).not.toContain(task.title);
      }
    } finally {
      await applySchema();
    }
  });

  it('RF-5: con una URL de otro rol falla con código distinto de 0 sin mostrar la URL', async () => {
    const capture = createCaptureLogger();
    const ownerUrl = process.env['TEST_OWNER_DATABASE_URL'] ?? '';
    expect(await runSeedCommand({ DATABASE_URL: ownerUrl }, capture.logger)).not.toBe(0);
    expect(capture.output()).not.toContain(ownerUrl);
  });
});
