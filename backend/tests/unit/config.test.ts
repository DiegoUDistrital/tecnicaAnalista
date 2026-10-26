import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config';
import { AppError } from '../../src/errors/app-error';
import { ConfigError } from '../../src/errors/config-error';
import { EXAMPLE_API_KEY } from '../../src/security/api-key';
import { baseEnv } from '../helpers/config-env';
import { TEST_API_KEY } from '../helpers/security';

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
    expect(messageOf(baseEnv({ DB_POOL_MAX: value }))).toBe('DB_POOL_MAX: entero inválido o fuera de rango');
  });

  it.each(['1', '10', '100'])('RF-D1: acepta %j en DB_POOL_MAX', (value) => {
    expect(loadConfig(baseEnv({ DB_POOL_MAX: value })).pool.max).toBe(Number(value));
  });

  it.each(INT_VARIABLES)('RF-D1: $name respeta sus límites $min-$max', ({ name, min, max }) => {
    const env = (value: string) => baseEnv({ [name]: value });
    const expected = `${name}: entero inválido o fuera de rango`;

    expect(messageOf(env(String(min - 1)))).toBe(expected);
    expect(messageOf(env(String(max + 1)))).toBe(expected);
    expect(() => loadConfig(env(String(min)))).not.toThrow();
    expect(() => loadConfig(env(String(max)))).not.toThrow();
  });

  it('RF-D1: un entero que no es seguro (demasiado largo) es inválido', () => {
    expect(messageOf(baseEnv({ DB_POOL_MAX: '99999999999999999999' }))).toBe(
      'DB_POOL_MAX: entero inválido o fuera de rango',
    );
  });

  it('RF-D1: ausente aplica el defecto (10, 30000, 5000)', () => {
    expect(loadConfig(baseEnv()).pool).toEqual({
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  });

  it.each(INT_VARIABLES)('RF-D1: $name vacía es inválida (no toma el defecto)', ({ name }) => {
    expect(messageOf(baseEnv({ [name]: '' }))).toBe(`${name}: entero inválido o fuera de rango`);
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
    expect(messageOf(baseEnv({ DATABASE_URL: url }))).toBe(expected);
  });

  it.each([
    ['RF-D1: espacio inicial', ` ${VALID_URL}`],
    ['RF-D1: espacio final', `${VALID_URL} `],
    ['RF-D1: tabulador', `${VALID_URL}\t`],
    ['RF-D1: salto de línea interior', 'postgresql://writer:change-me@127.0.0.1:5433/todo\n_app'],
  ])('%s es «formato inválido» y el valor no aparece en el mensaje', (_label, url) => {
    const message = messageOf(baseEnv({ DATABASE_URL: url }));

    expect(message).toBe(FORMAT);
    expect(message).not.toContain('change-me');
  });

  it('RF-D1: acepta %77riter (usuario codificado con porcentaje) y el protocolo postgres', () => {
    const encoded = loadConfig(baseEnv({ DATABASE_URL: 'postgresql://%77riter:change-me@127.0.0.1:5433/todo_app' }));
    const short = loadConfig(baseEnv({ DATABASE_URL: 'postgres://writer:change-me@localhost/todo_app' }));

    expect(encoded.databaseUrl).toBe('postgresql://%77riter:change-me@127.0.0.1:5433/todo_app');
    expect(short.databaseUrl).toBe('postgres://writer:change-me@localhost/todo_app');
  });

  it('RF-D1: DATABASE_URL ausente es «obligatoria» y vacía es «formato inválido»', () => {
    expect(messageOf(baseEnv({ DATABASE_URL: undefined }))).toBe('DATABASE_URL: obligatoria');
    expect(messageOf(baseEnv({ DATABASE_URL: '' }))).toBe(FORMAT);
  });

  it('RF-D1: con dos fallos en la misma URL solo informa de «formato inválido»', () => {
    expect(messageOf(baseEnv({ DATABASE_URL: 'postgresql://owner@127.0.0.1:5433/todo_app' }))).toBe(FORMAT);
  });
});

