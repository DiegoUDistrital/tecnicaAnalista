import { describe, expect, it } from 'vitest';
import {
  emptyResponse,
  jsonResponse,
  methodNotAllowed,
  ownError,
  type OwnErrorKind,
} from '../../src/server/proxy/responses';

const UNAVAILABLE = 'El servicio no está disponible. Inténtalo más tarde.';

const TABLE: ReadonlyArray<{
  kind: OwnErrorKind;
  status: number;
  code: string;
  message: string;
  details: unknown[];
}> = [
  {
    kind: 'forbidden',
    status: 403,
    code: 'FORBIDDEN',
    message: 'Operación no permitida desde este origen.',
    details: [],
  },
  {
    kind: 'invalid_id',
    status: 400,
    code: 'BAD_REQUEST',
    message: 'El identificador no es válido.',
    details: [{ field: 'id', message: 'El identificador no es un UUID válido.' }],
  },
  {
    kind: 'invalid_query',
    status: 400,
    code: 'BAD_REQUEST',
    message: 'Parámetros de consulta no permitidos.',
    details: [{ field: 'query', message: 'Parámetros de consulta no permitidos.' }],
  },
  {
    kind: 'invalid_body',
    status: 400,
    code: 'BAD_REQUEST',
    message: 'El cuerpo debe ser un objeto JSON válido.',
    details: [{ field: 'body', message: 'El cuerpo debe ser un objeto JSON válido.' }],
  },
  { kind: 'too_large', status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'El texto es demasiado largo.', details: [] },
  {
    kind: 'unsupported_media',
    status: 415,
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'Formato de petición no admitido.',
    details: [],
  },
  {
    kind: 'timeout',
    status: 408,
    code: 'REQUEST_TIMEOUT',
    message: 'La petición tardó demasiado. Inténtalo de nuevo.',
    details: [],
  },
  { kind: 'internal', status: 500, code: 'INTERNAL_ERROR', message: UNAVAILABLE, details: [] },
];

describe('respuestas propias', () => {
  it.each(TABLE)(
    'RF-F20: la respuesta propia $kind tiene el código, el mensaje en español, los details y no-store',
    async ({ kind, status, code, message, details }) => {
      const response = ownError(kind);
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(await response.json()).toEqual({ error: { code, message, details } });
    },
  );

  it('RF-F20: el 405 lleva Allow, código, mensaje, details vacío y no-store', async () => {
    const response = methodNotAllowed('GET, POST', 'PATCH');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, POST');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Operación no permitida.', details: [] },
    });
  });

  it('RF-F20: el 405 de HEAD no lleva cuerpo pero conserva Allow y no-store', () => {
    const response = methodNotAllowed('PUT, DELETE', 'HEAD');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('PUT, DELETE');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.body).toBeNull();
  });

  it('RF-F20: el 204 no lleva cuerpo y lleva no-store', () => {
    const response = emptyResponse(204);
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('RF-F20: jsonResponse serializa el cuerpo con el estado dado y no-store', async () => {
    const response = jsonResponse(201, { id: 1 });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ id: 1 });
  });
});
