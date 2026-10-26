import { describe, expect, it } from 'vitest';
import { parseJsonBody } from '../../src/server/proxy/json-body';

const encoder = new TextEncoder();
const parse = (text: string) => parseJsonBody(encoder.encode(text));

describe('parseJsonBody', () => {
  it('RF-F19: un objeto válido se devuelve re-serializado (sin espacios ni claves duplicadas: gana la última)', () => {
    expect(parse('{ "title" : "a" ,\n "title": "b", "completed": true }')).toBe('{"title":"b","completed":true}');
    expect(parse('{}')).toBe('{}');
  });

  it('RF-F19: {"__proto__":{}}, vacío, arreglo, null, número, cadena, JSON roto, BOM y UTF-8 inválido son 400', () => {
    for (const text of ['{"__proto__":{}}', '', '[]', 'null', '5', '"x"', '{"a":', '﻿{"a":1}']) {
      expect(parse(text)).toBeUndefined();
    }
    expect(parseJsonBody(new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]))).toBeUndefined();
    expect(parseJsonBody(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))).toBeUndefined();
  });

  it('RF-F19: __proto__ anidado no se rechaza (solo la raíz) y no contamina el prototipo', () => {
    expect(parse('{"a":{"__proto__":{"x":1}}}')).toBe('{"a":{"__proto__":{"x":1}}}');
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('RF-F19: no valida campos ni tipos (title:5 pasa)', () => {
    expect(parse('{"title":5,"otro":null}')).toBe('{"title":5,"otro":null}');
  });
});
