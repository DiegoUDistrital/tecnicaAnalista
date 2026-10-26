import { describe, expect, it } from 'vitest';
import type { BackendMethod, BackendResult } from '../../src/server/proxy/backend-client';
import { mapResult } from '../../src/server/proxy/response-mapper';

const TASK = {
  id: '3f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6b',
  title: 'Comprar pan',
  description: '',
  completed: false,
  createdAt: '2026-01-31T10:00:00.000Z',
};
const UNAVAILABLE = 'El servicio no está disponible. Inténtalo más tarde.';
const NO_CONNECT = 'No se pudo conectar con el servicio. Inténtalo más tarde.';
const POST_UNSURE = 'No se pudo confirmar si la tarea se creó. Revisa la lista antes de volver a enviarla.';

interface Mapped {
  status: number;
  json: { error: { code: string; message: string; details: unknown[] } };
  response: Response;
}

async function map(result: BackendResult, method: BackendMethod): Promise<Mapped> {
  const response = mapResult(result, method);
  const text = await response.text();
  const json = (text === '' ? undefined : (JSON.parse(text) as unknown)) as Mapped['json'];
  return { status: response.status, json, response };
}

function expectError(mapped: Mapped, status: number, code: string, message: string, details: unknown[] = []): void {
  expect(mapped.status).toBe(status);
  expect(mapped.json).toEqual({ error: { code, message, details } });
  expect(mapped.response.headers.get('Cache-Control')).toBe('no-store');
}

