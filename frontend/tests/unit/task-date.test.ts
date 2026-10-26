import { describe, expect, it } from 'vitest';
import { formatCreatedAt } from '../../src/lib/task-date';

const ISO = '2026-01-31T15:05:00.000Z';
// Node puede usar U+202F antes de «a. m.»: se normaliza cualquier espacio para comparar con el valor fijo.
const normalize = (text: string): string => text.replace(/\s/g, ' ');

describe('formatCreatedAt', () => {
  it('RF-F7: formatea con es-CO, dateStyle medium y timeStyle short en America/Bogota', () => {
    const expected = new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Bogota',
    }).format(new Date(ISO));
    expect(formatCreatedAt(ISO, 'America/Bogota')).toBe(expected);
    expect(normalize(formatCreatedAt(ISO, 'America/Bogota'))).toBe('31/01/2026, 10:05 a. m.');
  });

  it('RF-F7: sin zona usa la del navegador (igual a Intl con resolvedOptions().timeZone)', () => {
    const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    const expected = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
      new Date(ISO),
    );
    expect(formatCreatedAt(ISO)).toBe(expected);
  });
});