describe('RF-D1: mensajes sin valores y orden', () => {
  it('RF-D1: la contraseña centinela de una URL inválida no aparece en el message', () => {
    const message = messageOf(baseEnv({ DATABASE_URL: 'mysql://writer:sentinel-pw-7@127.0.0.1:5433/todo_app' }));
    const wrongRole = messageOf(baseEnv({ DATABASE_URL: 'postgresql://owner:sentinel-pw-7@127.0.0.1:5433/todo_app' }));

    expect(message).not.toContain('sentinel-pw-7');
    expect(wrongRole).not.toContain('sentinel-pw-7');
  });

  it('RF-D1: varias inválidas a la vez: todas nombradas, en el orden del esquema, mensaje = concatenación', () => {
    const message = messageOf(
      baseEnv({
        DATABASE_URL: 'postgresql://owner:change-me@127.0.0.1:5433/todo_app',
        DB_POOL_MAX: '0',
        DB_POOL_IDLE_TIMEOUT_MS: '999',
        DB_POOL_CONNECTION_TIMEOUT_MS: 'abc',
      }),
    );

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
      loadConfig(
        baseEnv({
          DB_POOL_MAX: '20',
          DB_POOL_IDLE_TIMEOUT_MS: '1000',
          DB_POOL_CONNECTION_TIMEOUT_MS: '60000',
        }),
      ),
    ).toEqual({
      databaseUrl: VALID_URL,
      pool: { max: 20, idleTimeoutMillis: 1000, connectionTimeoutMillis: 60000 },
      server: { port: 3000, host: '127.0.0.1', shutdownTimeoutMs: 10000 },
      security: { apiKey: TEST_API_KEY },
    });
  });
});

describe('RF-S1: variables del servicio', () => {
  const PORT_MESSAGE = 'PORT: entero inválido o fuera de rango';
  const SHUTDOWN_MESSAGE = 'SHUTDOWN_TIMEOUT_MS: entero inválido o fuera de rango';
  const HOST_MESSAGE = 'HOST: dirección IP inválida';

  it.each(['0', '65536', '3000abc', '', ' 3000', '03000', '-1', '1e3', '3000.5'])('RF-S1: PORT rechaza %j', (value) => {
    expect(messageOf(baseEnv({ PORT: value }))).toBe(PORT_MESSAGE);
  });

  it.each(['1', '3000', '65535'])('RF-S1: PORT acepta %j', (value) => {
    expect(loadConfig(baseEnv({ PORT: value })).server.port).toBe(Number(value));
  });

  it('RF-S1: PORT ausente vale 3000', () => {
    expect(loadConfig(baseEnv()).server.port).toBe(3000);
  });

  it.each(['999', '120001', '', 'abc'])('RF-S1: SHUTDOWN_TIMEOUT_MS rechaza %j', (value) => {
    expect(messageOf(baseEnv({ SHUTDOWN_TIMEOUT_MS: value }))).toBe(SHUTDOWN_MESSAGE);
  });

  it.each(['1000', '120000'])('RF-S1: SHUTDOWN_TIMEOUT_MS acepta %j', (value) => {
    expect(loadConfig(baseEnv({ SHUTDOWN_TIMEOUT_MS: value })).server.shutdownTimeoutMs).toBe(Number(value));
  });

  it('RF-S1: SHUTDOWN_TIMEOUT_MS ausente vale 10000', () => {
    expect(loadConfig(baseEnv()).server.shutdownTimeoutMs).toBe(10000);
  });

  it.each(['127.0.0.1', '::1', '0.0.0.0', '::'])('RF-S1: HOST acepta %j', (value) => {
    expect(loadConfig(baseEnv({ HOST: value })).server.host).toBe(value);
  });

  it.each(['[::1]', 'fe80::1%eth0', '256.0.0.1', '127.0.0.1 ', ' 127.0.0.1', '127.0.0.1\n', 'localhost', ''])(
    'RF-S1: HOST rechaza %j',
    (value) => {
      expect(messageOf(baseEnv({ HOST: value }))).toBe(HOST_MESSAGE);
    },
  );

  it('RF-S1: HOST ausente vale 127.0.0.1', () => {
    expect(loadConfig(baseEnv()).server.host).toBe('127.0.0.1');
  });

  it('RF-S1: nombra a la vez variables inválidas de la 001 y de la 002, en el orden del esquema y sin valores', () => {
    const message = messageOf(
      baseEnv({
        DB_POOL_MAX: '0',
        PORT: 'port-sentinel-5',
        HOST: 'host-sentinel-3',
        SHUTDOWN_TIMEOUT_MS: '0',
      }),
    );

    expect(message).toBe(
      ['DB_POOL_MAX: entero inválido o fuera de rango', PORT_MESSAGE, HOST_MESSAGE, SHUTDOWN_MESSAGE].join('; '),
    );
    expect(message).not.toContain('port-sentinel-5');
    expect(message).not.toContain('host-sentinel-3');
  });

  it('RF-S1: el error de configuración es el de la 001', () => {
    try {
      loadConfig(baseEnv({ PORT: '0' }));
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toBeInstanceOf(AppError);
      return;
    }
    throw new Error('loadConfig no lanzó ningún error');
  });
});

