import { describe, expect, it } from 'vitest';
import { toTask } from '../../src/server/proxy/task-shape';

const VALID = {
  id: '3f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6b',
  title: 'Comprar pan',
  description: '',
  completed: false,
  createdAt: '2026-01-31T10:00:00.000Z',
};

describe('toTask', () => {
  it('RF-F20: una tarea de cinco claves válidas pasa', () => {
    expect(toTask(VALID)).toEqual(VALID);
    expect(toTask({ ...VALID, createdAt: '2026-01-31T10:00:00+02:00', title: 'a'.repeat(100) })).toBeDefined();
    expect(toTask({ ...VALID, description: 'é'.repeat(500), id: VALID.id.toUpperCase() })).toBeDefined();
    expect(toTask({ ...VALID, title: '😀'.repeat(100) })).toBeDefined();
    expect(toTask({ ...VALID, createdAt: '2024-02-29T23:59:59Z' })).toBeDefined();
  });

  it.each([
    ['seis claves', { ...VALID, extra: 1 }],
    ['cuatro claves', { id: VALID.id, title: 'a', description: '', completed: true }],
    ['cinco claves con otro nombre', { ...VALID, createdAt: undefined, created: VALID.createdAt }],
    ['id no UUID', { ...VALID, id: '3f2b8c1e-5a4d-4e6f-9a0b' }],
    ['id con sufijo', { ...VALID, id: `${VALID.id}x` }],
    ['id no cadena', { ...VALID, id: 7 }],
    ['title vacío', { ...VALID, title: '' }],
    ['title de 101', { ...VALID, title: 'a'.repeat(101) }],
    ['title de 101 puntos de código', { ...VALID, title: '😀'.repeat(101) }],
    ['title no cadena', { ...VALID, title: 5 }],
    ['description de 501', { ...VALID, description: 'a'.repeat(501) }],
    ['description no cadena', { ...VALID, description: null }],
    ['completed no booleano', { ...VALID, completed: 'false' }],
    ['createdAt sin zona', { ...VALID, createdAt: '2026-01-31T10:00:00' }],
    ['createdAt no ISO 8601', { ...VALID, createdAt: '31/01/2026' }],
    ['createdAt con fecha imposible', { ...VALID, createdAt: '2026-02-31T00:00:00Z' }],
    ['createdAt 29 de febrero sin bisiesto', { ...VALID, createdAt: '2026-02-29T00:00:00Z' }],
    ['createdAt con hora 24', { ...VALID, createdAt: '2026-01-31T24:00:00Z' }],
    ['createdAt con minutos 60', { ...VALID, createdAt: '2026-01-31T10:60:00Z' }],
    ['createdAt con desfase imposible', { ...VALID, createdAt: '2026-01-31T10:00:00+25:00' }],
    ['createdAt no cadena', { ...VALID, createdAt: 1769853600000 }],
    ['arreglo', [VALID]],
    ['null', null],
    ['cadena', 'tarea'],
  ])('RF-F20: %s falla', (_name, value) => {
    expect(toTask(value)).toBeUndefined();
  });

  it('RF-F20: la salida conserva solo las cinco claves en orden fijo', () => {
    const shuffled = {
      createdAt: VALID.createdAt,
      completed: VALID.completed,
      description: VALID.description,
      title: VALID.title,
      id: VALID.id,
    };
    expect(Object.keys(toTask(shuffled) ?? {})).toEqual(['id', 'title', 'description', 'completed', 'createdAt']);
  });
});
