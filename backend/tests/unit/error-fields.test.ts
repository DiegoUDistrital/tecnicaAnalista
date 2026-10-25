import { DatabaseError } from 'pg';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors/app-error';
import { describeThrown, FRAME_PATTERN, MAX_STACK_LINES } from '../../src/logging/error-fields';

function dbError(code: string, message = 'fallo'): DatabaseError {
  return Object.assign(new DatabaseError(message, 0, 'error'), { code });
}

function withStack(lines: number): Error {
  const error = new Error('x');
  const frames = Array.from({ length: lines }, (_, i) => `    at fn${i} (/app/src/f.ts:${i + 1}:1)`);
  error.stack = ['Error: x', ...frames].join('\n');
  return error;
}

describe('RF-D18: patrón de marco de pila', () => {
  it.each([
    'at Object.<anonymous> (C:\\Users\\dev\\proj\\src\\a.ts:10:5)',
    'at Module._compile (node:internal/modules/cjs/loader:1554:14)',
    'at new Foo (/app/src/foo.ts:1:2)',
    'at async Promise.all (/app/src/foo.ts:7:3)',
    'at file:///C:/proj/a.mjs:3:9',
    'at async file:///app/x.mjs:3:4',
    'at /app/x.js:1:1',
    'at C:/proj/x.js:12:34',
    'at <anonymous>:1:2',
  ])('RF-D18: acepta el marco real %s', (frame) => {
    expect(FRAME_PATTERN.test(frame)).toBe(true);
  });

  it.each([
    'at secreto',
    'at secreto:1:1',
    'at foo (relative/path.ts:1:1)',
    'at foo (./a.ts:1:1)',
    'at 123e4567-e89b-12d3-a456-426614174000 (/a:1:1)',
    'at foo:bar (/a:1:1)',
    'at /a:1',
    'at /a:x:1',
    'at foo (/a:1:1) extra',
    'at async Promise.all (index 0)',
    'at new Promise (<anonymous>)',
    'Error: x',
    '',
    'at a (/b:1:1)\nat secreto',
  ])('RF-D18: rechaza el falso marco %j', (frame) => {
    expect(FRAME_PATTERN.test(frame)).toBe(false);
  });
});

