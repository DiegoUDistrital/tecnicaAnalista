import { beforeEach, describe, expect, it, vi } from 'vitest';

const URL_SENTINEL = 'postgresql://reader:centinela-T4@127.0.0.1:5433/todo_app';

const created = vi.hoisted(() => ({ adapters: [] as unknown[], clients: [] as unknown[] }));

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {
    constructor(public readonly options: unknown) {
      created.adapters.push(this);
    }
  },
}));
vi.mock('../../src/generated/prisma/client', () => ({
  PrismaClient: class {
    constructor(public readonly options: unknown) {
      created.clients.push(this);
    }
  },
}));
vi.mock('../../src/server/config/frontend-config', () => ({
  getConfig: () => ({ readerDatabaseUrl: URL_SENTINEL }),
}));

describe('getReaderDatabase', () => {
  beforeEach(() => {
    created.adapters.length = 0;
    created.clients.length = 0;
    Reflect.deleteProperty(globalThis, '__todoReaderDatabase');
    vi.resetModules();
  });

  it('RF-F3: crea el cliente una sola vez con READER_DATABASE_URL de la configuración y log vacío', async () => {
    const { getReaderDatabase } = await import('../../src/server/counters/reader-database');
    const first = getReaderDatabase();
    const second = getReaderDatabase();
    expect(second).toBe(first);
    expect(created.clients).toHaveLength(1);
    expect(created.adapters).toHaveLength(1);
    expect(created.adapters[0]).toHaveProperty('options', { connectionString: URL_SENTINEL });
    expect(created.clients[0]).toHaveProperty('options', { adapter: created.adapters[0], log: [] });
  });

  it('RF-F3: tras recargar el módulo (next dev) reutiliza el cliente guardado en globalThis', async () => {
    const firstModule = await import('../../src/server/counters/reader-database');
    const first = firstModule.getReaderDatabase();
    vi.resetModules();
    const secondModule = await import('../../src/server/counters/reader-database');
    expect(secondModule.getReaderDatabase()).toBe(first);
    expect(created.clients).toHaveLength(1);
  });
});
