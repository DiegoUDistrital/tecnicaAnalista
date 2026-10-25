import { describe, expect, it } from 'vitest';
import { validateTaskUpdate } from '../../src/validation/task-update';

const parse = (json: string): Record<string, unknown> => JSON.parse(json) as Record<string, unknown>;
const update = (json: string) => validateTaskUpdate(parse(json));

describe('RF-C16: al menos un campo y sin desconocidos', () => {
  it('RF-C16: {} da body noFields', () => {
    expect(update('{}')).toEqual({ ok: false, problems: { body: 'noFields' } });
  });

  it('RF-C16: {"foo":1} da UNA sola entrada body unknownFields (no se añade noFields)', () => {
    expect(update('{"foo":1}')).toEqual({ ok: false, problems: { body: 'unknownFields' } });
  });

  it('RF-C16: {"foo":1,"completed":"x"} da body y completed', () => {
    expect(update('{"foo":1,"completed":"x"}')).toEqual({
      ok: false,
      problems: { body: 'unknownFields', completed: true },
    });
  });

  it('RF-C16: {"foo":1,"title":""} da body y title', () => {
    expect(update('{"foo":1,"title":""}')).toEqual({
      ok: false,
      problems: { body: 'unknownFields', title: 'length' },
    });
  });

  it('RF-C16: {"description":""} es válido y vacía la descripción', () => {
    expect(update('{"description":""}')).toEqual({ ok: true, changes: { description: '' } });
  });

  it('RF-C16: {"title":null} da problema title de tipo', () => {
    expect(update('{"title":null}')).toEqual({ ok: false, problems: { title: 'type' } });
  });
});

describe('RF-C8: completed', () => {
  it.each(['"true"', '1', '0', 'null', '{}', '[]', '"false"', '[true]'])(
    'RF-C8: completed %s da problema completed',
    (value) => {
      expect(update(`{"completed":${value}}`)).toEqual({ ok: false, problems: { completed: true } });
    },
  );

  it('RF-C8: completed solo acepta true o false reales', () => {
    expect(update('{"completed":true}')).toEqual({ ok: true, changes: { completed: true } });
    expect(update('{"completed":false}')).toEqual({ ok: true, changes: { completed: false } });
  });
});

describe('RF-C9/C11: title y description', () => {
  it('RF-C9: title se recorta y respeta 100/101 caracteres', () => {
    expect(update('{"title":"  hola  "}')).toEqual({ ok: true, changes: { title: 'hola' } });
    expect(update(`{"title":"${'a'.repeat(100)}"}`)).toEqual({ ok: true, changes: { title: 'a'.repeat(100) } });
    expect(update(`{"title":"${'a'.repeat(101)}"}`)).toEqual({ ok: false, problems: { title: 'length' } });
    expect(update('{"title":"   "}')).toEqual({ ok: false, problems: { title: 'length' } });
  });

  it('RF-C11: description respeta 500/501 caracteres y se recorta', () => {
    expect(update(`{"description":"${'a'.repeat(500)}"}`)).toEqual({
      ok: true,
      changes: { description: 'a'.repeat(500) },
    });
    expect(update(`{"description":"${'a'.repeat(501)}"}`)).toEqual({ ok: false, problems: { description: 'length' } });
    expect(update('{"description":"  x "}')).toEqual({ ok: true, changes: { description: 'x' } });
  });

  it('RF-C9/C11: NUL y sustituto suelto dan problema de caracteres', () => {
    expect(update('{"title":"a\\u0000b"}')).toEqual({ ok: false, problems: { title: 'characters' } });
    expect(update('{"description":"\\ud800"}')).toEqual({ ok: false, problems: { description: 'characters' } });
  });

  it('RF-C9/C11: description null o no cadena da problema description de tipo', () => {
    expect(update('{"description":null}')).toEqual({ ok: false, problems: { description: 'type' } });
    expect(update('{"description":5}')).toEqual({ ok: false, problems: { description: 'type' } });
    expect(update('{"title":5}')).toEqual({ ok: false, problems: { title: 'type' } });
  });

  it('RF-C9/C11: acumula title, description y completed', () => {
    expect(update('{"title":"","description":5,"completed":1}')).toEqual({
      ok: false,
      problems: { title: 'length', description: 'type', completed: true },
    });
  });
});

describe('RF-C7: claves desconocidas en PUT', () => {
  it.each(['id', 'createdAt', '__proto__', 'constructor'])('RF-C7: %s cuenta como desconocido en PUT', (key) => {
    expect(update(`{"title":"a",${JSON.stringify(key)}:1}`)).toEqual({
      ok: false,
      problems: { body: 'unknownFields' },
    });
  });
});

describe('RF-C15: solo las claves presentes', () => {
  it('RF-C15: los cambios solo contienen las claves presentes (las ausentes no aparecen ni como undefined)', () => {
    const result = update('{"title":"a"}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.changes)).toEqual(['title']);
    }
    const all = update('{"completed":true,"description":"d","title":"t"}');
    expect(all).toEqual({ ok: true, changes: { title: 't', description: 'd', completed: true } });
  });
});
