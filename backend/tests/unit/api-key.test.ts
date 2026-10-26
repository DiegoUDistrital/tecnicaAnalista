import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkApiKey, createKeyChecker, EXAMPLE_API_KEY, readBearerKey } from '../../src/security/api-key';
import { TEST_API_KEY } from '../helpers/security';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

describe('RF-G6: checkApiKey', () => {
  it('RF-G6: EXAMPLE_API_KEY no cumple el formato de una key válida (por diseño)', () => {
    expect(checkApiKey(EXAMPLE_API_KEY, 'otro-ejemplo-distinto')).toBe('API_KEY: formato inválido');
    expect(EXAMPLE_API_KEY.length).toBeLessThan(43);
  });

  it('RF-G6: la igualdad con el ejemplo se comprueba aunque el ejemplo cumpliera el formato', () => {
    const example = TEST_API_KEY;

    expect(checkApiKey(example, example)).toBe('API_KEY: no puede ser el valor de ejemplo');
    expect(checkApiKey(example)).toBeUndefined();
  });

  it('RF-G6: ausente es obligatoria; una key válida no devuelve mensaje', () => {
    expect(checkApiKey(undefined)).toBe('API_KEY: obligatoria');
    expect(checkApiKey(TEST_API_KEY)).toBeUndefined();
  });

  it('RF-G6: el límite superior de 128 caracteres vale y el de 129 no', () => {
    expect(checkApiKey(ALPHABET.repeat(2).slice(0, 128))).toBeUndefined();
    expect(checkApiKey(ALPHABET.repeat(3).slice(0, 129))).toBe('API_KEY: formato inválido');
  });
});

describe('RF-G3: readBearerKey', () => {
  const header = (value: string): string[] => ['Host', 'x', 'Authorization', value];

  it.each(['Bearer', 'bearer', 'BEARER'])('RF-G3: acepta el esquema %s con un espacio', (scheme) => {
    expect(readBearerKey(header(`${scheme} ${TEST_API_KEY}`))).toBe(TEST_API_KEY);
  });

  it('RF-G3: acepta keys de 1 a 128 caracteres del alfabeto', () => {
    expect(readBearerKey(header('Bearer a'))).toBe('a');
    expect(readBearerKey(header(`Bearer ${ALPHABET}`))).toBe(ALPHABET);
    const long = ALPHABET.repeat(2).slice(0, 128);
    expect(readBearerKey(header(`Bearer ${long}`))).toBe(long);
  });

  it('RF-G3: el nombre de la cabecera en cualquier mayúscula cuenta como la misma cabecera', () => {
    expect(readBearerKey(['AUTHORIZATION', `Bearer ${TEST_API_KEY}`])).toBe(TEST_API_KEY);
    expect(readBearerKey(['authorization', `Bearer ${TEST_API_KEY}`])).toBe(TEST_API_KEY);
    expect(readBearerKey(['AUTHORIZATION', `Bearer ${TEST_API_KEY}`, 'authorization', `Bearer ${TEST_API_KEY}`])).toBe(
      undefined,
    );
  });

  it.each([
    ['ausente', ['Host', 'x']],
    ['sin cabeceras', []],
    ['repetida e idéntica', ['Authorization', `Bearer ${TEST_API_KEY}`, 'Authorization', `Bearer ${TEST_API_KEY}`]],
    ['repetida y distinta', ['Authorization', `Bearer ${TEST_API_KEY}`, 'Authorization', 'Bearer otra']],
    ['vacía', ['Authorization', '']],
    ['solo el esquema', ['Authorization', 'Bearer']],
    ['esquema y espacio sin key', ['Authorization', 'Bearer ']],
    ['key vacía con espacio final', ['Authorization', 'Bearer  ']],
    ['Basic', ['Authorization', `Basic ${TEST_API_KEY}`]],
    ['Token', ['Authorization', `Token ${TEST_API_KEY}`]],
    ['dos espacios', ['Authorization', `Bearer  ${TEST_API_KEY}`]],
    ['tabulador', ['Authorization', `Bearer\t${TEST_API_KEY}`]],
    ['punto en la key', ['Authorization', 'Bearer abc.def']],
    ['más en la key', ['Authorization', 'Bearer abc+def']],
    ['igual en la key', ['Authorization', 'Bearer abc=']],
    ['más de 128 caracteres', ['Authorization', `Bearer ${ALPHABET.repeat(3).slice(0, 129)}`]],
    ['key con espacio interior', ['Authorization', 'Bearer abc def']],
    ['esquema con dígitos', ['Authorization', `Bearer1 ${TEST_API_KEY}`]],
    ['solo la key, sin esquema', ['Authorization', TEST_API_KEY]],
  ])('RF-G3: devuelve undefined para %s', (_label, rawHeaders) => {
    expect(readBearerKey(rawHeaders)).toBeUndefined();
  });
});

describe('RF-G4: createKeyChecker', () => {
  function sha256(value: string): Buffer {
    return createHash('sha256').update(value).digest();
  }

  it.each([
    ['0', ''],
    ['44', `${TEST_API_KEY}x`],
  ])('RF-G4: el comprobador devuelve false sin lanzar con una candidata de %s caracteres', (_length, candidate) => {
    const check = createKeyChecker(TEST_API_KEY);

    expect(check(candidate)).toBe(false);
  });

  it('RF-G4: devuelve true con la válida y distingue mayúsculas', () => {
    const check = createKeyChecker(TEST_API_KEY);

    expect(check(TEST_API_KEY)).toBe(true);
    expect(check(TEST_API_KEY.toUpperCase())).toBe(false);
    expect(check(TEST_API_KEY.toLowerCase())).toBe(false);
  });

  it('RF-G4: compare siempre recibe dos Buffer de 32 bytes, también con candidata más corta o más larga', () => {
    const calls: [Buffer, Buffer][] = [];
    const check = createKeyChecker(TEST_API_KEY, (a, b) => {
      calls.push([a, b]);
      return a.equals(b);
    });

    for (const candidate of ['', 'a', TEST_API_KEY, `${TEST_API_KEY}x`, 'z'.repeat(128)]) {
      check(candidate);
    }

    expect(calls).toHaveLength(5);
    for (const [candidate, expected] of calls) {
      expect(Buffer.isBuffer(candidate)).toBe(true);
      expect(Buffer.isBuffer(expected)).toBe(true);
      expect(candidate.length).toBe(32);
      expect(expected.length).toBe(32);
      expect(expected.equals(sha256(TEST_API_KEY))).toBe(true);
    }
    expect(calls[2]?.[0].equals(sha256(TEST_API_KEY))).toBe(true);
  });
});
