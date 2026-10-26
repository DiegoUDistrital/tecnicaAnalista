import { describe, expect, it } from 'vitest';
import { readFilter } from '../../src/lib/task-filter';

describe('readFilter', () => {
  it('RF-F1: readFilter devuelve completed y pending para esos valores exactos', () => {
    expect(readFilter({ filter: 'completed' })).toBe('completed');
    expect(readFilter({ filter: 'pending' })).toBe('pending');
  });

  it.each([
    ['undefined', undefined],
    ['all', 'all'],
    ['COMPLETED', 'COMPLETED'],
    ['con espacio', 'completed '],
    ['vacío', ''],
    ['__proto__', '__proto__'],
    ['<script>', '<script>'],
    ['10 000 caracteres', 'a'.repeat(10_000)],
    ['arreglo', ['completed', 'pending']],
  ])('RF-F1: %s da all sin lanzar', (_name, value) => {
    expect(readFilter({ filter: value })).toBe('all');
  });

  it('RF-F1: un parámetro adicional (completed y x=1, o x=1 sin filter) da all (P6)', () => {
    expect(readFilter({ filter: 'completed', x: '1' })).toBe('all');
    expect(readFilter({ x: '1' })).toBe('all');
    expect(readFilter({})).toBe('all');
  });

  it('RF-F1: filter=completed&filter=pending (arreglo) da all', () => {
    expect(readFilter({ filter: ['completed', 'pending'] })).toBe('all');
    expect(readFilter({ filter: ['completed'] })).toBe('all');
  });
});
