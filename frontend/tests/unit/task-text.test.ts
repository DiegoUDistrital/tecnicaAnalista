import { describe, expect, it } from 'vitest';
import { countCodePoints, trimText, validateDescription, validateTitle } from '../../src/lib/task-text';

// Misma tabla que la validación de Express (RF-C9 del backend): el cliente solo es una comodidad.
const TRIMMED = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
  0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];
const hex = (code: number): string => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
const spaces = TRIMMED.map((code): [string, string] => [hex(code), String.fromCodePoint(code)]);

const TITLE_LENGTH = 'Debe tener entre 1 y 100 caracteres.';
const DESCRIPTION_LENGTH = 'Debe tener como máximo 500 caracteres.';
const FORBIDDEN = 'Contiene caracteres no permitidos.';
const EMOJI = '\u{1F600}';

describe('validación de texto del cliente', () => {
  it('RF-F10: el conjunto de trim() tiene 25 puntos de código', () => {
    expect(new Set(TRIMMED).size).toBe(25);
  });

  it.each(spaces)('RF-F10: vacío y solo espacios de tipo %s dan el mensaje de longitud del título', (_name, space) => {
    expect(validateTitle('')).toEqual({ ok: false, message: TITLE_LENGTH });
    expect(validateTitle(space.repeat(3))).toEqual({ ok: false, message: TITLE_LENGTH });
  });

  it.each(spaces)('RF-F10: %s en los extremos se recorta en título y descripción', (_name, space) => {
    expect(validateTitle(`${space}abc${space}`)).toEqual({ ok: true, value: 'abc' });
    expect(validateDescription(`${space}abc${space}`)).toEqual({ ok: true, value: 'abc' });
  });

  it('RF-F10: U+0085 y U+200B en los extremos no se recortan (cuentan como caracteres)', () => {
    for (const character of ['\u0085', '​', '᠎']) {
      expect(validateTitle(`${character}abc${character}`)).toEqual({ ok: true, value: `${character}abc${character}` });
    }
  });

  it('RF-F10: U+00A0 y U+3000 en los extremos se recortan', () => {
    expect(validateTitle(' 　abc　 ')).toEqual({ ok: true, value: 'abc' });
    expect(validateDescription(' 　')).toEqual({ ok: true, value: '' });
  });

  it('RF-F10: 100 caracteres válido y 101 inválido, con ASCII y con 100 emojis válidos', () => {
    expect(validateTitle('a'.repeat(100)).ok).toBe(true);
    expect(validateTitle('a'.repeat(101))).toEqual({ ok: false, message: TITLE_LENGTH });
    expect(validateTitle(EMOJI.repeat(100)).ok).toBe(true);
    expect(validateTitle(EMOJI.repeat(101))).toEqual({ ok: false, message: TITLE_LENGTH });
  });

  it('RF-F10: descripción 500 válida y 501 da el mensaje de máximo; vacía es válida', () => {
    expect(validateDescription('a'.repeat(500)).ok).toBe(true);
    expect(validateDescription(EMOJI.repeat(500)).ok).toBe(true);
    expect(validateDescription('a'.repeat(501))).toEqual({ ok: false, message: DESCRIPTION_LENGTH });
    expect(validateDescription(EMOJI.repeat(501))).toEqual({ ok: false, message: DESCRIPTION_LENGTH });
    expect(validateDescription('')).toEqual({ ok: true, value: '' });
  });

  it.each([
    ['NUL', 'a\u0000b'],
    ['sustituto alto suelto', 'a\ud800b'],
    ['sustituto bajo suelto', 'a\udc00b'],
  ])('RF-F10: %s da el mensaje de caracteres no permitidos antes que la longitud', (_name, text) => {
    expect(validateTitle(text)).toEqual({ ok: false, message: FORBIDDEN });
    expect(validateDescription(text)).toEqual({ ok: false, message: FORBIDDEN });
    expect(validateTitle(`${text}${'a'.repeat(200)}`)).toEqual({ ok: false, message: FORBIDDEN });
    expect(validateDescription(`${text}${'a'.repeat(600)}`)).toEqual({ ok: false, message: FORBIDDEN });
  });

  it('RF-F10: un par de sustitutos válido (emoji) se acepta', () => {
    expect(validateTitle(EMOJI)).toEqual({ ok: true, value: EMOJI });
  });

  it('RF-F10: el valor devuelto es el recortado', () => {
    expect(validateTitle('  hola  ')).toEqual({ ok: true, value: 'hola' });
    expect(validateDescription('\n línea1\nlínea2 \n')).toEqual({ ok: true, value: 'línea1\nlínea2' });
  });

  it('RF-F10: el contador cuenta puntos de código sobre el texto recortado (emoji compuesto con ZWJ cuenta varios)', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    expect(trimText('  ab  ')).toBe('ab');
    expect(countCodePoints(trimText('   ab   '))).toBe(2);
    expect(countCodePoints(EMOJI)).toBe(1);
    expect(countCodePoints(family)).toBe(5);
    expect(countCodePoints('')).toBe(0);
  });
});
