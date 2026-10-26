import { describe, expect, it } from 'vitest';
import { isTask } from '../../src/lib/task';

const VALID = {
  id: '3f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6b',
  title: 'Comprar pan',
  description: '',
  completed: false,
  createdAt: '2026-01-31T10:00:00.000Z',
};

describe('isTask', () => {
  it('RF-F6: una tarea con los cinco campos y su tipo pasa', () => {
    expect(isTask(VALID)).toBe(true);
    expect(isTask({ ...VALID, completed: true })).toBe(true);
  });

  it.each([
    ['null', null],
    ['cadena', 'tarea'],
    ['arreglo', [VALID]],
    ['falta createdAt', { ...VALID, createdAt: undefined }],
    ['id no cadena', { ...VALID, id: 7 }],
    ['title no cadena', { ...VALID, title: 7 }],
    ['description no cadena', { ...VALID, description: null }],
    ['completed no booleano', { ...VALID, completed: 'false' }],
    ['createdAt no cadena', { ...VALID, createdAt: 0 }],
  ])('RF-F6: %s no pasa', (_name, value) => {
    expect(isTask(value)).toBe(false);
  });
});
