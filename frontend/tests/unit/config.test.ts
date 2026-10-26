import { describe, expect, it, vi } from 'vitest';
import { ConfigError, type ConfigVariable } from '../../src/server/config/config-error';
import {
  EXAMPLE_API_KEY,
  createConfigProvider,
  getConfig,
  parseConfig,
  type ConfigEnv,
} from '../../src/server/config/frontend-config';
import { createLogger } from '../../src/server/logging/logger';

const VALID_KEY = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV'.slice(0, 43);
const VALID_DB = 'postgresql://reader:change-me@127.0.0.1:5433/todo_app';
const SENTINEL = 'centinela-valor-secreto-T3-5521';

function env(overrides: Record<string, string | undefined> = {}): ConfigEnv {
  return { BACKEND_URL: 'http://127.0.0.1:3000', API_KEY: VALID_KEY, READER_DATABASE_URL: VALID_DB, ...overrides };
}

/** Variables que el esquema marca como inválidas para ese entorno (vacío si es válido). */
function invalidNames(source: ConfigEnv): readonly ConfigVariable[] {
  try {
    parseConfig(source);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).variables;
  }
}

describe('parseConfig: forma general', () => {
  it('RF-F23: un entorno válido devuelve la configuración con BACKEND_URL como origen y sin lista de hosts', () => {
    expect(parseConfig(env())).toEqual({
      backendUrl: 'http://127.0.0.1:3000',
      apiKey: VALID_KEY,
      readerDatabaseUrl: VALID_DB,
      allowedHosts: undefined,
    });
  });

  it('RF-F23: cada variable obligatoria ausente, vacía, de solo espacios o con espacios en los extremos es inválida', () => {
    for (const name of ['BACKEND_URL', 'API_KEY', 'READER_DATABASE_URL'] as const) {
      const good = env()[name] ?? '';
      for (const value of [undefined, '', '   ', ` ${good}`, `${good} `, `${good}\n`]) {
        expect(invalidNames(env({ [name]: value })), `${name}=${JSON.stringify(value)}`).toEqual([name]);
      }
    }
  });

  it('RF-F23: dos variables inválidas a la vez se nombran ambas, en orden fijo, y sin sus valores', () => {
    const source = env({
      READER_DATABASE_URL: `postgresql://writer:${SENTINEL}@h/db`,
      BACKEND_URL: `ftp://${SENTINEL}`,
    });
    const message = (() => {
      try {
        parseConfig(source);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();

    expect(invalidNames(source)).toEqual(['BACKEND_URL', 'READER_DATABASE_URL']);
    expect(message).toBe('Configuración del frontend inválida: BACKEND_URL, READER_DATABASE_URL.');
    expect(message).not.toContain(SENTINEL);
  });

  it('RF-F23: con las cuatro inválidas se nombran las cuatro en el orden fijo', () => {
    const source = { BACKEND_URL: '', API_KEY: '', READER_DATABASE_URL: '', ALLOWED_HOSTS: '' };

    expect(invalidNames(source)).toEqual(['BACKEND_URL', 'API_KEY', 'READER_DATABASE_URL', 'ALLOWED_HOSTS']);
  });

  it('RF-F23: solo lee los cuatro nombres (un objeto con otras claves no las toca ni las copia)', () => {
    const read: string[] = [];
    const watched = new Proxy(
      { ...env(), OWNER_DATABASE_URL: SENTINEL, WRITER_PASSWORD: SENTINEL },
      {
        get(target, key) {
          read.push(String(key));
          return Reflect.get(target, key) as unknown;
        },
      },
    );

    const config = parseConfig(watched);

    expect([...new Set(read)].sort()).toEqual(['ALLOWED_HOSTS', 'API_KEY', 'BACKEND_URL', 'READER_DATABASE_URL']);
    expect(JSON.stringify(config)).not.toContain(SENTINEL);
    expect(Object.keys(config).sort()).toEqual(['allowedHosts', 'apiKey', 'backendUrl', 'readerDatabaseUrl']);
  });
});

describe('parseConfig: BACKEND_URL', () => {
  it('RF-F23: BACKEND_URL con http o https, con y sin puerto, es válida y se normaliza a origen (mayúsculas)', () => {
    const cases: [string, string][] = [
      ['http://127.0.0.1:3000', 'http://127.0.0.1:3000'],
      ['https://api.example.com', 'https://api.example.com'],
      ['HTTP://LOCALHOST:3000', 'http://localhost:3000'],
      ['https://API.Example.com:443', 'https://api.example.com'],
    ];
    for (const [raw, origin] of cases) {
      expect(parseConfig(env({ BACKEND_URL: raw })).backendUrl, raw).toBe(origin);
    }
  });

  it('RF-F23: BACKEND_URL con ruta, consulta, fragmento, barra final, credenciales o esquema distinto es inválida', () => {
    const bad = [
      'http://127.0.0.1:3000/api',
      'http://127.0.0.1:3000/',
      'http://127.0.0.1:3000?x=1',
      'http://127.0.0.1:3000?',
      'http://127.0.0.1:3000#frag',
      'http://127.0.0.1:3000#',
      'http://user@127.0.0.1:3000',
      'http://user:pass@127.0.0.1:3000',
      'ftp://127.0.0.1:3000',
      'postgresql://127.0.0.1:3000',
      'http://127.0.0.1:3000\\',
      '127.0.0.1:3000',
      'no es una url',
      'http://',
    ];
    for (const raw of bad) {
      expect(invalidNames(env({ BACKEND_URL: raw })), raw).toEqual(['BACKEND_URL']);
    }
  });
});

describe('parseConfig: API_KEY (misma regla que RF-G6 del backend)', () => {
  // Misma tabla de casos que backend/tests/unit/config.test.ts, bloque «RF-G6: API_KEY»: si una cambia, cambia la otra.
  const extend = (value: string, length: number): string => value + 'a'.repeat(length - value.length);

  it('RF-F23: API_KEY válida de 43 y de 128 caracteres; de 42 y de 129 es inválida (RF-G6)', () => {
    expect(parseConfig(env({ API_KEY: VALID_KEY })).apiKey).toBe(VALID_KEY);
    expect(parseConfig(env({ API_KEY: extend(VALID_KEY, 128) })).apiKey).toHaveLength(128);
    expect(invalidNames(env({ API_KEY: VALID_KEY.slice(0, 42) }))).toEqual(['API_KEY']);
    expect(invalidNames(env({ API_KEY: extend(VALID_KEY, 129) }))).toEqual(['API_KEY']);
  });

  it('RF-F23: API_KEY con un carácter fuera de A-Za-z0-9_- (punto, más, espacio) es inválida (RF-G6)', () => {
    for (const bad of ['.', '+', ' ', '=', '/']) {
      expect(invalidNames(env({ API_KEY: `${VALID_KEY.slice(0, 42)}${bad}` })), bad).toEqual(['API_KEY']);
    }
    expect(parseConfig(env({ API_KEY: `${VALID_KEY.slice(0, 41)}_-` })).apiKey).toHaveLength(43);
  });

  it('RF-F23: API_KEY con 9 caracteres distintos se rechaza y con 10 se acepta; A repetida 43 veces se rechaza', () => {
    const nine = 'abcdefghi'.repeat(5).slice(0, 43);
    const ten = 'abcdefghij'.repeat(5).slice(0, 43);

    expect(new Set(nine).size).toBe(9);
    expect(invalidNames(env({ API_KEY: nine }))).toEqual(['API_KEY']);
    expect(invalidNames(env({ API_KEY: 'A'.repeat(43) }))).toEqual(['API_KEY']);
    expect(new Set(ten).size).toBe(10);
    expect(parseConfig(env({ API_KEY: ten })).apiKey).toBe(ten);
  });

  it('RF-F23: el valor de ejemplo de API_KEY se rechaza (RF-G6)', () => {
    expect(EXAMPLE_API_KEY).toBe('change-me-use-randomBytes-32');
    expect(invalidNames(env({ API_KEY: EXAMPLE_API_KEY }))).toEqual(['API_KEY']);
  });
});

describe('parseConfig: READER_DATABASE_URL', () => {
  it('RF-F23: READER_DATABASE_URL acepta postgresql y postgres, con el usuario reader y contraseña', () => {
    for (const raw of [VALID_DB, VALID_DB.replace('postgresql', 'postgres'), 'postgresql://%72eader:pw@db:5432/x']) {
      expect(parseConfig(env({ READER_DATABASE_URL: raw })).readerDatabaseUrl, raw).toBe(raw);
    }
  });

  it('RF-F23: READER_DATABASE_URL con usuario writer, owner, Reader, reader%00, reader%20 o %zz es inválida', () => {
    for (const user of ['writer', 'owner', 'Reader', 'reader%00', 'reader%20', 'reader%zz', 'readers', '']) {
      const raw = `postgresql://${user}:change-me@127.0.0.1:5433/todo_app`;
      expect(invalidNames(env({ READER_DATABASE_URL: raw })), user).toEqual(['READER_DATABASE_URL']);
    }
  });

  it('RF-F23: READER_DATABASE_URL sin contraseña, sin base, con consulta, fragmento o ruta con barra extra es inválida', () => {
    const bad = [
      'postgresql://reader@127.0.0.1:5433/todo_app',
      'postgresql://reader:@127.0.0.1:5433/todo_app',
      'postgresql://reader:change-me@127.0.0.1:5433',
      'postgresql://reader:change-me@127.0.0.1:5433/',
      'postgresql://reader:change-me@127.0.0.1:5433/todo_app/',
      'postgresql://reader:change-me@127.0.0.1:5433/todo_app/otra',
      'postgresql://reader:change-me@127.0.0.1:5433/todo_app?sslmode=require',
      'postgresql://reader:change-me@127.0.0.1:5433/todo_app?',
      'postgresql://reader:change-me@127.0.0.1:5433/todo_app#x',
      'postgresql://reader:change-me@:5433/todo_app',
      'mysql://reader:change-me@127.0.0.1:5433/todo_app',
      'http://reader:change-me@127.0.0.1:5433/todo_app',
      'reader:change-me@127.0.0.1:5433/todo_app',
    ];
    for (const raw of bad) {
      expect(invalidNames(env({ READER_DATABASE_URL: raw })), raw).toEqual(['READER_DATABASE_URL']);
    }
  });
});

describe('parseConfig: ALLOWED_HOSTS', () => {
  it('RF-F23: ALLOWED_HOSTS ausente es válida (no se valida el Host) y presente se convierte en lista', () => {
    expect(parseConfig(env()).allowedHosts).toBeUndefined();
    expect(parseConfig(env({ ALLOWED_HOSTS: 'localhost:3001' })).allowedHosts).toEqual(['localhost:3001']);
    expect(parseConfig(env({ ALLOWED_HOSTS: 'localhost:3001,127.0.0.1:3001,app.example.com' })).allowedHosts).toEqual([
      'localhost:3001',
      '127.0.0.1:3001',
      'app.example.com',
    ]);
  });

  it('RF-F23: ALLOWED_HOSTS con espacios, comodines, entradas vacías, mayúsculas, esquema o ruta es inválida', () => {
    const bad = [
      'localhost:3001, 127.0.0.1:3001',
      ' localhost:3001',
      '*.example.com',
      '*',
      'localhost:3001,',
      ',localhost:3001',
      'a.example,,b.example',
      'Localhost:3001',
      'http://localhost:3001',
      'localhost:3001/x',
      'localhost:123456',
      'localhost:',
      '',
      '   ',
    ];
    for (const raw of bad) {
      expect(invalidNames(env({ ALLOWED_HOSTS: raw })), JSON.stringify(raw)).toEqual(['ALLOWED_HOSTS']);
    }
  });
});

describe('createConfigProvider', () => {
  function recordingProvider(source: ConfigEnv) {
    const lines: Record<string, unknown>[] = [];
    const readEnv = vi.fn(() => source);
    const logger = createLogger({
      write: (line) => {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    });
    return { lines, readEnv, getConfig: createConfigProvider({ readEnv, logger }) };
  }

  it('RF-F23: el proveedor no valida al importar ni al crearse, valida en la primera llamada y recuerda el éxito', () => {
    const { readEnv, getConfig: provider } = recordingProvider(env());

    expect(readEnv).not.toHaveBeenCalled();
    const first = provider();
    const second = provider();

    expect(second).toBe(first);
    expect(readEnv).toHaveBeenCalledTimes(1);
  });

  it('RF-F23: con variables inválidas registra config_invalid UNA vez con los nombres y relanza siempre el mismo error', () => {
    const { lines, readEnv, getConfig: provider } = recordingProvider(env({ API_KEY: SENTINEL, BACKEND_URL: '' }));

    const errors = [0, 1, 2].map(() => {
      try {
        provider();
        return undefined;
      } catch (error) {
        return error;
      }
    });

    expect(errors[0]).toBeInstanceOf(ConfigError);
    expect(errors[1]).toBe(errors[0]);
    expect(errors[2]).toBe(errors[0]);
    expect(readEnv).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'error',
      event: 'config_invalid',
      errorName: 'ConfigError',
      variables: ['BACKEND_URL', 'API_KEY'],
    });
    expect(JSON.stringify(lines)).not.toContain(SENTINEL);
  });

  it('RF-F23: un fallo inesperado al leer el entorno (no un ConfigError) se propaga sin registrar config_invalid', () => {
    const lines: string[] = [];
    const failure = new TypeError('fallo-inesperado');
    const provider = createConfigProvider({
      readEnv: () => {
        throw failure;
      },
      logger: createLogger({ write: (line) => lines.push(line) }),
    });

    expect(() => provider()).toThrow(failure);
    expect(lines).toEqual([]);
  });

  it('RF-F23: getConfig lee solo los cuatro nombres de process.env en el primer uso, no al importar', () => {
    vi.stubEnv('BACKEND_URL', 'http://127.0.0.1:3000');
    vi.stubEnv('API_KEY', VALID_KEY);
    vi.stubEnv('READER_DATABASE_URL', VALID_DB);
    vi.stubEnv('ALLOWED_HOSTS', undefined);
    try {
      expect(getConfig().backendUrl).toBe('http://127.0.0.1:3000');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
