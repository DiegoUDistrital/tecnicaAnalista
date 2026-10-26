import { DatabaseError } from 'pg';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors/app-error';
import { FRAME_PATTERN } from '../../src/logging/error-fields';
import { createLogger } from '../../src/logging/logger';
import { createCaptureLogger } from '../helpers/capture-logger';

const SECRET = 'valor-sensible-7f3a';

function dbError(code: string, message: string): DatabaseError {
  return Object.assign(new DatabaseError(message, 0, 'error'), { code });
}

function stackLines(record: Record<string, unknown> | undefined): string[] {
  const stack = record?.['stack'];
  return typeof stack === 'string' ? stack.split('\n') : [];
}

describe('RF-D18: formato del registro', () => {
  it('RF-D18: escribe una línea JSON con level, event y time ISO 8601, terminada en salto de línea', () => {
    const capture = createCaptureLogger();

    capture.logger.info('server_started');

    expect(capture.lines).toHaveLength(1);
    expect(capture.lines[0]).toBe('{"level":"info","event":"server_started","time":"2026-01-02T03:04:05.678Z"}\n');
  });

  it('RF-D18: warn y error usan su nivel y el orden de claves es level, event, time, contexto', () => {
    const capture = createCaptureLogger();

    capture.logger.warn('slow', { host: 'db', port: 5432 });
    capture.logger.error('failed', { context: { exitCode: 1 } });

    const [warn, error] = capture.records();
    expect(Object.keys(warn ?? {})).toEqual(['level', 'event', 'time', 'host', 'port']);
    expect(warn?.['level']).toBe('warn');
    expect(Object.keys(error ?? {})).toEqual(['level', 'event', 'time', 'exitCode']);
    expect(error?.['level']).toBe('error');
  });

  it('RF-D18: usa un reloj real por defecto y el inyectado cuando se da', () => {
    const lines: string[] = [];
    createLogger((line) => lines.push(line)).info('evento');
    const time = (JSON.parse(lines[0] ?? '{}') as { time: string }).time;

    expect(new Date(time).toISOString()).toBe(time);
    expect(Math.abs(Date.now() - new Date(time).getTime())).toBeLessThan(5000);
  });
});

describe('RF-D18: contexto con lista permitida (test 5)', () => {
  it('RF-D18: descarta apiKey, Password, params, query y objetos anidados', () => {
    const capture = createCaptureLogger();

    capture.logger.info('evento', {
      apiKey: SECRET,
      Password: SECRET,
      params: [SECRET],
      query: `select '${SECRET}'`,
      nested: { a: { password: SECRET } },
      Host: SECRET,
    });

    expect(capture.output()).not.toContain(SECRET);
    expect(Object.keys(capture.records()[0] ?? {})).toEqual(['level', 'event', 'time']);
  });

  it('RF-D18: conserva host, port, signal, exitCode y timeoutMs con valores primitivos', () => {
    const capture = createCaptureLogger();

    capture.logger.info('evento', { host: 'db', port: 5432, signal: 'SIGTERM', exitCode: 1, timeoutMs: 100 });
    capture.logger.info('evento', { host: true });

    const [first, second] = capture.records();
    expect(first).toMatchObject({ host: 'db', port: 5432, signal: 'SIGTERM', exitCode: 1, timeoutMs: 100 });
    expect(second).toMatchObject({ host: true });
  });

  it('RF-D18: descarta objetos, arreglos, null y undefined aunque el nombre esté permitido', () => {
    const capture = createCaptureLogger();

    capture.logger.info('evento', {
      host: { name: SECRET },
      port: [SECRET],
      signal: null,
      exitCode: undefined,
      timeoutMs: () => SECRET,
    });

    expect(capture.output()).not.toContain(SECRET);
    expect(Object.keys(capture.records()[0] ?? {})).toEqual(['level', 'event', 'time']);
  });

  it('RF-D18: el contexto no puede sobrescribir level, event ni time', () => {
    const capture = createCaptureLogger();

    capture.logger.info('real', { level: 'hack', event: 'hack', time: 'hack' });
    capture.logger.error('real', { context: { level: 'hack', event: 'hack', time: 'hack' } });

    for (const record of capture.records()) {
      expect(record['event']).toBe('real');
      expect(record['time']).toBe('2026-01-02T03:04:05.678Z');
    }
    expect(capture.records().map((r) => r['level'])).toEqual(['info', 'error']);
  });
});

