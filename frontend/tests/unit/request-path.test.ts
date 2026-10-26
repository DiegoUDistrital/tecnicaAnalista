import { describe, expect, it } from 'vitest';
import { parseTaskId } from '../../src/server/proxy/request-path';

const ID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const BASE = 'http://localhost:3001/api/tasks/';

describe('parseTaskId', () => {
  it('RF-F19: un UUID completo en minúsculas o mayúsculas es válido y se devuelve en minúsculas', () => {
    expect(parseTaskId(BASE + ID, ID)).toBe(ID);
    expect(parseTaskId(BASE + ID.toUpperCase(), ID.toUpperCase())).toBe(ID);
  });

  it('RF-F19: .., %2e%2e, a/b, a%2Fb, ?x=1, vacío, UUID más sufijo y UUID con %61 son 400', () => {
    expect(parseTaskId(`${BASE}..`, '..')).toBeUndefined();
    expect(parseTaskId(`${BASE}%2e%2e`, '..')).toBeUndefined();
    expect(parseTaskId(`${BASE}a/b`, 'a/b')).toBeUndefined();
    expect(parseTaskId(`${BASE}a%2Fb`, 'a/b')).toBeUndefined();
    expect(parseTaskId(`${BASE}?x=1`, '')).toBeUndefined();
    expect(parseTaskId(BASE, '')).toBeUndefined();
    expect(parseTaskId(`${BASE}${ID}x`, `${ID}x`)).toBeUndefined();
    expect(parseTaskId(`${BASE}${ID}/`, ID)).toBeUndefined();
    const encoded = ID.replace('4a6b', '4%61' + '6b');
    expect(parseTaskId(BASE + encoded, ID)).toBeUndefined();
  });

  it('RF-F19: si el segmento de request.url y params.id difieren, 400', () => {
    const other = 'ffffffff-4f50-4a6b-8c7d-9e0f1a2b3c4d';
    expect(parseTaskId(BASE + ID, other)).toBeUndefined();
    expect(parseTaskId(BASE + ID, ID.toUpperCase())).toBeUndefined();
  });

  it('RF-F19: una dirección que no es de /api/tasks/<id> es 400', () => {
    expect(parseTaskId(`http://localhost:3001/otra/${ID}`, ID)).toBeUndefined();
  });
});