describe('RF-D18: describeThrown', () => {
  it('RF-D18: lo lanzado que no es Error solo produce thrownType', () => {
    expect(describeThrown('secreto')).toEqual({ thrownType: 'string' });
    expect(describeThrown(undefined)).toEqual({ thrownType: 'undefined' });
    expect(describeThrown(null)).toEqual({ thrownType: 'object' });
    expect(describeThrown(42)).toEqual({ thrownType: 'number' });
    expect(describeThrown({ password: 'secreto', message: 'secreto' })).toEqual({ thrownType: 'object' });
  });

  it('RF-D18: campos de salida cerrados, aunque el error lleve detail, hint, where, cause y otros', () => {
    const error = Object.assign(dbError('23514', 'violación'), {
      detail: 'secreto-detail',
      hint: 'secreto-hint',
      where: 'secreto-where',
      cause: 'secreto-cause',
      parameters: ['secreto-param'],
      extra: 'secreto-extra',
    });

    const fields = describeThrown(error);

    expect(Object.keys(fields).sort()).toEqual(['errorClass', 'message', 'sqlstate', 'stack']);
    expect(JSON.stringify(fields)).not.toContain('secreto');
    expect(fields['sqlstate']).toBe('23514');
    expect(fields['message']).toBe('violación');
  });

  it('RF-D18: nunca devuelve claves fuera de los cinco campos permitidos', () => {
    const allowed = ['errorClass', 'sqlstate', 'errorCode', 'message', 'stack'];
    const errors = [dbError('23505'), new AppError('fijo'), Object.assign(new Error('x'), { code: 'EPIPE' })];
    for (const error of errors) {
      expect(Object.keys(describeThrown(error)).every((key) => allowed.includes(key))).toBe(true);
    }
  });

  it('RF-D18: errorClass sale de la clase y no de error.name mutado', () => {
    class MiError extends Error {}
    const error = new MiError('x');
    error.name = 'secreto-en-name';

    const fields = describeThrown(error);

    expect(fields['errorClass']).toBe('MiError');
    expect(JSON.stringify(fields)).not.toContain('secreto-en-name');
  });

  it('RF-D18: errorClass cae a Error si el nombre de la clase no cumple el patrón', () => {
    class Raro extends Error {}
    Object.defineProperty(Raro, 'name', { value: 'nombre raro!' });
    const sinConstructor = new Error('x');
    Object.setPrototypeOf(sinConstructor, Object.create(Error.prototype, { constructor: { value: 5 } }) as object);

    expect(describeThrown(new Raro('x'))['errorClass']).toBe('Error');
    expect(describeThrown(sinConstructor)['errorClass']).toBe('Error');
  });

  it('RF-D18: sqlstate exige DatabaseError y un code de 5 caracteres [0-9A-Z] con un dígito', () => {
    expect(describeThrown(dbError('22P02'))['sqlstate']).toBe('22P02');
    expect(describeThrown(dbError('P0001'))['sqlstate']).toBe('P0001');
    for (const code of ['ABCDE', '2345', '234567', '23a05', '']) {
      expect('sqlstate' in describeThrown(dbError(code))).toBe(false);
    }
    // Un Error cualquiera con un code con forma de SQLSTATE no es SQLSTATE.
    const generic = describeThrown(Object.assign(new Error('x'), { code: '23505' }));
    expect('sqlstate' in generic).toBe(false);
    expect('errorCode' in generic).toBe(false);
    expect('message' in generic).toBe(false);
  });

  it('RF-D18: errorCode solo si el code cumple el patrón y no es un SQLSTATE', () => {
    expect(describeThrown(Object.assign(new Error('x'), { code: 'EPIPE' }))['errorCode']).toBe('EPIPE');
    expect(describeThrown(Object.assign(new Error('x'), { code: 'ECONNRESET' }))['errorCode']).toBe('ECONNRESET');
    for (const code of ['epipe', 'E PIPE', '1ABC', 42, undefined, null, {}]) {
      expect('errorCode' in describeThrown(Object.assign(new Error('x'), { code }))).toBe(false);
    }
    expect('errorCode' in describeThrown(dbError('23505'))).toBe(false);
  });

  it('RF-D18: message solo en errores propios y en errores de BD fuera de la clase 22', () => {
    expect(describeThrown(new AppError('fijo'))['message']).toBe('fijo');
    expect(describeThrown(dbError('23505', 'duplicado'))['message']).toBe('duplicado');
    expect('message' in describeThrown(dbError('22P02', 'valor'))).toBe(false);
    expect('message' in describeThrown(dbError('ABCDE', 'valor'))).toBe(false);
    expect('message' in describeThrown(new Error('valor'))).toBe(false);
  });

  it('RF-D18: la traza real conserva marcos y todas sus líneas cumplen el patrón', () => {
    const stack = describeThrown(new Error('boom'))['stack'];

    expect(stack).toBeTruthy();
    for (const line of (stack ?? '').split('\n')) {
      expect(FRAME_PATTERN.test(line)).toBe(true);
    }
  });

  it('RF-D18: la traza se limita a 30 líneas', () => {
    const lines = (describeThrown(withStack(50))['stack'] ?? '').split('\n');

    expect(MAX_STACK_LINES).toBe(30);
    expect(lines).toHaveLength(30);
    expect(lines[0]).toBe('at fn0 (/app/src/f.ts:1:1)');
    expect(lines[29]).toBe('at fn29 (/app/src/f.ts:30:1)');
  });

  it('RF-D18: sin marcos válidos no hay campo stack', () => {
    const error = new Error('x');
    error.stack = 'Error: x\n    at secreto';
    expect('stack' in describeThrown(error)).toBe(false);
    error.stack = undefined;
    expect('stack' in describeThrown(error)).toBe(false);
  });

  it('RF-D18: el texto del message se retira de la pila antes de filtrar', () => {
    const message = 'a\n    at fake (/secreto:1:1)';
    const error = dbError('22P02', message);
    const stack = describeThrown(error)['stack'] ?? '';

    expect(stack).not.toContain('secreto');
    expect(stack).not.toContain('fake');
  });
});
