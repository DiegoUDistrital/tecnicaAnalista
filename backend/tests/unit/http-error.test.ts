import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors/app-error';
import { DatabaseUnavailableError } from '../../src/errors/database-unavailable-error';
import { HttpError } from '../../src/http/http-error';
import { ThrownValue } from '../../src/http/guard';

const TABLE = [
  { status: 400, code: 'VALIDATION_ERROR', message: 'Datos inválidos.' },
  { status: 401, code: 'UNAUTHORIZED', message: 'No autorizado.' },
  { status: 404, code: 'NOT_FOUND', message: 'Recurso no encontrado.' },
  { status: 405, code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido.' },
  { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'El cuerpo de la petición supera el tamaño máximo.' },
  { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Tipo de contenido no admitido.' },
  { status: 500, code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' },
] as const;

const ENTRY = { field: 'title', message: 'Es obligatorio.' };

function build(status: (typeof TABLE)[number]['status']): HttpError {
  return status === 400 ? new HttpError(400, [ENTRY]) : new HttpError(status);
}

describe('RF-S7: HttpError', () => {
  it.each(TABLE)('RF-S7: el estado $status tiene el code $code y el message literal de la tabla', (row) => {
    const error = build(row.status);

    expect(error.status).toBe(row.status);
    expect(error.code).toBe(row.code);
    expect(error.message).toBe(row.message);
    expect(Array.isArray(error.details)).toBe(true);
    expect(error.details).toEqual(row.status === 400 ? [ENTRY] : []);
  });

  it.each(TABLE)(
    'RF-S7: toBody() del estado $status devuelve exactamente { error: { code, message, details } }',
    (row) => {
      const error = build(row.status);

      expect(error.toBody()).toEqual({
        error: { code: row.code, message: row.message, details: row.status === 400 ? [ENTRY] : [] },
      });
    },
  );

  it('RF-S7: 401 UNAUTHORIZED «No autorizado.» con details []', () => {
    expect(new HttpError(401).toBody()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'No autorizado.', details: [] },
    });
    expect(() => new HttpError(401, [ENTRY])).toThrow(TypeError);
  });

  it('RF-S7: ejemplo del contrato del 400', () => {
    expect(new HttpError(400, [{ field: 'title', message: 'Es obligatorio.' }]).toBody()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Datos inválidos.',
        details: [{ field: 'title', message: 'Es obligatorio.' }],
      },
    });
  });

  it('RF-S7: un 400 con details vacío se rechaza', () => {
    expect(() => new HttpError(400)).toThrow(TypeError);
    expect(() => new HttpError(400, [])).toThrow(TypeError);
  });

  it('RF-S7: un estado distinto de 400 con details se rechaza', () => {
    expect(() => new HttpError(404, [ENTRY])).toThrow(TypeError);
    expect(() => new HttpError(500, [ENTRY])).toThrow(TypeError);
  });

  it('RF-S7: HttpError es instancia de AppError y de Error y su name es HttpError', () => {
    const error = new HttpError(404);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('HttpError');
  });

  it('RF-S7: DatabaseUnavailableError y ThrownValue son AppError pero no HttpError', () => {
    const unavailable = new DatabaseUnavailableError();
    const thrown = new ThrownValue('x');

    expect(unavailable).toBeInstanceOf(AppError);
    expect(unavailable).not.toBeInstanceOf(HttpError);
    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown).not.toBeInstanceOf(HttpError);
  });
});
