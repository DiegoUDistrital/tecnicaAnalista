import { describe, expect, it } from 'vitest';
import { parseEmptyQuery, parseListQuery } from '../../src/server/proxy/request-query';

describe('parseListQuery (GET /api/tasks)', () => {
  it('RF-F19: GET sin parámetros, con ? vacío y con filter=completed|pending (también filter=%63ompleted) son válidos', () => {
    expect(parseListQuery('')).toEqual({ filter: undefined });
    expect(parseListQuery('?')).toEqual({ filter: undefined });
    expect(parseListQuery('?&&')).toEqual({ filter: undefined });
    expect(parseListQuery('?filter=completed')).toEqual({ filter: 'completed' });
    expect(parseListQuery('?filter=pending')).toEqual({ filter: 'pending' });
    expect(parseListQuery('?filter=%63ompleted')).toEqual({ filter: 'completed' });
    expect(parseListQuery('?%66ilter=pending&')).toEqual({ filter: 'pending' });
  });

  it('RF-F19: filter=all, filter=, filter[]=completed, filter=completed&filter=pending, x=1 y %zz son 400', () => {
    for (const search of [
      '?filter=all',
      '?filter=',
      '?filter',
      '?filter[]=completed',
      '?filter=completed&filter=pending',
      '?filter=completed&filter=completed',
      '?x=1',
      '?filter=completed&x=1',
      '?filter=%zz',
      '?%zz=completed',
      '?filter=COMPLETED',
      '?=completed',
    ]) {
      expect(parseListQuery(search), search).toBeUndefined();
    }
  });

  it('RF-F19: + es un espacio y se decodifica una sola vez (filter=%2563ompleted es 400)', () => {
    expect(parseListQuery('?filter=%2563ompleted')).toBeUndefined();
    expect(parseListQuery('?filter=completed+')).toBeUndefined();
    expect(parseListQuery('?filter=+')).toBeUndefined();
    expect(parseListQuery('?filter%3Dcompleted')).toBeUndefined();
  });
});

describe('parseEmptyQuery (POST, PUT, DELETE)', () => {
  it('RF-F19: en POST, PUT y DELETE cualquier parámetro es 400 y ? vacío es válido', () => {
    expect(parseEmptyQuery('')).toBe(true);
    expect(parseEmptyQuery('?')).toBe(true);
    expect(parseEmptyQuery('?&')).toBe(true);
    expect(parseEmptyQuery('?x=1')).toBe(false);
    expect(parseEmptyQuery('?filter=completed')).toBe(false);
    expect(parseEmptyQuery('?x')).toBe(false);
    expect(parseEmptyQuery('?%zz')).toBe(false);
  });
});
