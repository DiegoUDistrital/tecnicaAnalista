import { describe, expect, it } from 'vitest';
import { evaluateQuery, hasQueryParameters } from '../../src/validation/raw-query';

const CLEAN = { completed: undefined, completedInvalid: false, unknownParameters: false };

describe('RF-C10: evaluateQuery (consulta cruda)', () => {
  // Un `?` solo llega a esta función como cadena vacía: la parte tras el `?` es la consulta cruda.
  it.each([[''], ['&&'], ['&'], ['&&&&']])('RF-C10: sin consulta y con "&&" no hay parámetros (%j)', (raw) => {
    expect(evaluateQuery(raw)).toEqual(CLEAN);
  });

  it.each([
    ['completed=true', true],
    ['completed=false', false],
    ['&completed=true&', true],
    ['completed=true&&', true],
  ])('RF-C10: %s es válido', (raw, completed) => {
    expect(evaluateQuery(raw)).toEqual({ ...CLEAN, completed });
  });

  it.each([
    ['completed=TRUE'],
    ['completed=True'],
    ['completed='],
    ['completed'],
    ['completed=a&completed=b'],
    ['completed=true&completed=true'],
    ['completed[]=true'],
    ['completed[a]=true'],
    ['completed[a][b]=true'],
    ['completed%5B%5D=true'],
    ['completed=1'],
    ['completed=true%20'],
    ['completed=true+'],
    ['completed=%2574rue'],
    ['completed=%E0%A4%A'],
    ['completed=%'],
  ])('RF-C10: %s da completedInvalid y ningún desconocido', (raw) => {
    expect(evaluateQuery(raw)).toEqual({ ...CLEAN, completedInvalid: true });
  });

  it.each([
    ['completed=%74rue', true],
    ['%63ompleted=true', true],
    ['%63ompleted=%66alse', false],
    ['completed=tru%65', true],
  ])('RF-C10: %s se decodifica una sola vez y es válido', (raw, completed) => {
    expect(evaluateQuery(raw)).toEqual({ ...CLEAN, completed });
  });

  it.each([
    ['completed=true%20'],
    ['completed=%2574rue'],
    ['completed=%E0%A4%A'],
    ['completed=%E0%A4%A&completed=true'],
  ])('RF-C10: %s nunca lanza', (raw) => {
    expect(() => evaluateQuery(raw)).not.toThrow();
  });

  it.each([
    ['filter=pending'],
    ['__proto__=x'],
    ['constructor=1'],
    ['a[b]=1'],
    ['x'],
    ['=true'],
    ['=x'],
    ['%E0%A4%A=1'],
    ['%=1'],
    ['completed[=true'],
    ['completed[a]x=true'],
    ['completed[[]]=true'],
    ['completedx=true'],
    ['Completed=true'],
  ])('RF-C10: %s es un parámetro desconocido', (raw) => {
    expect(evaluateQuery(raw)).toEqual({ ...CLEAN, unknownParameters: true });
  });

  it('RF-C10: un parámetro desconocido junto a un completed válido conserva el valor', () => {
    expect(evaluateQuery('completed=true&x=1')).toEqual({
      completed: true,
      completedInvalid: false,
      unknownParameters: true,
    });
  });

  it('RF-C10: 1 500 parámetros se evalúan todos (un desconocido más allá del 1000)', () => {
    const many = Array.from({ length: 1499 }, () => 'completed[]=1').join('&');
    const raw = `${many}&late=1`;

    expect(raw.split('&')).toHaveLength(1500);
    expect(evaluateQuery(raw)).toEqual({ completed: undefined, completedInvalid: true, unknownParameters: true });
  });

  it('RF-C10: el nombre __proto__ se evalúa sin tocar el prototipo', () => {
    evaluateQuery('__proto__=x&constructor=1');

    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });

  it('RF-C10: si coinciden completed inválido y parámetro desconocido, ambos indicadores están activos', () => {
    expect(evaluateQuery('completed=nope&x=1')).toEqual({
      completed: undefined,
      completedInvalid: true,
      unknownParameters: true,
    });
  });
});

describe('RF-C10: hasQueryParameters (POST, PUT y DELETE)', () => {
  it.each([[''], ['&&'], ['&']])('RF-C10: %j no cuenta como parámetros', (raw) => {
    expect(hasQueryParameters(raw)).toBe(false);
  });

  it.each([['completed=true'], ['x=1'], ['x'], ['=']])('RF-C10: %j sí cuenta', (raw) => {
    expect(hasQueryParameters(raw)).toBe(true);
  });
});
