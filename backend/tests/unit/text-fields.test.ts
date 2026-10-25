import { describe, expect, it } from 'vitest';
import { validateDescription, validateTitle } from '../../src/validation/text-fields';

/** Los 25 puntos de código que `trim()` recorta (conjunto de espacios de la spec). */
const TRIMMED = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
  0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];
const NOT_TRIMMED = [0x0085, 0x180e, 0x200b];

const hex = (code: number): string => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
const cases = (codes: number[]): [string, string][] => codes.map((code) => [hex(code), String.fromCodePoint(code)]);

describe('RF-C9: recorte de espacios', () => {
  it('RF-C9: el conjunto de la spec tiene 25 puntos de código', () => {
    expect(new Set(TRIMMED).size).toBe(25);
  });

  it.each(cases(TRIMMED))('RF-C9: recorta %s en los extremos', (_name, space) => {
    expect(validateTitle(`${space}${space}abc${space}`)).toEqual({ ok: true, value: 'abc' });
    expect(validateDescription(`${space}abc${space}`)).toEqual({ ok: true, value: 'abc' });
  });

  it.each(cases(NOT_TRIMMED))('RF-C9: %s en los extremos NO se recorta', (_name, character) => {
    expect(validateTitle(`${character}abc${character}`)).toEqual({ ok: true, value: `${character}abc${character}` });
  });

  it.each(cases(TRIMMED))('RF-C9: un título de solo %s es inválido por longitud', (_name, space) => {
    expect(validateTitle(space.repeat(3))).toEqual({ ok: false, problem: 'length' });
  });

  it('RF-C9: un título de solo U+200B se acepta (limitación conocida)', () => {
    expect(validateTitle('​')).toEqual({ ok: true, value: '​' });
  });
});

describe('RF-C9: longitud', () => {
  it('RF-C9: title de 100 caracteres es válido y de 101 inválido', () => {
    expect(validateTitle('a'.repeat(100))).toEqual({ ok: true, value: 'a'.repeat(100) });
    expect(validateTitle('a'.repeat(101))).toEqual({ ok: false, problem: 'length' });
  });

  it('RF-C9: description de 500 válida y de 501 inválida', () => {
    expect(validateDescription('a'.repeat(500))).toEqual({ ok: true, value: 'a'.repeat(500) });
    expect(validateDescription('a'.repeat(501))).toEqual({ ok: false, problem: 'length' });
  });

  it('RF-C9: la longitud se mide tras recortar', () => {
    expect(validateTitle(` ${'a'.repeat(100)} `).ok).toBe(true);
    expect(validateDescription(` ${'a'.repeat(500)} `).ok).toBe(true);
  });

  it('RF-C9: title vacío es inválido por longitud', () => {
    expect(validateTitle('')).toEqual({ ok: false, problem: 'length' });
  });

  it('RF-C9: description vacía es válida; el valor recortado es el que se devuelve', () => {
    expect(validateDescription('')).toEqual({ ok: true, value: '' });
    expect(validateDescription('   ')).toEqual({ ok: true, value: '' });
    expect(validateDescription('  hola  ')).toEqual({ ok: true, value: 'hola' });
  });

  it('RF-C9: un emoji de un solo punto de código cuenta como un carácter', () => {
    const emoji = '\u{1F600}';
    expect(emoji.length).toBe(2);
    expect(validateTitle(emoji.repeat(100)).ok).toBe(true);
    expect(validateTitle(emoji.repeat(101))).toEqual({ ok: false, problem: 'length' });
    expect(validateDescription(emoji.repeat(500)).ok).toBe(true);
    expect(validateDescription(emoji.repeat(501))).toEqual({ ok: false, problem: 'length' });
  });
});

describe('RF-C9: caracteres no permitidos', () => {
  it.each([
    ['U+0000', 'a\u0000b'],
    ['sustituto alto suelto', 'a\ud800b'],
    ['sustituto bajo suelto', 'a\udc00b'],
    ['sustituto suelto solo', '\ud800'],
  ])('RF-C9: %s da problema characters', (_name, text) => {
    expect(validateTitle(text)).toEqual({ ok: false, problem: 'characters' });
    expect(validateDescription(text)).toEqual({ ok: false, problem: 'characters' });
  });

  it('RF-C9: un par de sustitutos válido (emoji) se acepta', () => {
    expect(validateTitle('😀')).toEqual({ ok: true, value: '\u{1F600}' });
    expect(validateDescription('x\u{1F600}')).toEqual({ ok: true, value: 'x\u{1F600}' });
  });

  it('RF-C9: otros caracteres de control e invisibles se aceptan', () => {
    expect(validateDescription('línea1\nlínea2\u0001⁠').ok).toBe(true);
  });
});

describe('RF-C8: tipo', () => {
  const NOT_STRINGS: [string, unknown][] = [
    ['número', 5],
    ['booleano', true],
    ['null', null],
    ['objeto', {}],
    ['arreglo', ['a']],
    ['undefined', undefined],
  ];

  it.each(NOT_STRINGS)('RF-C8: %s da problema type en title y en description', (_name, value) => {
    expect(validateTitle(value)).toEqual({ ok: false, problem: 'type' });
    expect(validateDescription(value)).toEqual({ ok: false, problem: 'type' });
  });
});

describe('RF-C23: orden de comprobación por campo', () => {
  it('RF-C23: tipo, caracteres no permitidos, longitud (NUL y demasiado largo da characters)', () => {
    expect(validateTitle(`\u0000${'a'.repeat(200)}`)).toEqual({ ok: false, problem: 'characters' });
    expect(validateDescription(`\u0000${'a'.repeat(600)}`)).toEqual({ ok: false, problem: 'characters' });
  });
});