describe('RF-G6: API_KEY', () => {
  const OBLIGATORY = 'API_KEY: obligatoria';
  const FORMAT = 'API_KEY: formato inválido';
  const EXAMPLE = 'API_KEY: no puede ser el valor de ejemplo';

  it('RF-G6: una key válida llega a security.apiKey', () => {
    expect(loadConfig(baseEnv()).security).toEqual({ apiKey: TEST_API_KEY });
  });

  it(
    'RF-G6: API_KEY de 42 y de 129 caracteres, con un carácter no permitido, vacía y ausente son inválidas ' +
      'y se nombran sin el valor',
    () => {
      const base = TEST_API_KEY;
      const cases: [string | undefined, string][] = [
        [base.slice(0, 42), FORMAT],
        [`${base}${'a'.repeat(86)}`, FORMAT],
        [`${base.slice(0, 42)}.`, FORMAT],
        [`${base.slice(0, 42)}+`, FORMAT],
        [`${base.slice(0, 42)} `, FORMAT],
        ['', FORMAT],
        [undefined, OBLIGATORY],
      ];
      for (const [value, expected] of cases) {
        const message = messageOf(baseEnv({ API_KEY: value }));

        expect(message).toBe(expected);
        if (value !== undefined && value !== '') {
          expect(message).not.toContain(value);
        }
      }
      expect(() => loadConfig(baseEnv({ API_KEY: `${base}${'a'.repeat(85)}` }))).not.toThrow();
    },
  );

  it('RF-G6: el valor de ejemplo (EXAMPLE_API_KEY) se rechaza', () => {
    expect(messageOf(baseEnv({ API_KEY: EXAMPLE_API_KEY }))).toBe(EXAMPLE);
  });

  it(
    'RF-G6: A repetida 43 veces se rechaza; 43 caracteres con solo 9 distintos se rechaza; ' +
      'con 10 distintos se acepta',
    () => {
      const nine = 'abcdefghi'.repeat(5).slice(0, 43);
      const ten = 'abcdefghij'.repeat(5).slice(0, 43);

      expect(messageOf(baseEnv({ API_KEY: 'A'.repeat(43) }))).toBe(FORMAT);
      expect(new Set(nine).size).toBe(9);
      expect(messageOf(baseEnv({ API_KEY: nine }))).toBe(FORMAT);
      expect(new Set(ten).size).toBe(10);
      expect(loadConfig(baseEnv({ API_KEY: ten })).security.apiKey).toBe(ten);
    },
  );

  it('RF-G6: una API_KEY inválida junto a un PORT inválido nombra ambas, sin valores', () => {
    const message = messageOf(baseEnv({ API_KEY: 'corta-sentinel', PORT: 'port-sentinel-9' }));

    expect(message).toBe(['PORT: entero inválido o fuera de rango', FORMAT].join('; '));
    expect(message).not.toContain('corta-sentinel');
    expect(message).not.toContain('port-sentinel-9');
  });

  it('RF-G6: una key centinela inválida no aparece en el mensaje del error', () => {
    const message = messageOf(baseEnv({ API_KEY: 'sentinel-key-value.invalid' }));

    expect(message).toContain('API_KEY');
    expect(message).not.toContain('sentinel-key-value');
  });
});
