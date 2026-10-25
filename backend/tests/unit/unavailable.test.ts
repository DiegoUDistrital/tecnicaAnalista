import { DatabaseError } from 'pg';
import { describe, expect, it } from 'vitest';
import { isDatabaseUnavailable } from '../../src/db/unavailable';

const dbError = (code: string, message = 'x'): DatabaseError =>
  Object.assign(new DatabaseError(message, 0, 'error'), { code });

const PG_MESSAGES = [
  'timeout exceeded when trying to connect',
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
  'Client has encountered a connection error and is not queryable',
  'Client was closed and is not queryable',
];

describe('RF-D4: isDatabaseUnavailable', () => {
  it.each(['28P01', '53300', '08000', '08006', '08001', '57P01', '57P02', '57P03'])(
    'RF-D4: el SQLSTATE %s es «no disponible»',
    (code) => {
      expect(isDatabaseUnavailable(dbError(code))).toBe(true);
    },
  );

  it.each(['08004', '08P01', '57014', '57000'])('RF-D4: toda la clase 08 y 57 cuenta (%s)', (code) => {
    expect(isDatabaseUnavailable(dbError(code))).toBe(true);
  });

  it.each(['23514', '23505', '22P02', '42P01', '42501', '40001', '53200'])(
    'RF-D4: el SQLSTATE de consulta %s NO es «no disponible»',
    (code) => {
      expect(isDatabaseUnavailable(dbError(code))).toBe(false);
    },
  );

  it.each([
    'ECONNREFUSED',
    'ECONNRESET',
    'EPIPE',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EAI_AGAIN',
  ])('RF-D4: el error de sistema %s es «no disponible»', (code) => {
    expect(isDatabaseUnavailable(Object.assign(new Error('connect fallido'), { code }))).toBe(true);
  });

  it.each(PG_MESSAGES)('RF-D4: el mensaje propio de pg «%s» es «no disponible» si no es DatabaseError', (message) => {
    expect(isDatabaseUnavailable(new Error(message))).toBe(true);
  });

  it.each(PG_MESSAGES)('RF-D4: un DatabaseError de consulta con el texto «%s» NO es «no disponible»', (message) => {
    expect(isDatabaseUnavailable(dbError('23514', message))).toBe(false);
  });

  it('RF-D4: un DatabaseError sin code no es «no disponible»', () => {
    expect(isDatabaseUnavailable(new DatabaseError('x', 0, 'error'))).toBe(false);
  });

  it('RF-D4: Error y TypeError genéricos, códigos desconocidos y no-Error son false', () => {
    expect(isDatabaseUnavailable(new Error('boom'))).toBe(false);
    expect(isDatabaseUnavailable(new TypeError('x is not a function'))).toBe(false);
    expect(isDatabaseUnavailable(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe(false);
    expect(isDatabaseUnavailable(Object.assign(new Error('x'), { code: 42 }))).toBe(false);
    expect(isDatabaseUnavailable('Connection terminated unexpectedly')).toBe(false);
    expect(isDatabaseUnavailable(undefined)).toBe(false);
    expect(isDatabaseUnavailable({ code: 'ECONNREFUSED' })).toBe(false);
  });
});