describe('RF-D18: errores en el registro', () => {
  it('RF-D18 (test 1): error 22P02 con valor sensible en message y traza: el valor no aparece y el SQLSTATE sí', () => {
    const capture = createCaptureLogger();
    const error = dbError('22P02', `invalid input syntax for type uuid: "${SECRET}"`);

    capture.logger.error('query_failed', { thrown: error });

    expect(capture.output()).not.toContain(SECRET);
    const record = capture.records()[0];
    expect(record?.['sqlstate']).toBe('22P02');
    expect(record?.['errorClass']).toBe('DatabaseError');
  });

  it('RF-D18 (test 2): SQLSTATE 23514 con detail secreto: sin detail y con message', () => {
    const capture = createCaptureLogger();
    const error = Object.assign(dbError('23514', 'violates check constraint'), { detail: SECRET });

    capture.logger.error('query_failed', { thrown: error });

    expect(capture.output()).not.toContain(SECRET);
    expect(capture.records()[0]?.['message']).toBe('violates check constraint');
    expect('detail' in (capture.records()[0] ?? {})).toBe(false);
  });

  it('RF-D18 (test 3): Error genérico con URL con contraseña en el message: ausente', () => {
    const capture = createCaptureLogger();

    capture.logger.error('failed', { thrown: new Error(`connect postgresql://writer:${SECRET}@db:5432/app`) });

    expect(capture.output()).not.toContain(SECRET);
    expect('message' in (capture.records()[0] ?? {})).toBe(false);
  });

  it('RF-D18 (test 4): error propio (AppError): el message aparece', () => {
    const capture = createCaptureLogger();
    class OwnError extends AppError {}

    capture.logger.error('failed', { thrown: new OwnError('Mensaje fijo.') });

    expect(capture.records()[0]).toMatchObject({ errorClass: 'OwnError', message: 'Mensaje fijo.' });
  });

  it('RF-D18 (test 7): SQLSTATE 23505, fuera de la clase 22: el message aparece', () => {
    const capture = createCaptureLogger();

    capture.logger.error('failed', { thrown: dbError('23505', 'duplicate key') });

    expect(capture.records()[0]).toMatchObject({ sqlstate: '23505', message: 'duplicate key' });
  });

  it.each(['EPIPE', 'ECONNRESET'])('RF-D18 (test 8): code %s sale como errorCode, sin message ni sqlstate', (code) => {
    const capture = createCaptureLogger();

    capture.logger.error('failed', { thrown: Object.assign(new Error(`read ${SECRET}`), { code }) });

    const record = capture.records()[0] ?? {};
    expect(record['errorCode']).toBe(code);
    expect('message' in record).toBe(false);
    expect('sqlstate' in record).toBe(false);
    expect(capture.output()).not.toContain(SECRET);
  });

  it('RF-D18 (test 9): error de la clase 22: sin message', () => {
    const capture = createCaptureLogger();

    capture.logger.error('failed', { thrown: dbError('22001', `value too long: ${SECRET}`) });

    expect('message' in (capture.records()[0] ?? {})).toBe(false);
    expect(capture.output()).not.toContain(SECRET);
  });

  it('RF-D18 (test 10): message con salto de línea y "at secreto" en un error 22: ni el valor ni falsos marcos', () => {
    const capture = createCaptureLogger();
    const error = dbError('22P02', `${SECRET}\n    at secreto\n    at secreto:1:1`);

    capture.logger.error('failed', { thrown: error });

    expect(capture.output()).not.toContain(SECRET);
    expect(capture.output()).not.toContain('secreto');
    const lines = stackLines(capture.records()[0]);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(FRAME_PATTERN.test(line)).toBe(true);
    }
  });

  it('RF-D18 (test 11): message mutado después de crear el error: el valor original tampoco aparece', () => {
    // Límite conocido (plan R4): tras mutar el message ya no se puede retirar su texto original de la pila;
    // solo se garantiza que un valor que no imite un marco completo (como este) no sale en el registro.
    const capture = createCaptureLogger();
    const error = dbError('22P02', `${SECRET}\n    at secreto`);
    error.message = 'mensaje distinto';

    capture.logger.error('failed', { thrown: error });

    expect(capture.output()).not.toContain(SECRET);
    const lines = stackLines(capture.records()[0]);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(FRAME_PATTERN.test(line)).toBe(true);
    }
  });

  it('RF-D18: sin la propiedad thrown no hay campos de error; el contexto de error sí se filtra', () => {
    const capture = createCaptureLogger();

    capture.logger.error('a');
    capture.logger.error('b', {});
    capture.logger.error('c', { context: { host: 'db', apiKey: SECRET } });

    expect(capture.output()).not.toContain(SECRET);
    expect(capture.records().map((r) => Object.keys(r))).toEqual([
      ['level', 'event', 'time'],
      ['level', 'event', 'time'],
      ['level', 'event', 'time', 'host'],
    ]);
  });

  it('RF-D18 (test 13): contexto y campos de error conviven en el orden previsto', () => {
    const capture = createCaptureLogger();

    capture.logger.error('failed', { context: { host: 'db' }, thrown: dbError('23505', 'duplicate key') });

    expect(Object.keys(capture.records()[0] ?? {})).toEqual([
      'level',
      'event',
      'time',
      'host',
      'errorClass',
      'sqlstate',
      'message',
      'stack',
    ]);
  });
});
