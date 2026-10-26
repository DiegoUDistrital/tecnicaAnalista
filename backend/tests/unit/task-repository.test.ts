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

function spyDatabase(result: { rows: unknown[]; rowCount: number | null } = { rows: [ROW], rowCount: 1 }): {
  database: Pick<Database, 'query'>;
  calls: Call[];
} {
  const calls: Call[] = [];
  const database: Pick<Database, 'query'> = {
    query: (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return Promise.resolve({ ...result, command: '', oid: 0, fields: [] }) as never;
    },
  };
  return { database, calls };
}

const ID = '3f2b8c1e-0000-4000-8000-0000000000aa';

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

  it('RF-C21: list sin filtro no lleva WHERE y solo envía el tope como $1', async () => {
    const { database, calls } = spyDatabase();
    await createTaskRepository(database).list(undefined, 1000);
    expect(calls[0]?.text).not.toMatch(/WHERE/i);
    expect(calls[0]?.text).not.toContain('$2');
    expect(calls[0]?.values).toEqual([1000]);
  });

  it.each([true, false])(
    'RF-C21: list con filtro envía $1 y el valor booleano tipado en el arreglo (%s)',
    async (flag) => {
      const { database, calls } = spyDatabase();
      await createTaskRepository(database).list(flag, 1000);
      expect(calls[0]?.text).toMatch(/WHERE\s+completed\s*=\s*\$1/);
      expect(calls[0]?.values?.[0]).toBe(flag);
      expect(typeof calls[0]?.values?.[0]).toBe('boolean');
    },
  );

  it('RF-G17: list no interpola el tope en el SQL', async () => {
    const { database, calls } = spyDatabase();
    const repository = createTaskRepository(database);
    await repository.list(undefined, 123);
    await repository.list(true, 456);
    await repository.list(false, 789);
    for (const call of calls) {
      expect(call.text).not.toMatch(/123|456|789/);
    }
  });
});

describe('Repositorio de tareas: update y remove (SQL enviado)', () => {
  it('RF-C15: update solo pone en SET las claves presentes (en orden fijo) y el id va el último', async () => {
    const { database, calls } = spyDatabase();
    const repository = createTaskRepository(database);
    // Las claves se dan en desorden a propósito: el orden del SQL no depende del orden del objeto.
    await repository.update(ID, { completed: true, title: 'nuevo' });
    await repository.update(ID, { description: 'd' });
    await repository.update(ID, { completed: false, description: 'd', title: 't' });
    expect(
      calls.map((call) =>
        call.text
          .replace(/\s+/g, ' ')
          .match(/SET (.*?) WHERE (.*?) RETURNING/)
          ?.slice(1),
      ),
    ).toEqual([
      ['title = $1, completed = $2', 'id = $3'],
      ['description = $1', 'id = $2'],
      ['title = $1, description = $2, completed = $3', 'id = $4'],
    ]);
    expect(calls.map((call) => call.values)).toEqual([
      ['nuevo', true, ID],
      ['d', ID],
      ['t', 'd', false, ID],
    ]);
  });

  it('RF-C15: update no reescribe los ausentes: el SQL no contiene COALESCE ni columnas no enviadas', async () => {
    const { database, calls } = spyDatabase();
    await createTaskRepository(database).update(ID, { completed: true });
    const set = (calls[0]?.text.match(/SET (.*?) WHERE/s)?.[1] ?? '').trim();
    expect(set).toBe('completed = $1');
    expect(calls[0]?.text).not.toMatch(/COALESCE/i);
    expect(calls[0]?.text).not.toMatch(/SET[^]*\b(title|description)\b[^]*WHERE/);
  });

  it('RF-C21: update y remove envían valores e id solo como parámetros (el SQL no contiene título ni id)', async () => {
    const { database, calls } = spyDatabase();
    const repository = createTaskRepository(database);
    await repository.update(ID, { title: 'secret-title-sentinel', description: 'secret-desc-sentinel' });
    await repository.remove(ID);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.text).not.toContain('secret-title-sentinel');
      expect(call.text).not.toContain('secret-desc-sentinel');
      expect(call.text).not.toContain(ID);
      expect(call.values).toContain(ID);
    }
    expect(calls[1]?.text.trim()).toBe('DELETE FROM tasks WHERE id = $1');
    expect(calls[1]?.values).toEqual([ID]);
  });

  it.each([
    [1, true],
    [0, false],
    [null, false],
  ])(
    'RF-C19: remove emite una sola sentencia y sin SELECT; con rowCount %s devuelve %s',
    async (rowCount, expected) => {
      const { database, calls } = spyDatabase({ rows: [], rowCount });
      expect(await createTaskRepository(database).remove(ID)).toBe(expected);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.text).not.toMatch(/SELECT/i);
    },
  );

  it('RF-C15: update con un objeto vacío lanza TypeError sin consultar', async () => {
    const { database, calls } = spyDatabase();
    await expect(createTaskRepository(database).update(ID, {})).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
});
