import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../../src/server/config/config-error';
import { CountersReadError, readCounters, toCounters, type ReaderDatabase } from '../../src/server/counters/counters';
import { createLogger } from '../../src/server/logging/logger';

const SECRET = 'centinela-contrasena-T4-9917';
const SECRET_URL = `postgresql://reader:${SECRET}@db.example:5433/todo_app`;

function capture(): { lines: string[]; logger: ReturnType<typeof createLogger> } {
  const lines: string[] = [];
  const logger = createLogger({
    write: (line) => {
      lines.push(line);
    },
    now: () => new Date('2026-10-26T10:00:00.000Z'),
  });
  return { lines, logger };
}

function databaseReturning(rows: unknown): { database: () => ReaderDatabase; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn((_strings: TemplateStringsArray) => Promise.resolve(rows));
  return { database: () => ({ $queryRaw: query }), query };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('toCounters', () => {
  it('RF-F3: filas {true:3,false:5} dan 3, 5 y 8; solo {false:2} da 0, 2 y 2; sin filas da 0, 0 y 0', () => {
    expect(
      toCounters([
        { completed: true, total: 3 },
        { completed: false, total: 5 },
      ]),
    ).toEqual({ available: true, completed: 3, pending: 5, all: 8 });
    expect(toCounters([{ completed: false, total: 2 }])).toEqual({
      available: true,
      completed: 0,
      pending: 2,
      all: 2,
    });
    expect(toCounters([])).toEqual({ available: true, completed: 0, pending: 0, all: 0 });
  });

  const one = { completed: false, total: 1 };
  it.each([
    ['estado repetido', [one, one]],
    ['total negativo', [{ completed: true, total: -1 }]],
    ['total no entero', [{ completed: true, total: 1.5 }]],
    ['total no numerico', [{ completed: true, total: '3' }]],
    ['total NaN', [{ completed: true, total: Number.NaN }]],
    ['total mayor que el entero seguro', [{ completed: true, total: Number.MAX_SAFE_INTEGER + 1 }]],
    ['completed no booleano', [{ completed: 'true', total: 1 }]],
    ['fila que no es objeto', [null]],
    ['falta total', [{ completed: true }]],
    ['mas de dos filas', [one, { completed: true, total: 1 }, one]],
    ['resultado que no es arreglo', { completed: true, total: 1 }],
    ['resultado nulo', null],
  ])('RF-F3: %s es lectura inválida', (_name, rows) => {
    expect(() => toCounters(rows)).toThrow(CountersReadError);
  });
});

describe('readCounters', () => {
  it('RF-F3: lee las filas de la vista y devuelve los contadores', async () => {
    const { database } = databaseReturning([{ completed: true, total: 3 }]);
    await expect(readCounters({ database, logger: capture().logger })).resolves.toEqual({
      available: true,
      completed: 3,
      pending: 0,
      all: 3,
    });
  });

  it('RF-F3: el texto SQL de la llamada contiene exactamente una referencia a task_counts y ninguna a tasks', async () => {
    const { database, query } = databaseReturning([]);
    await readCounters({ database, logger: capture().logger });
    expect(query).toHaveBeenCalledTimes(1);
    const firstArgument = query.mock.calls[0]?.[0] as TemplateStringsArray;
    const sql = firstArgument.join('');
    expect(sql.match(/\btask_counts\b/g)).toHaveLength(1);
    expect(sql).not.toMatch(/\btasks\b/i);
    expect(sql).toBe('SELECT completed, total FROM task_counts');
  });

  it('RF-F3: el schema.prisma del frontend no modela tasks', () => {
    const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
    const code = schema
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/\bmodel\b/);
    expect(code).not.toMatch(/\bview\b/);
    expect(code).not.toMatch(/\btasks?\b/i);
  });

  it('RF-F4: una lectura inválida devuelve available:false y se registra solo la clase', async () => {
    const { database } = databaseReturning([{ completed: true, total: -1 }]);
    const { lines, logger } = capture();
    await expect(readCounters({ database, logger })).resolves.toEqual({ available: false });
    expect(JSON.parse(lines.join('')) as unknown).toEqual({
      time: '2026-10-26T10:00:00.000Z',
      level: 'error',
      event: 'counters_failed',
      errorName: 'CountersReadError',
    });
  });

  it('RF-F4: si la lectura lanza un error con contraseña y URL, devuelve available:false y el log no los contiene', async () => {
    const failure = Object.assign(new Error(`password ${SECRET} en ${SECRET_URL}`), { code: 'ECONNREFUSED' });
    const database = (): ReaderDatabase => ({ $queryRaw: () => Promise.reject(failure) });
    const { lines, logger } = capture();
    await expect(readCounters({ database, logger })).resolves.toEqual({ available: false });
    const raw = lines.join('');
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('db.example');
    expect(Object.keys(JSON.parse(raw) as object)).toEqual(['time', 'level', 'event', 'errorName', 'errorCode']);
  });

  it('RF-F4: un fallo síncrono del cliente también devuelve available:false', async () => {
    const database = (): ReaderDatabase => ({
      $queryRaw: () => {
        throw new Error(SECRET);
      },
    });
    const { lines, logger } = capture();
    await expect(readCounters({ database, logger })).resolves.toEqual({ available: false });
    expect(lines.join('')).not.toContain(SECRET);
  });

  it('RF-F4: si getConfig lanza ConfigError, devuelve available:false (plan B de la configuración)', async () => {
    const database = (): ReaderDatabase => {
      throw new ConfigError(['READER_DATABASE_URL']);
    };
    const { lines, logger } = capture();
    await expect(readCounters({ database, logger })).resolves.toEqual({ available: false });
    expect(JSON.parse(lines.join('')) as unknown).toHaveProperty('errorName', 'ConfigError');
  });

  describe('plazo de 2 segundos', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('RF-F4: con una consulta que nunca responde, al avanzar 2 s devuelve available:false', async () => {
      const database = (): ReaderDatabase => ({ $queryRaw: () => new Promise<unknown>(() => undefined) });
      const { lines, logger } = capture();
      let result: unknown;
      void readCounters({ database, logger }).then((value) => {
        result = value;
      });
      await vi.advanceTimersByTimeAsync(1999);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(result).toEqual({ available: false });
      expect(JSON.parse(lines.join('')) as unknown).toHaveProperty('errorName', 'CountersTimeoutError');
    });

    it('RF-F4: una consulta que rechaza después de perder la carrera no produce rechazo sin manejar', async () => {
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      let rejectLate: (reason: unknown) => void = () => undefined;
      const database = (): ReaderDatabase => ({
        $queryRaw: () =>
          new Promise<unknown>((_resolve, reject) => {
            rejectLate = reject;
          }),
      });
      const pending = readCounters({ database, logger: capture().logger, timeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(50);
      await expect(pending).resolves.toEqual({ available: false });
      rejectLate(new Error(SECRET));
      vi.useRealTimers();
      await new Promise((resolve) => setImmediate(resolve));
      process.off('unhandledRejection', unhandled);
      expect(unhandled).not.toHaveBeenCalled();
    });

    it('RF-F4: una lectura que responde a tiempo limpia el temporizador', async () => {
      const { database } = databaseReturning([]);
      await readCounters({ database, logger: capture().logger });
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
