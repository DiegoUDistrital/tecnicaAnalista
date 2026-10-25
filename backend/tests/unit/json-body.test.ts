import { isUtf8 } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../../src/http/http-error';
import { parseJsonBody } from '../../src/http/input/json-body';

const INVALID_BODY = 'El cuerpo debe ser un objeto JSON válido.';
const NO_BODY_ALLOWED = 'Esta ruta no admite cuerpo.';

/** Ejecuta el análisis y devuelve el error lanzado (o `undefined` si no lanzó). */
function failureOf(bytes: Buffer, mode: 'none' | 'required'): HttpError | undefined {
  try {
    parseJsonBody(bytes, mode);
  } catch (error) {
    return error as HttpError;
  }
  return undefined;
}

function expectBodyError(bytes: Buffer, message: string, mode: 'none' | 'required' = 'required'): void {
  const error = failureOf(bytes, mode);
  expect(error).toBeInstanceOf(HttpError);
  expect(error?.status).toBe(400);
  expect(error?.details).toEqual([{ field: 'body', message }]);
}

const bytes = (...values: number[]): Buffer => Buffer.from(values);

describe('RF-C5: cuerpo vacío', () => {
  it('RF-C5: bytes vacíos dan 400 body', () => {
    expectBodyError(Buffer.alloc(0), INVALID_BODY);
  });

  it('RF-C5: un body de solo espacios NO es vacío (llega al JSON y falla como JSON mal formado)', () => {
    expectBodyError(Buffer.from('   '), INVALID_BODY);
    expect(isUtf8(Buffer.from('   '))).toBe(true);
  });
});

describe('RF-C5: UTF-8 estricto y BOM', () => {
  it.each([
    ['FF FE', bytes(0xff, 0xfe)],
    ['C3 truncado', bytes(0x7b, 0xc3)],
    ['ED A0 80 (sustituto codificado)', bytes(0xed, 0xa0, 0x80)],
  ])('RF-C5: %s da 400 body', (_name, input) => {
    expect(isUtf8(input)).toBe(false);
    expectBodyError(input, INVALID_BODY);
  });

  it('RF-C5: BOM más {} da 400 body', () => {
    const input = Buffer.concat([bytes(0xef, 0xbb, 0xbf), Buffer.from('{}')]);

    expect(isUtf8(input)).toBe(true);
    expectBodyError(input, INVALID_BODY);
  });

  it('RF-C5: U+FFFD legítimo (EF BF BD) es válido y llega intacto', () => {
    const input = Buffer.concat([Buffer.from('{"title":"a'), bytes(0xef, 0xbf, 0xbd), Buffer.from('b"}')]);

    expect(isUtf8(bytes(0xef, 0xbf, 0xbd))).toBe(true);
    expect(parseJsonBody(input, 'required')).toEqual({ title: 'a\u{fffd}b' });
  });
});

describe('RF-C5: JSON y raíz', () => {
  it.each(['{', '{"a":}', 'nope', '{"a":1,}'])('RF-C5: JSON mal formado %j da 400 body', (text) => {
    expectBodyError(Buffer.from(text), INVALID_BODY);
  });

  it.each(['[]', 'null', '"x"', '5', 'true', '[{}]'])('RF-C5: la raíz %s no es un objeto: 400 body', (text) => {
    expectBodyError(Buffer.from(text), INVALID_BODY);
  });

  it('RF-C5: un objeto con espacios alrededor es válido', () => {
    expect(parseJsonBody(Buffer.from(' \n{"a":1}\t '), 'required')).toEqual({ a: 1 });
  });

  it('RF-C5: claves repetidas, gana la última', () => {
    expect(parseJsonBody(Buffer.from('{"title":"a","title":"b"}'), 'required')).toEqual({ title: 'b' });
  });

  it('RF-C5: __proto__ llega como clave propia y no cambia el prototipo del resultado', () => {
    const parsed = parseJsonBody(Buffer.from('{"__proto__":{"x":1}}'), 'required');

    expect(Object.keys(parsed ?? {})).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });
});

describe('RF-C5: rutas sin cuerpo (GET y DELETE)', () => {
  it('RF-C5: con bodyMode none y sin bytes devuelve undefined', () => {
    expect(parseJsonBody(Buffer.alloc(0), 'none')).toBeUndefined();
  });

  it.each([
    ['JSON válido', Buffer.from('{}')],
    ['JSON mal formado', Buffer.from('nope')],
    ['FF FE (UTF-8 inválido)', bytes(0xff, 0xfe)],
    ['solo espacios', Buffer.from(' ')],
  ])('RF-C5: con bodyMode none y bytes no vacíos (%s) da 400 body «Esta ruta no admite cuerpo.»', (_name, input) => {
    expectBodyError(input, NO_BODY_ALLOWED, 'none');
  });

  it('RF-C1: orden interno de la etapa 4 (GET con FF FE da el mensaje de GET con body, no el de UTF-8)', () => {
    const error = failureOf(bytes(0xff, 0xfe), 'none');

    expect(error?.details[0]?.message).toBe(NO_BODY_ALLOWED);
    expect(error?.details[0]?.message).not.toBe(INVALID_BODY);
  });
});
