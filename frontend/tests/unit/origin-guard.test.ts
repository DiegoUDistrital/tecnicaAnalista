import { describe, expect, it } from 'vitest';
import { checkOrigin } from '../../src/server/proxy/origin-guard';
import { makeRequest } from '../helpers/requests';

const URL_TASKS = 'http://localhost:3001/api/tasks';

function check(method: string, headers: Record<string, string>, allowedHosts?: readonly string[]) {
  return checkOrigin({ method, headers: makeRequest(URL_TASKS, { method, headers }).headers, allowedHosts });
}

describe('checkOrigin', () => {
  it('RF-F30: mismo origen (Origin http://localhost:3001 con Host localhost:3001) pasa', () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      expect(check(method, { Origin: 'http://localhost:3001', Host: 'localhost:3001' })).toBe('ok');
    }
  });

  it('RF-F30: Origin de otro puerto, otro nombre, null, múltiple o con coma, o ilegible dan forbidden', () => {
    const host = { Host: 'localhost:3001' };
    expect(check('POST', { ...host, Origin: 'http://localhost:3000' })).toBe('forbidden');
    expect(check('POST', { ...host, Origin: 'http://evil.example' })).toBe('forbidden');
    expect(check('POST', { ...host, Origin: 'http://127.0.0.1:3001' })).toBe('forbidden');
    expect(check('POST', { ...host, Origin: 'null' })).toBe('forbidden');
    expect(check('POST', { ...host, Origin: 'http://localhost:3001, http://localhost:3001' })).toBe('forbidden');
    expect(check('POST', { ...host, Origin: 'esto no es una url' })).toBe('forbidden');
    const repeated = new Headers({ Host: 'localhost:3001' });
    repeated.append('Origin', 'http://localhost:3001');
    repeated.append('Origin', 'http://localhost:3001');
    expect(checkOrigin({ method: 'DELETE', headers: repeated })).toBe('forbidden');
    expect(check('PUT', { Origin: 'http://localhost:3001' })).toBe('forbidden');
  });

  it('RF-F30: Sec-Fetch-Site cross-site sin Origin da forbidden; same-origin y none pasan; same-site con Origin distinto da forbidden', () => {
    const host = { Host: 'localhost:3001' };
    expect(check('POST', { ...host, 'Sec-Fetch-Site': 'cross-site' })).toBe('forbidden');
    expect(check('POST', { ...host, 'Sec-Fetch-Site': 'same-origin' })).toBe('ok');
    expect(check('POST', { ...host, 'Sec-Fetch-Site': 'none' })).toBe('ok');
    expect(check('POST', { ...host, 'Sec-Fetch-Site': 'same-site', Origin: 'http://localhost:3000' })).toBe(
      'forbidden',
    );
    expect(check('POST', { ...host, 'Sec-Fetch-Site': 'same-site', Origin: 'http://localhost:3001' })).toBe('ok');
  });

  it('RF-F30: sin Origin ni Sec-Fetch-Site pasa (cliente que no es un navegador)', () => {
    expect(check('POST', { Host: 'localhost:3001' })).toBe('ok');
    expect(check('DELETE', {})).toBe('ok');
  });

  it('RF-F30: GET con Origin ajeno no se bloquea por esta regla', () => {
    expect(check('GET', { Host: 'localhost:3001', Origin: 'http://evil.example' })).toBe('ok');
    expect(check('GET', { Host: 'localhost:3001', 'Sec-Fetch-Site': 'cross-site' })).toBe('ok');
  });

  it('RF-F30: con ALLOWED_HOSTS=localhost:3001 un Host evil.example da forbidden en GET y POST, y los de la lista pasan', () => {
    const allowed = ['localhost:3001', '127.0.0.1:3001'];
    expect(check('GET', { Host: 'evil.example' }, allowed)).toBe('forbidden');
    expect(check('POST', { Host: 'evil.example', Origin: 'http://evil.example' }, allowed)).toBe('forbidden');
    expect(check('GET', {}, allowed)).toBe('forbidden');
    expect(check('GET', { Host: 'localhost:3001' }, allowed)).toBe('ok');
    expect(check('GET', { Host: 'LOCALHOST:3001' }, allowed)).toBe('ok');
    expect(check('POST', { Host: '127.0.0.1:3001', Origin: 'http://127.0.0.1:3001' }, allowed)).toBe('ok');
    expect(check('GET', { Host: 'evil.example' }, ['localhost:3001'])).toBe('forbidden');
    expect(check('GET', { Host: '127.0.0.1:3001' }, ['localhost:3001'])).toBe('forbidden');
  });
});
