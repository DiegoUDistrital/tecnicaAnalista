import { describe, expect, it } from 'vitest';
import { assertNoIpHeaders, FORBIDDEN_HEADERS } from '../scripts/testing/assert-no-ip-headers.js';

/**
 * Construye una petición registrada con las cabeceras dadas (nombre -> valor) y su versión en bruto.
 * @param {Record<string, string>} headers
 * @param {string[]} [rawExtra] líneas en bruto adicionales (nombre, valor, nombre, valor...)
 */
function recorded(headers, rawExtra = []) {
  return {
    method: 'GET',
    url: '/api/tasks',
    headers,
    rawHeaders: [...Object.entries(headers).flat(), ...rawExtra],
    remoteAddress: '127.0.0.1',
  };
}

const CLEAN = {
  host: '127.0.0.1:3110',
  connection: 'keep-alive',
  accept: '*/*',
  'accept-encoding': 'gzip, deflate',
  'accept-language': '*',
  'user-agent': 'node',
  'sec-fetch-mode': 'cors',
  pragma: 'no-cache',
  'cache-control': 'no-cache',
  authorization: 'Bearer key',
  'content-type': 'application/json',
  'content-length': '2',
};

describe('assertNoIpHeaders', () => {
  it('RF-I2: la aserción pasa con una petición registrada sin cabeceras de IP ni del navegador', () => {
    expect(() => assertNoIpHeaders(recorded(CLEAN))).not.toThrow();
  });

  it('RF-I2: la lista prohibida es exactamente las ocho cabeceras de la spec', () => {
    expect([...FORBIDDEN_HEADERS].sort()).toEqual(
      [
        'cookie',
        'forwarded',
        'origin',
        'referer',
        'x-forwarded-for',
        'x-forwarded-host',
        'x-forwarded-proto',
        'x-real-ip',
      ].sort(),
    );
  });

  it('RF-I2: la aserción FALLA si llega cualquiera de las ocho cabeceras prohibidas (control negativo)', () => {
    expect(FORBIDDEN_HEADERS.length).toBeGreaterThan(0);
    for (const name of FORBIDDEN_HEADERS) {
      expect(() => assertNoIpHeaders(recorded({ ...CLEAN, [name]: '203.0.113.9' }))).toThrow(name);
    }
  });

  it('RF-I2: la aserción FALLA si X-Forwarded-For solo aparece en rawHeaders (control negativo)', () => {
    const request = recorded(CLEAN, ['X-Forwarded-For', '203.0.113.9']);
    expect(() => assertNoIpHeaders(request)).toThrow('x-forwarded-for');
  });

  it('RF-I2: la aserción FALLA con dos líneas X-Forwarded-For en bruto (control negativo)', () => {
    const request = recorded({ ...CLEAN, 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }, ['X-Forwarded-For', '3.3.3.3']);
    expect(() => assertNoIpHeaders(request)).toThrow('x-forwarded-for');
  });

  it('RF-I2: una cabecera inesperada fuera de la lista de ignoradas hace fallar la aserción y la nombra', () => {
    expect(() => assertNoIpHeaders(recorded({ ...CLEAN, 'x-surprise': 'a' }))).toThrow('x-surprise');
    expect(() => assertNoIpHeaders(recorded(CLEAN, ['X-Other-Raw', 'b']))).toThrow('x-other-raw');
  });

  it('RNF-I3: el mensaje de error nombra la cabecera y no incluye su valor', () => {
    let message = '';
    try {
      assertNoIpHeaders(recorded({ ...CLEAN, 'x-forwarded-for': '203.0.113.77' }));
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('x-forwarded-for');
    expect(message).not.toContain('203.0.113.77');
  });
});
