import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeError, errorCode } from '../../src/server/logging/error-fields';
import { createLogger, type LogContext, type LogEvent } from '../../src/server/logging/logger';

const SECRET = 'centinela-secreto-T2-7731';
const FIXED_TIME = new Date('2026-10-26T10:00:00.000Z');
const FIXED_ISO = '2026-10-26T10:00:00.000Z';

/** Registra un evento con un destino de prueba y devuelve la única línea escrita. */
function logRaw(event: LogEvent, context?: LogContext): string {
  const lines: string[] = [];
  const logger = createLogger({
    write: (line) => {
      lines.push(line);
    },
    now: () => FIXED_TIME,
  });
  logger.error(event, context);
  expect(lines).toHaveLength(1);
  return lines.join('');
}

/** Comprueba que la salida es UNA línea JSON terminada en salto de línea y la devuelve parseada. */
function parse(raw: string): Record<string, unknown> {
  expect(raw.endsWith('\n')).toBe(true);
  expect(raw.slice(0, -1)).not.toContain('\n');
  return JSON.parse(raw) as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLogger', () => {
  it('RF-F31: cada evento es UNA línea JSON con solo time, level, event y los campos permitidos', () => {
    const raw = logRaw('route_failed', {
      method: 'GET',
      route: '/api/tasks',
      status: 500,
      error: new Error('x'),
    });
    const entry = parse(raw);
    expect(Object.keys(entry)).toEqual(['time', 'level', 'event', 'method', 'route', 'status', 'errorName']);
    expect(entry).toEqual({
      time: FIXED_ISO,
      level: 'error',
      event: 'route_failed',
      method: 'GET',
      route: '/api/tasks',
      status: 500,
      errorName: 'Error',
    });
  });

  it('RF-F31: un contexto con message, stack, url, headers, body, query, id, key o valores de variables no los escribe', () => {
    const raw = logRaw('route_failed', {
      message: SECRET,
      stack: SECRET,
      url: SECRET,
      headers: { authorization: SECRET },
      body: SECRET,
      query: SECRET,
      id: SECRET,
      key: SECRET,
      API_KEY: SECRET,
      BACKEND_URL: SECRET,
      method: 'GET',
    });
    expect(raw).not.toContain(SECRET);
    expect(Object.keys(parse(raw))).toEqual(['time', 'level', 'event', 'method']);
  });

  it('RF-F31: route solo admite /api/tasks y /api/tasks/:id (una URL real se descarta); status y method fuera de rango se descartan', () => {
    expect(
      parse(logRaw('route_failed', { route: '/api/tasks/3f1c2d5e-8a0b-4c7d-9e1f-0a2b3c4d5e6f' })),
    ).not.toHaveProperty('route');
    expect(parse(logRaw('route_failed', { route: '/api/tasks' }))).toHaveProperty('route', '/api/tasks');
    expect(parse(logRaw('route_failed', { route: '/api/tasks/:id' }))).toHaveProperty('route', '/api/tasks/:id');
    for (const status of [99, 600, 200.5, Number.NaN, '404']) {
      expect(parse(logRaw('route_failed', { status }))).not.toHaveProperty('status');
    }
    expect(parse(logRaw('route_failed', { status: 404 }))).toHaveProperty('status', 404);
    expect(parse(logRaw('route_failed', { method: 'PATCH' }))).not.toHaveProperty('method');
    expect(parse(logRaw('route_failed', { method: 'get' }))).not.toHaveProperty('method');
    expect(parse(logRaw('route_failed', { method: 'DELETE' }))).toHaveProperty('method', 'DELETE');
  });

  it('RF-F31: variables solo admite nombres de la lista cerrada (BACKEND_URL, API_KEY, READER_DATABASE_URL, ALLOWED_HOSTS)', () => {
    const entry = parse(
      logRaw('config_invalid', {
        variables: ['BACKEND_URL', 'DATABASE_URL', 'API_KEY', 'PORT', 'ALLOWED_HOSTS', 'READER_DATABASE_URL'],
      }),
    );
    expect(entry.variables).toEqual(['BACKEND_URL', 'API_KEY', 'ALLOWED_HOSTS', 'READER_DATABASE_URL']);
    expect(parse(logRaw('config_invalid', { variables: 'API_KEY' }))).not.toHaveProperty('variables');
    expect(parse(logRaw('config_invalid', { variables: ['PORT'] }))).not.toHaveProperty('variables');
  });

  it('RF-F31: un Error con message, cause.message y propiedades con centinelas no deja ningún centinela en la línea', () => {
    const error = Object.assign(new Error(SECRET, { cause: new Error(SECRET) }), {
      code: 'EXAMPLE_CODE',
      password: SECRET,
      url: SECRET,
      key: SECRET,
    });
    const raw = logRaw('route_failed', { error, method: 'POST', route: '/api/tasks', status: 500 });
    expect(raw).not.toContain(SECRET);
    expect(parse(raw)).toEqual({
      time: FIXED_ISO,
      level: 'error',
      event: 'route_failed',
      method: 'POST',
      route: '/api/tasks',
      status: 500,
      errorName: 'Error',
      errorCode: 'EXAMPLE_CODE',
    });
  });

  it('RF-F31: un getter hostil en code o name no hace lanzar al logger', () => {
    const hostile = new Error('x');
    Object.defineProperty(hostile, 'code', {
      get: () => {
        throw new Error('getter hostil');
      },
    });
    Object.defineProperty(hostile, 'name', {
      get: () => {
        throw new Error('getter hostil');
      },
    });
    Object.defineProperty(hostile, 'cause', {
      get: () => {
        throw new Error('getter hostil');
      },
    });
    const entry = parse(logRaw('route_failed', { error: hostile }));
    expect(entry).toEqual({ time: FIXED_ISO, level: 'error', event: 'route_failed', errorName: 'Error' });
  });

  it('RF-F31: sin now inyectado la hora es la actual en ISO 8601 (UTC)', () => {
    const lines: string[] = [];
    const before = Date.now();
    createLogger({
      write: (line) => {
        lines.push(line);
      },
    }).error('route_failed');
    const after = Date.now();
    const time = Date.parse(String(parse(lines.join(''))['time']));
    expect(time).toBeGreaterThanOrEqual(before);
    expect(time).toBeLessThanOrEqual(after);
  });

  it('RF-F31: el destino por defecto escribe en process.stderr (espía) y now es inyectable', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    createLogger({ now: () => FIXED_TIME }).error('config_invalid', { variables: ['API_KEY'] });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(parse(String(spy.mock.calls[0]?.[0]))).toEqual({
      time: FIXED_ISO,
      level: 'error',
      event: 'config_invalid',
      variables: ['API_KEY'],
    });
  });
});

