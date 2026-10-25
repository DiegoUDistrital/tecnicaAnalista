import { describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/pool';
import { createTaskRepository } from '../../src/repositories/task-repository';

interface Call {
  text: string;
  values: unknown[] | undefined;
}

const ROW = {
  id: '3f2b8c1e-0000-4000-8000-000000000001',
  title: 'secret-title-sentinel',
  description: '',
  completed: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function spyDatabase(): { database: Pick<Database, 'query'>; calls: Call[] } {
  const calls: Call[] = [];
  const database: Pick<Database, 'query'> = {
    query: (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return Promise.resolve({ rows: [ROW], rowCount: 1, command: '', oid: 0, fields: [] }) as never;
    },
  };
  return { database, calls };
}

describe('Repositorio de tareas (SQL enviado)', () => {
  it('RF-C21: insert envía el SQL con $1 y $2 y los valores solo en el arreglo de parámetros', async () => {
    const { database, calls } = spyDatabase();
    await createTaskRepository(database).insert({
      title: 'secret-title-sentinel',
      description: 'secret-desc-sentinel',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('$1');
    expect(calls[0]?.text).toContain('$2');
    expect(calls[0]?.text).not.toContain('secret-title-sentinel');
    expect(calls[0]?.text).not.toContain('secret-desc-sentinel');
    expect(calls[0]?.values).toEqual(['secret-title-sentinel', 'secret-desc-sentinel']);
  });

  it('RF-C21: list sin filtro no lleva parámetros ni WHERE', async () => {
    const { database, calls } = spyDatabase();
    await createTaskRepository(database).list();
    expect(calls[0]?.text).not.toMatch(/WHERE/i);
    expect(calls[0]?.text).not.toContain('$1');
    expect(calls[0]?.values ?? []).toEqual([]);
  });

  it.each([true, false])(
    'RF-C21: list con filtro envía $1 y el valor booleano tipado en el arreglo (%s)',
    async (flag) => {
      const { database, calls } = spyDatabase();
      await createTaskRepository(database).list(flag);
      expect(calls[0]?.text).toMatch(/WHERE\s+completed\s*=\s*\$1/);
      expect(calls[0]?.values).toEqual([flag]);
      expect(typeof calls[0]?.values?.[0]).toBe('boolean');
    },
  );

  it('RF-C20: createdAt se pide ya formateado: el SQL trunca los milisegundos y usa UTC', async () => {
    const { database, calls } = spyDatabase();
    const repository = createTaskRepository(database);
    await repository.insert({ title: 't', description: '' });
    await repository.list();
    await repository.list(true);
    for (const call of calls) {
      expect(call.text).toContain(`date_trunc('milliseconds'`);
      expect(call.text).toContain(`AT TIME ZONE 'UTC'`);
    }
  });

  it('RF-C14: el SQL ordena por tasks."createdAt" calificado y luego por id ascendente', async () => {
    const { database, calls } = spyDatabase();
    const repository = createTaskRepository(database);
    await repository.list();
    await repository.list(false);
    for (const call of calls) {
      expect(call.text).toContain('ORDER BY tasks."createdAt" DESC, tasks.id ASC');
    }
  });

  it('RF-C20: insert devuelve la fila que entrega la base de datos', async () => {
    const { database } = spyDatabase();
    expect(await createTaskRepository(database).insert({ title: 't', description: '' })).toEqual(ROW);
  });
});
