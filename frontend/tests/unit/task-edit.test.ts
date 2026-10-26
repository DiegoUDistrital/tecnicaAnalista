import { describe, expect, it } from 'vitest';
import { changedFields } from '../../src/lib/task-edit';

const original = { title: 'Comprar pan', description: 'Integral' };

describe('changedFields', () => {
  it('RF-F12: solo se incluye el campo cuyo valor recortado difiere del original', () => {
    expect(changedFields(original, { title: ' Comprar leche ', description: 'Integral' })).toEqual({
      title: 'Comprar leche',
    });
    expect(changedFields(original, { title: 'Comprar pan', description: '' })).toEqual({ description: '' });
    expect(changedFields(original, { title: 'a', description: 'b' })).toEqual({ title: 'a', description: 'b' });
  });

  it('RF-F12: un cambio solo de espacios no cuenta', () => {
    expect(changedFields(original, { title: '  Comprar pan  ', description: '\nIntegral　' })).toEqual({});
  });

  it('RF-F12: sin cambios devuelve un objeto vacío', () => {
    expect(changedFields(original, { ...original })).toEqual({});
  });
});
