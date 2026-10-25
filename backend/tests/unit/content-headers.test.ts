import { describe, expect, it } from 'vitest';
import { collectHeader, isIdentityEncoding, isJsonContentType } from '../../src/http/input/content-headers';

describe('RF-C4: collectHeader sobre rawHeaders', () => {
  it('RF-C4: devuelve todas las apariciones, sin distinguir mayúsculas en el nombre y en su orden', () => {
    const raw = ['Host', 'x', 'content-type', 'application/json', 'CONTENT-TYPE', 'text/plain', 'Accept', '*/*'];

    expect(collectHeader(raw, 'Content-Type')).toEqual(['application/json', 'text/plain']);
    expect(collectHeader(raw, 'content-encoding')).toEqual([]);
  });
});

describe('RF-C4: Content-Encoding', () => {
  it.each([[[]], [['identity']], [['Identity']], [['IDENTITY']]])('RF-C4: Content-Encoding aceptado: %j', (values) => {
    expect(isIdentityEncoding(values)).toBe(true);
  });

  it.each([
    ['gzip', ['gzip']],
    ['deflate', ['deflate']],
    ['br', ['br']],
    ['identity, identity', ['identity, identity']],
    ['identity,identity', ['identity,identity']],
    ['vacío', ['']],
    ['duplicado idéntico', ['identity', 'identity']],
    ['duplicado con otro valor', ['identity', 'gzip']],
  ])('RF-C4: Content-Encoding rechazado: %s', (_name, values) => {
    expect(isIdentityEncoding(values)).toBe(false);
  });
});

describe('RF-C4: Content-Type', () => {
  it.each([
    'application/json',
    'APPLICATION/JSON; CHARSET=UTF-8',
    'application/json ;charset=utf-8',
    'application/json; charset=utf-8',
    'application/json;charset=UTF-8',
  ])('RF-C4: Content-Type aceptado: %s', (value) => {
    expect(isJsonContentType([value])).toBe(true);
  });

  it.each([
    ['charset=utf8', ['application/json; charset=utf8']],
    ['charset entre comillas', ['application/json; charset="utf-8"']],
    ['charset=iso-8859-1', ['application/json; charset=iso-8859-1']],
    ['version=1', ['application/json; version=1']],
    ['punto y coma final', ['application/json;']],
    ['espacios alrededor del igual', ['application/json; charset = utf-8']],
    ['dos puntos y coma', ['application/json;;']],
    ['application/vnd.api+json', ['application/vnd.api+json']],
    ['text/plain', ['text/plain']],
    ['vacío', ['']],
    ['duplicado con el segundo valor distinto', ['application/json', 'text/plain']],
    ['duplicado idéntico', ['application/json', 'application/json']],
    ['ausente', []],
  ])('RF-C4: Content-Type rechazado: %s', (_name, values) => {
    expect(isJsonContentType(values)).toBe(false);
  });
});
