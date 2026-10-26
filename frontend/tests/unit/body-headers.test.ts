import { describe, expect, it } from 'vitest';
import { checkBodyHeaders } from '../../src/server/proxy/body-headers';

function check(headers: Record<string, string>) {
  return checkBodyHeaders(new Headers({ 'Content-Type': 'application/json', ...headers }));
}

describe('checkBodyHeaders', () => {
  it('RF-F19: Content-Length abc, -1, 1.5 y vacío son 400; 10240 pasa; 10241 es 413; ausente pasa', () => {
    for (const value of ['abc', '-1', '1.5', '', ' ', '1e3', '+5']) {
      expect(check({ 'Content-Length': value })).toBe('invalid_body');
    }
    expect(check({ 'Content-Length': '10240' })).toBe('ok');
    expect(check({ 'Content-Length': '0' })).toBe('ok');
    expect(check({ 'Content-Length': '10241' })).toBe('too_large');
    expect(check({ 'Content-Length': '9'.repeat(400) })).toBe('too_large');
    expect(check({})).toBe('ok');
  });

  it('RF-F19: Content-Type application/json con y sin charset=utf-8 y en mayúsculas pasa; el resto es 415', () => {
    for (const value of [
      'application/json',
      'application/json; charset=utf-8',
      'application/json;charset=UTF-8',
      'APPLICATION/JSON',
    ]) {
      expect(check({ 'Content-Type': value })).toBe('ok');
    }
    const invalid = ['text/plain', 'application/json; charset=latin1', 'application/jsonx', 'application/json; a=b'];
    for (const value of invalid) {
      expect(check({ 'Content-Type': value })).toBe('unsupported_media');
    }
    expect(checkBodyHeaders(new Headers())).toBe('unsupported_media');
  });

  it('RF-F19: Content-Encoding gzip es 415 e identity y ausente pasan', () => {
    expect(check({ 'Content-Encoding': 'gzip' })).toBe('unsupported_media');
    expect(check({ 'Content-Encoding': 'identity' })).toBe('ok');
    expect(check({ 'Content-Encoding': 'Identity' })).toBe('ok');
    expect(check({})).toBe('ok');
  });

  it('RF-F19: CL inválido y tipo inválido a la vez devuelve el primero del orden (400)', () => {
    expect(check({ 'Content-Length': 'abc', 'Content-Type': 'text/plain' })).toBe('invalid_body');
    expect(check({ 'Content-Length': '10241', 'Content-Type': 'text/plain' })).toBe('too_large');
  });
});
