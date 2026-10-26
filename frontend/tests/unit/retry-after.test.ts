import { describe, expect, it } from 'vitest';
import { describeRetryAfter } from '../../src/server/proxy/retry-after';

const FALLBACK = 'Demasiadas peticiones. Inténtalo de nuevo en unos instantes.';

describe('describeRetryAfter', () => {
  it.each([
    ['7', 'Demasiadas peticiones. Espera 7 segundos e inténtalo de nuevo.'],
    ['1', 'Demasiadas peticiones. Espera 1 segundo e inténtalo de nuevo.'],
    ['119', 'Demasiadas peticiones. Espera 119 segundos e inténtalo de nuevo.'],
    ['120', 'Demasiadas peticiones. Espera 2 minutos e inténtalo de nuevo.'],
    ['121', 'Demasiadas peticiones. Espera 3 minutos e inténtalo de nuevo.'],
    ['3600', 'Demasiadas peticiones. Espera 60 minutos e inténtalo de nuevo.'],
  ])('RF-F20: Retry-After %s es válido y se conserva la cabecera', (raw, message) => {
    expect(describeRetryAfter(raw)).toEqual({ message, retryAfter: raw });
  });

  it.each([
    null,
    '3601',
    '0',
    '-1',
    'abc',
    '',
    '7.5',
    '+7',
    '007',
    '1e3',
    'Wed, 21 Oct 2026 07:28:00 GMT',
    ' 7',
    '7 ',
    '9'.repeat(1000),
  ])('RF-F20: Retry-After %j no es válido: frase de reserva y sin cabecera', (raw) => {
    expect(describeRetryAfter(raw)).toEqual({ message: FALLBACK, retryAfter: undefined });
  });
});
