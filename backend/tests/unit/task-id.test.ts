import { describe, expect, it } from 'vitest';
import { parseTaskId } from '../../src/validation/task-id';

const LOWER = '123e4567-e89b-12d3-a456-426614174000';
const UPPER = '123E4567-E89B-12D3-A456-426614174000';

describe('RF-C6: identificador válido', () => {
  it('RF-C6: acepta un UUID en minúsculas y en mayúsculas y lo devuelve en minúsculas', () => {
    expect(parseTaskId(LOWER)).toEqual({ ok: true, value: LOWER });
    expect(parseTaskId(UPPER)).toEqual({ ok: true, value: LOWER });
    expect(parseTaskId('123e4567-E89B-12d3-A456-426614174000')).toEqual({ ok: true, value: LOWER });
  });

  it('RF-C6: el UUID nulo tiene formato válido', () => {
    const nil = '00000000-0000-0000-0000-000000000000';
    expect(parseTaskId(nil)).toEqual({ ok: true, value: nil });
  });

  it('RF-C6: %2D en lugar de guiones y %41 por A son válidos (una decodificación)', () => {
    expect(parseTaskId(LOWER.replaceAll('-', '%2D'))).toEqual({ ok: true, value: LOWER });
    expect(parseTaskId('123e4567-e89b-12d3-%41456-426614174000')).toEqual({ ok: true, value: LOWER });
  });
});

describe('RF-C6: identificador inválido', () => {
  const rejected: [string, string][] = [
    ['%2F', `${LOWER.slice(0, 8)}%2F${LOWER.slice(9)}`],
    ['%252D (doble codificación)', LOWER.replaceAll('-', '%252D')],
    ['uuid seguido de %2F', `${LOWER}%2F`],
    ['%E0%A4%A (no decodificable)', '%E0%A4%A'],
    ['uuid con %E0%A4%A', `${LOWER}%E0%A4%A`],
    ['salto de línea final (%0A)', `${LOWER}%0A`],
    ['salto de línea final literal', `${LOWER}\n`],
    ['salto de línea inicial', `\n${LOWER}`],
    ['dígitos de anchura completa', LOWER.replace('123', '１２３')],
    ['llaves', `{${LOWER}}`],
    ['sin guiones', LOWER.replaceAll('-', '')],
    ['vacío', ''],
    ['35 caracteres', LOWER.slice(0, 35)],
    ['37 caracteres', `${LOWER}0`],
    ['prefijo urn:uuid:', `urn:uuid:${LOWER}`],
    ['carácter no hexadecimal', LOWER.replace('123e', '123g')],
    ['espacio al final', `${LOWER} `],
  ];

  it.each(rejected)('RF-C6: rechaza %s', (_name, raw) => {
    expect(parseTaskId(raw)).toEqual({ ok: false });
  });

  it('RF-C6: %E0%A4%A nunca lanza', () => {
    expect(() => parseTaskId('%E0%A4%A')).not.toThrow();
  });
});
