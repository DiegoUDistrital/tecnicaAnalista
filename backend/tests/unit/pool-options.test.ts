import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config';
import { buildPoolOptions } from '../../src/db/pool';

describe('RF-D3: buildPoolOptions', () => {
  it('RF-D3: traduce los valores conocidos a las opciones de pg', () => {
    const options = buildPoolOptions({
      connectionString: 'postgresql://writer:pw@127.0.0.1:5433/todo_app',
      max: 7,
      idleTimeoutMillis: 12000,
      connectionTimeoutMillis: 2500,
    });
    expect(options).toEqual({
      connectionString: 'postgresql://writer:pw@127.0.0.1:5433/todo_app',
      max: 7,
      idleTimeoutMillis: 12000,
      connectionTimeoutMillis: 2500,
    });
  });

  it('RF-D3: con los defectos de loadConfig usa 10, 30000 y 5000', () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://writer:pw@127.0.0.1:5433/todo_app' });
    const options = buildPoolOptions({ connectionString: config.databaseUrl, ...config.pool });
    expect(options.max).toBe(10);
    expect(options.idleTimeoutMillis).toBe(30000);
    expect(options.connectionTimeoutMillis).toBe(5000);
    expect(options.connectionString).toBe('postgresql://writer:pw@127.0.0.1:5433/todo_app');
  });
});
