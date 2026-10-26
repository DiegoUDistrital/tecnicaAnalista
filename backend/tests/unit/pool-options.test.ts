import { describe, expect, it } from 'vitest';
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
});
