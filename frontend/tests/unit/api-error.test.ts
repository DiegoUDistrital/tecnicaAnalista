import { describe, expect, it } from 'vitest';
import { NO_CONNECTION_MESSAGE, POST_UNCONFIRMED_MESSAGE, ownMessage, readErrorBody } from '../../src/lib/api-error';

const CODES = [
  'VALIDATION_ERROR',
  'BAD_REQUEST',
  'FORBIDDEN',
  'NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'TOO_MANY_REQUESTS',
  'UNSUPPORTED_MEDIA_TYPE',
  'REQUEST_TIMEOUT',
  'BAD_GATEWAY',
  'GATEWAY_TIMEOUT',
  'INTERNAL_ERROR',
];
const body = (code: unknown, message: unknown, details?: unknown) => ({ error: { code, message, details } });

describe('readErrorBody', () => {
  it.each(CODES)('RF-F6: un error con code %s y message de 1 a 200 caracteres devuelve ese message', (code) => {
    expect(readErrorBody(body(code, 'Mensaje del servidor.')).message).toBe('Mensaje del servidor.');
    expect(readErrorBody(body(code, 'a')).message).toBe('a');
    expect(readErrorBody(body(code, 'a'.repeat(200))).message).toBe('a'.repeat(200));
  });

  it.each([
    ['code fuera de la lista', body('OTHER', 'Hola')],
    ['METHOD_NOT_ALLOWED', body('METHOD_NOT_ALLOWED', 'Hola')],
    ['code no cadena', body(7, 'Hola')],
    ['message vacío', body('INTERNAL_ERROR', '')],
    ['message de 201 caracteres', body('INTERNAL_ERROR', 'a'.repeat(201))],
    ['message no cadena', body('INTERNAL_ERROR', 5)],
    ['sin message', { error: { code: 'INTERNAL_ERROR' } }],
    ['error no objeto', { error: 'boom' }],
    ['error null', { error: null }],
    ['sin error', { message: 'Hola' }],
    ['null', null],
    ['cadena', '<html>proxy</html>'],
    ['undefined', undefined],
    ['arreglo', []],
  ])('RF-F6: %s da sin mensaje', (_name, json) => {
    expect(readErrorBody(json)).toEqual({ message: undefined, details: [] });
  });

  it('RF-F10: los details de VALIDATION_ERROR se filtran (field cadena, message de 1 a 200) y en otros códigos se ignoran', () => {
    const details = [
      { field: 'title', message: 'Debe tener entre 1 y 100 caracteres.' },
      { field: 'description', message: 'a'.repeat(200) },
      { field: 7, message: 'campo no cadena' },
      { field: 'title', message: '' },
      { field: 'title', message: 'a'.repeat(201) },
      { field: 'title', message: 5 },
      { message: 'sin field' },
      'texto',
      null,
    ];
    expect(readErrorBody(body('VALIDATION_ERROR', 'Datos inválidos.', details))).toEqual({
      message: 'Datos inválidos.',
      details: [
        { field: 'title', message: 'Debe tener entre 1 y 100 caracteres.' },
        { field: 'description', message: 'a'.repeat(200) },
      ],
    });
    expect(readErrorBody(body('INTERNAL_ERROR', 'Error.', details)).details).toEqual([]);
    expect(readErrorBody(body('VALIDATION_ERROR', 'Datos inválidos.', 'no arreglo')).details).toEqual([]);
    expect(readErrorBody(body('VALIDATION_ERROR', 'Datos inválidos.')).details).toEqual([]);
  });

  it('RF-F10: details con un code fuera de la lista no se devuelven', () => {
    expect(readErrorBody(body('OTHER', 'x', [{ field: 'title', message: 'x' }])).details).toEqual([]);
  });
});

describe('mensajes propios', () => {
  it('RF-F9: mensaje propio general y mensaje propio de POST (los literales de la 006)', () => {
    expect(NO_CONNECTION_MESSAGE).toBe('No se pudo conectar con el servicio. Inténtalo más tarde.');
    expect(POST_UNCONFIRMED_MESSAGE).toBe(
      'No se pudo confirmar si la tarea se creó. Revisa la lista antes de volver a enviarla.',
    );
    expect(ownMessage('POST')).toBe(POST_UNCONFIRMED_MESSAGE);
    for (const method of ['GET', 'PUT', 'DELETE']) {
      expect(ownMessage(method)).toBe(NO_CONNECTION_MESSAGE);
    }
  });
});