describe('mapResult: éxito', () => {
  it('RF-F20: GET 200 con arreglo se re-serializa con las cinco claves', async () => {
    const { id, title, description, completed, createdAt } = TASK;
    const extraOrder = { createdAt, completed, description, title, id };
    const mapped = await map({ kind: 'ok', body: [extraOrder] }, 'GET');
    expect(mapped.status).toBe(200);
    expect(mapped.json).toEqual([TASK]);
    expect(mapped.response.headers.get('Cache-Control')).toBe('no-store');
    expect(mapped.response.headers.get('Content-Type')).toContain('application/json');
    expect((await map({ kind: 'ok', body: [] }, 'GET')).json).toEqual([]);
  });

  it('RF-F20: POST 201 con una tarea y PUT 200 con una tarea', async () => {
    const created = await map({ kind: 'ok', body: TASK }, 'POST');
    expect([created.status, created.json]).toEqual([201, TASK]);
    const updated = await map({ kind: 'ok', body: TASK }, 'PUT');
    expect([updated.status, updated.json]).toEqual([200, TASK]);
  });

  it('RF-F20: DELETE 204 sin cuerpo', async () => {
    const mapped = await map({ kind: 'ok', body: undefined }, 'DELETE');
    expect(mapped.status).toBe(204);
    expect(mapped.json).toBeUndefined();
    expect(mapped.response.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each([
    ['GET con un objeto', 'GET', { kind: 'ok', body: TASK }],
    ['GET con un elemento inválido', 'GET', { kind: 'ok', body: [TASK, { ...TASK, id: 'x' }] }],
    ['POST con un arreglo', 'POST', { kind: 'ok', body: [TASK] }],
    ['PUT con seis claves', 'PUT', { kind: 'ok', body: { ...TASK, extra: 1 } }],
    ['POST con fecha imposible', 'POST', { kind: 'ok', body: { ...TASK, createdAt: '2026-02-31T00:00:00Z' } }],
    ['DELETE con cuerpo', 'DELETE', { kind: 'ok', body: {} }],
  ] as const)('RF-F20: 2xx con forma inesperada (%s) es 502', async (_name, method, result) => {
    const message = method === 'POST' ? POST_UNSURE : UNAVAILABLE;
    expectError(await map(result, method), 502, 'BAD_GATEWAY', message);
  });
});

describe('mapResult: 400 de validación', () => {
  const body = (details: unknown): unknown => ({ error: { code: 'VALIDATION_ERROR', message: 'x', details } });

  it('RF-F20: 400 conserva field y message de la lista cerrada, con el mensaje general «Datos inválidos.»', async () => {
    const details = [
      { field: 'body', message: 'El cuerpo contiene campos no permitidos.' },
      { field: 'title', message: 'Debe tener entre 1 y 100 caracteres.' },
      { field: 'description', message: 'Debe tener como máximo 500 caracteres.' },
      { field: 'completed', message: 'Debe ser true o false.' },
    ];
    for (const method of ['POST', 'PUT'] as const) {
      expectError(
        await map({ kind: 'validation', body: body(details) }, method),
        400,
        'VALIDATION_ERROR',
        'Datos inválidos.',
        details,
      );
    }
  });

  it('RF-F20: un field ajeno se descarta y un mensaje desconocido pasa a «Valor no válido.»', async () => {
    const mapped = await map(
      {
        kind: 'validation',
        body: body([
          { field: 'password', message: 'Debe tener entre 1 y 100 caracteres.' },
          { field: 'title', message: 'SELECT * FROM tasks' },
          { field: 'description', message: 'Debe tener entre 1 y 100 caracteres.' },
          { field: 'id', message: 'El identificador no es un UUID válido.' },
          { field: 'query', message: 'Parámetros de consulta no permitidos.' },
          { field: 'completed', message: 5 },
          'texto',
          null,
        ]),
      },
      'POST',
    );
    expect(mapped.json.error.details).toEqual([
      { field: 'title', message: 'Valor no válido.' },
      { field: 'description', message: 'Valor no válido.' },
      { field: 'id', message: 'El identificador no es un UUID válido.' },
      { field: 'query', message: 'Parámetros de consulta no permitidos.' },
      { field: 'completed', message: 'Valor no válido.' },
    ]);
  });

  it.each([
    ['sin entradas válidas', body([{ field: 'x', message: 'y' }])],
    ['con details vacío', body([])],
    ['con details que no es arreglo', body('x')],
    ['sin details', { error: { code: 'VALIDATION_ERROR' } }],
    [
      'con otro code',
      { error: { code: 'OTHER', details: [{ field: 'title', message: 'Debe ser una cadena de texto.' }] } },
    ],
    ['sin error', { details: [] }],
    ['null', null],
    ['arreglo', []],
  ])('RF-F20: 400 %s es 502', async (_name, content) => {
    expectError(await map({ kind: 'validation', body: content }, 'POST'), 502, 'BAD_GATEWAY', POST_UNSURE);
    expectError(await map({ kind: 'validation', body: content }, 'PUT'), 502, 'BAD_GATEWAY', UNAVAILABLE);
  });

  it('RF-F20: 400 en GET o DELETE es 502', async () => {
    expectError(await map({ kind: 'unexpected', status: 400 }, 'GET'), 502, 'BAD_GATEWAY', UNAVAILABLE);
    expectError(await map({ kind: 'unexpected', status: 400 }, 'DELETE'), 502, 'BAD_GATEWAY', UNAVAILABLE);
  });
});

describe('mapResult: otros errores de Express', () => {
  it('RF-F20: 404 en PUT y DELETE es 404 «La tarea ya no existe.»', async () => {
    for (const method of ['PUT', 'DELETE'] as const) {
      expectError(await map({ kind: 'not_found' }, method), 404, 'NOT_FOUND', 'La tarea ya no existe.');
    }
  });

  it('RF-F20: 404 en GET y POST es 502', async () => {
    expectError(await map({ kind: 'unexpected', status: 404 }, 'GET'), 502, 'BAD_GATEWAY', UNAVAILABLE);
    expectError(await map({ kind: 'unexpected', status: 404 }, 'POST'), 502, 'BAD_GATEWAY', POST_UNSURE);
  });

  it('RF-F20: 413 en POST y PUT es 413', async () => {
    for (const method of ['POST', 'PUT'] as const) {
      expectError(await map({ kind: 'too_large' }, method), 413, 'PAYLOAD_TOO_LARGE', 'El texto es demasiado largo.');
    }
  });

  it('RF-F20: 413 en GET y DELETE es 502', async () => {
    expectError(await map({ kind: 'unexpected', status: 413 }, 'GET'), 502, 'BAD_GATEWAY', UNAVAILABLE);
    expectError(await map({ kind: 'unexpected', status: 413 }, 'DELETE'), 502, 'BAD_GATEWAY', UNAVAILABLE);
  });

  it('RF-F20: 429 con Retry-After válido lleva la cabecera y el tiempo de espera', async () => {
    const mapped = await map({ kind: 'rate_limited', retryAfter: '7' }, 'GET');
    expectError(mapped, 429, 'TOO_MANY_REQUESTS', 'Demasiadas peticiones. Espera 7 segundos e inténtalo de nuevo.');
    expect(mapped.response.headers.get('Retry-After')).toBe('7');
    const minutes = await map({ kind: 'rate_limited', retryAfter: '120' }, 'DELETE');
    expect(minutes.json.error.message).toBe('Demasiadas peticiones. Espera 2 minutos e inténtalo de nuevo.');
  });

  it('RF-F20: 429 sin Retry-After válido usa la frase de reserva y no lleva la cabecera', async () => {
    for (const retryAfter of [null, 'abc', '3601', '']) {
      const mapped = await map({ kind: 'rate_limited', retryAfter }, 'PUT');
      expectError(mapped, 429, 'TOO_MANY_REQUESTS', 'Demasiadas peticiones. Inténtalo de nuevo en unos instantes.');
      expect(mapped.response.headers.has('Retry-After')).toBe(false);
    }
  });

  it.each([401, 405, 415, 500, 503, 302, 301, 418])('RF-F20: el estado %i de Express es 502', async (status) => {
    expectError(await map({ kind: 'unexpected', status }, 'GET'), 502, 'BAD_GATEWAY', UNAVAILABLE);
    expectError(await map({ kind: 'unexpected', status }, 'PUT'), 502, 'BAD_GATEWAY', UNAVAILABLE);
  });

  it('RF-F20: respuesta no válida (JSON roto, tope superado) es 502', async () => {
    expectError(await map({ kind: 'invalid' }, 'GET'), 502, 'BAD_GATEWAY', UNAVAILABLE);
    expectError(await map({ kind: 'invalid' }, 'DELETE'), 502, 'BAD_GATEWAY', UNAVAILABLE);
  });
});

describe('mapResult: sin respuesta', () => {
  it('RF-F20: plazo agotado es 504 y el resto de fallos 502, con el mensaje de conexión', async () => {
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      expectError(await map({ kind: 'timeout' }, method), 504, 'GATEWAY_TIMEOUT', NO_CONNECT);
      expectError(await map({ kind: 'unreachable', error: new Error('x') }, method), 502, 'BAD_GATEWAY', NO_CONNECT);
    }
  });

  it('RF-F20: la cancelación del navegador es 502 sin datos', async () => {
    expectError(await map({ kind: 'cancelled' }, 'GET'), 502, 'BAD_GATEWAY', UNAVAILABLE);
  });

  it('RF-F20: para POST, 502 y 504 llevan el mensaje «No se pudo confirmar si la tarea se creó…»', async () => {
    expectError(await map({ kind: 'timeout' }, 'POST'), 504, 'GATEWAY_TIMEOUT', POST_UNSURE);
    expectError(await map({ kind: 'unreachable', error: 1 }, 'POST'), 502, 'BAD_GATEWAY', POST_UNSURE);
    expectError(await map({ kind: 'unexpected', status: 500 }, 'POST'), 502, 'BAD_GATEWAY', POST_UNSURE);
    expectError(await map({ kind: 'cancelled' }, 'POST'), 502, 'BAD_GATEWAY', POST_UNSURE);
  });
});

describe('mapResult: secretos', () => {
  const KEY = 'sentinel-api-key-0123456789abcdefghijklmnopqrstuvwxyz';
  const leaky = `${KEY} http://sentinel-backend.internal:9 SELECT * FROM tasks at Object.<anonymous> (/app/x.js:1:1)`;
  const validation = (field: string, message: string): BackendResult => ({
    kind: 'validation',
    body: { error: { code: 'VALIDATION_ERROR', details: [{ field, message }] } },
  });

  it('RF-F21: ninguna respuesta ni cabecera contiene la key ni la URL aunque Express las repita', async () => {
    const results: [BackendResult, BackendMethod][] = [
      [{ kind: 'unexpected', status: 500 }, 'GET'],
      [{ kind: 'unreachable', error: new Error(leaky) }, 'POST'],
      [validation('title', leaky), 'POST'],
      [validation(leaky, leaky), 'PUT'],
      [{ kind: 'rate_limited', retryAfter: leaky }, 'GET'],
      [{ kind: 'ok', body: { ...TASK, extra: leaky } }, 'POST'],
      [{ kind: 'ok', body: [{ ...TASK, title: 'ok' }] }, 'GET'],
      [{ kind: 'invalid' }, 'PUT'],
      [{ kind: 'timeout' }, 'DELETE'],
    ];
    for (const [result, method] of results) {
      const response = mapResult(result, method);
      const dump = `${await response.text()} ${JSON.stringify([...response.headers])}`;
      expect(dump).not.toContain(KEY);
      expect(dump).not.toContain('sentinel-backend');
      expect(dump).not.toContain('SELECT');
      expect(dump).not.toContain('Object.<anonymous>');
    }
  });
});