describe('describeError', () => {
  it('RF-F31: describeError usa el nombre de la clase si cumple ^[A-Za-z][A-Za-z0-9_]{0,59}$ y si no Error', () => {
    class ConfigError extends Error {}
    class LongButValidError extends Error {}
    Object.defineProperty(LongButValidError, 'name', { value: 'A'.repeat(60) });
    class BadNameError extends Error {}
    Object.defineProperty(BadNameError, 'name', { value: 'Mal-nombre' });
    class TooLongError extends Error {}
    Object.defineProperty(TooLongError, 'name', { value: 'A'.repeat(61) });

    expect(describeError(new ConfigError('x'))).toBe('ConfigError');
    expect(describeError(new LongButValidError('x'))).toBe('A'.repeat(60));
    expect(describeError(new BadNameError('x'))).toBe('Error');
    expect(describeError(new TooLongError('x'))).toBe('Error');
    expect(describeError(Object.assign(new Error('x'), { name: SECRET }))).toBe('Error');
  });
});

describe('errorCode', () => {
  it('RF-F31: errorCode sale de code o de cause.code solo si cumple ^[A-Z0-9_]{1,40}$ (ECONNREFUSED sí; bad code y 41 caracteres no)', () => {
    expect(errorCode(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe('ECONNREFUSED');
    expect(errorCode(new Error('x', { cause: { code: 'ECONNREFUSED' } }))).toBe('ECONNREFUSED');
    expect(errorCode(Object.assign(new Error('x'), { code: 'bad code' }))).toBeUndefined();
    expect(errorCode(Object.assign(new Error('x'), { code: 'A'.repeat(41) }))).toBeUndefined();
    expect(errorCode(Object.assign(new Error('x'), { code: 'A'.repeat(40) }))).toBe('A'.repeat(40));
  });

  it('RF-F31: un valor lanzado que no es Error se registra solo por typeof; su toString con centinela no se ejecuta', () => {
    let calls = 0;
    const hostile = {
      code: 'ECONNREFUSED',
      toString: () => {
        calls += 1;
        return SECRET;
      },
    };
    const raw = logRaw('route_failed', { error: hostile });
    expect(calls).toBe(0);
    expect(raw).not.toContain(SECRET);
    expect(parse(raw)).toEqual({ time: FIXED_ISO, level: 'error', event: 'route_failed', errorName: 'object' });
    expect(parse(logRaw('route_failed', { error: 'texto' }))).toHaveProperty('errorName', 'string');
    expect(describeError(hostile)).toBe('object');
    expect(errorCode(hostile)).toBeUndefined();
  });
});
