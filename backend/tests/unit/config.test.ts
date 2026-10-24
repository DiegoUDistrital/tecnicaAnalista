import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config';
import { ConfigError } from '../../src/errors/config-error';

const VALID_URL = 'postgresql://writer:change-me@127.0.0.1:5433/todo_app';

function messageOf(env: Record<string, string | undefined>): string {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).message;
  }
  throw new Error('loadConfig no lanzó ningún error');
}

const INT_VARIABLES = [
  { name: 'DB_POOL_MAX', min: 1, max: 100 },
  { name: 'DB_POOL_IDLE_TIMEOUT_MS', min: 1000, max: 600000 },
  { name: 'DB_POOL_CONNECTION_TIMEOUT_MS', min: 100, max: 60000 },
] as const;

describe('RF-D1: enteros', () => {
  it.each(['10abc', '1e3', ' 10', '', '010', '0', '-5', '10.5', '101'])('RF-D1: rechaza %j en DB_POOL_MAX', (value) => {
    expect(messageOf({ DATABASE_URL: VALID_URL, DB_POOL_MAX: value })).toBe(
      'DB_POOL_MAX: entero inválido o fuera de rango',
    );
  });

  it.each(['1', '10', '100'])('RF-D1: acepta %j en DB_POOL_MAX', (value) => {
    expect(loadConfig({ DATABASE_URL: VALID_URL, DB_POOL_MAX: value }).pool.max).toBe(Number(value));
  });

  it.each(INT_VARIABLES)('RF-D1: $name respeta sus límites $min-$max', ({ name, min, max }) => {
    const env = (value: string) => ({ DATABASE_URL: VALID_URL, [name]: value });
    const expected = `${name}: entero inválido o fuera de rango`;

    expect(messageOf(env(String(min - 1)))).toBe(expected);
    expect(messageOf(env(String(max + 1)))).toBe(expected);
    expect(() => loadConfig(env(String(min)))).not.toThrow();
    expect(() => loadConfig(env(String(max)))).not.toThrow();
  });

  it('RF-D1: un entero que no es seguro (demasiado largo) es inválido', () => {
    expect(messageOf({ DATABASE_URL: VALID_URL, DB_POOL_MAX: '99999999999999999999' })).toBe(
      'DB_POOL_MAX: entero inválido o fuera de rango',
    );
  });

  it('RF-D1: ausente aplica el defecto (10, 30000, 5000)', () => {
    expect(loadConfig({ DATABASE_URL: VALID_URL }).pool).toEqual({
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  });

  it.each(INT_VARIABLES)('RF-D1: $name vacía es inválida (no toma el defecto)', ({ name }) => {
    expect(messageOf({ DATABASE_URL: VALID_URL, [name]: '' })).toBe(`${name}: entero inválido o fuera de rango`);
  });
});

describe('RF-D1: DATABASE_URL', () => {
  const FORMAT = 'DATABASE_URL: formato inválido';
  const ROLE = 'DATABASE_URL: debe usar el rol writer';

  it.each([
    ['sin nombre de BD', 'postgresql://writer:change-me@127.0.0.1:5433', FORMAT],
    ['con barra final y sin nombre de BD', 'postgresql://writer:change-me@127.0.0.1:5433/', FORMAT],
    ['con más de un segmento', 'postgresql://writer:change-me@127.0.0.1:5433/a/b', FORMAT],
    ['sin host', 'postgresql://writer:change-me@/todo_app', FORMAT],
    ['sin contraseña', 'postgresql://writer@127.0.0.1:5433/todo_app', FORMAT],
    ['con contraseña vacía', 'postgresql://writer:@127.0.0.1:5433/todo_app', FORMAT],
    ['protocolo mysql', 'mysql://writer:change-me@127.0.0.1:5433/todo_app', FORMAT],
    ['con ?user=owner', `${VALID_URL}?user=owner`, FORMAT],
    ['con ? final vacío', `${VALID_URL}?`, FORMAT],
    ['con # final vacío', `${VALID_URL}#`, FORMAT],
    ['malformada', 'esto no es una url', FORMAT],
    ['usuario con porcentaje inválido', 'postgresql://%E0%A4%A:change-me@127.0.0.1:5433/todo_app', FORMAT],
    ['usuario Writer', 'postgresql://Writer:change-me@127.0.0.1:5433/todo_app', ROLE],
    ['usuario owner', 'postgresql://owner:change-me@127.0.0.1:5433/todo_app', ROLE],
  ])('RF-D1: %s', (_label, url, expected) => {
    expect(messageOf({ DATABASE_URL: url })).toBe(expected);
  });

  it('RF-D1: acepta %77riter (usuario codificado con porcentaje) y el protocolo postgres', () => {
    const encoded = loadConfig({ DATABASE_URL: 'postgresql://%77riter:change-me@127.0.0.1:5433/todo_app' });
    const short = loadConfig({ DATABASE_URL: 'postgres://writer:change-me@localhost/todo_app' });

    expect(encoded.databaseUrl).toBe('postgresql://%77riter:change-me@127.0.0.1:5433/todo_app');
    expect(short.databaseUrl).toBe('postgres://writer:change-me@localhost/todo_app');
  });

  it('RF-D1: DATABASE_URL ausente es «obligatoria» y vacía es «formato inválido»', () => {
    expect(messageOf({})).toBe('DATABASE_URL: obligatoria');
    expect(messageOf({ DATABASE_URL: '' })).toBe(FORMAT);
  });

  it('RF-D1: con dos fallos en la misma URL solo informa de «formato inválido»', () => {
    expect(messageOf({ DATABASE_URL: 'postgresql://owner@127.0.0.1:5433/todo_app' })).toBe(FORMAT);
  });
});

describe('RF-D1: mensajes sin valores y orden', () => {
  it('RF-D1: la contraseña centinela de una URL inválida no aparece en el message', () => {
    const message = messageOf({ DATABASE_URL: 'mysql://writer:sentinel-pw-7@127.0.0.1:5433/todo_app' });
    const wrongRole = messageOf({ DATABASE_URL: 'postgresql://owner:sentinel-pw-7@127.0.0.1:5433/todo_app' });

    expect(message).not.toContain('sentinel-pw-7');
    expect(wrongRole).not.toContain('sentinel-pw-7');
  });

  it('RF-D1: varias inválidas a la vez: todas nombradas, en el orden del esquema, mensaje = concatenación', () => {
    const message = messageOf({
      DATABASE_URL: 'postgresql://owner:change-me@127.0.0.1:5433/todo_app',
      DB_POOL_MAX: '0',
      DB_POOL_IDLE_TIMEOUT_MS: '999',
      DB_POOL_CONNECTION_TIMEOUT_MS: 'abc',
    });

    expect(message).toBe(
      [
        'DATABASE_URL: debe usar el rol writer',
        'DB_POOL_MAX: entero inválido o fuera de rango',
        'DB_POOL_IDLE_TIMEOUT_MS: entero inválido o fuera de rango',
        'DB_POOL_CONNECTION_TIMEOUT_MS: entero inválido o fuera de rango',
      ].join('; '),
    );
  });

  it('RF-D1: una configuración válida devuelve databaseUrl y pool', () => {
    expect(
      loadConfig({
        DATABASE_URL: VALID_URL,
        DB_POOL_MAX: '20',
        DB_POOL_IDLE_TIMEOUT_MS: '1000',
        DB_POOL_CONNECTION_TIMEOUT_MS: '60000',
      }),
    ).toEqual({
      databaseUrl: VALID_URL,
      pool: { max: 20, idleTimeoutMillis: 1000, connectionTimeoutMillis: 60000 },
    });
  });
});
