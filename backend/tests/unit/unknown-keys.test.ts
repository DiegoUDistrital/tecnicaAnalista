import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hasUnknownKeys, POST_KEYS, PUT_KEYS } from '../../src/validation/unknown-keys';

const parse = (json: string): Record<string, unknown> => JSON.parse(json) as Record<string, unknown>;

describe('RF-C7: claves permitidas', () => {
  it('RF-C7: title y description son las únicas claves permitidas', () => {
    expect(hasUnknownKeys(parse('{}'), POST_KEYS)).toBe(false);
    expect(hasUnknownKeys(parse('{"title":"a"}'), POST_KEYS)).toBe(false);
    expect(hasUnknownKeys(parse('{"description":"a"}'), POST_KEYS)).toBe(false);
    expect(hasUnknownKeys(parse('{"title":"a","description":"b"}'), POST_KEYS)).toBe(false);
  });

  it.each(['id', 'createdAt', 'completed', '__proto__', 'constructor', 'toString', 'foo', 'Title', ''])(
    'RF-C7: %j cuenta como clave desconocida',
    (key) => {
      const body = parse(`{"title":"a",${JSON.stringify(key)}:1}`);
      expect(Object.keys(body)).toContain(key);
      expect(hasUnknownKeys(body, POST_KEYS)).toBe(true);
    },
  );

  it('RF-C7: {"__proto__":{}} es una clave propia (JSON.parse) y cuenta como desconocida', () => {
    expect(hasUnknownKeys(parse('{"__proto__":{}}'), POST_KEYS)).toBe(true);
  });
});

describe('RF-C7: sin operador in ni Object.assign', () => {
  const polluted = ['title', 'description', 'id'] as const;

  afterEach(() => {
    for (const key of polluted) {
      delete (Object.prototype as Record<string, unknown>)[key];
    }
  });

  it('RF-C7: un objeto con prototipo contaminado no cambia el resultado', () => {
    for (const key of polluted) {
      (Object.prototype as Record<string, unknown>)[key] = 'contaminado';
    }
    expect(hasUnknownKeys(parse('{"title":"a"}'), POST_KEYS)).toBe(false);
    expect(hasUnknownKeys(parse('{"foo":1}'), POST_KEYS)).toBe(true);
  });

  it('RF-C7: el código fuente no usa el operador in ni Object.assign', () => {
    const source = readFileSync(join(__dirname, '../../src/validation/unknown-keys.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\sin\s/);
    expect(code).not.toContain('Object.assign');
  });
});

describe('RF-C7: conjuntos de claves de POST y PUT', () => {
  it('RF-C7: con el conjunto de PUT, completed es permitida y con el de POST es desconocida', () => {
    const body = parse('{"completed":true}');
    expect(hasUnknownKeys(body, PUT_KEYS)).toBe(false);
    expect(hasUnknownKeys(body, POST_KEYS)).toBe(true);
  });

  it('RF-C7: PUT admite title, description y completed, y rechaza id, createdAt y __proto__', () => {
    expect(hasUnknownKeys(parse('{"title":"a","description":"b","completed":false}'), PUT_KEYS)).toBe(false);
    for (const key of ['id', 'createdAt', '__proto__', 'constructor']) {
      expect(hasUnknownKeys(parse(`{${JSON.stringify(key)}:1}`), PUT_KEYS)).toBe(true);
    }
  });
});
