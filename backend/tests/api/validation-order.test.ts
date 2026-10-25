import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCaptureLogger } from '../helpers/capture-logger';
import { createClosedPortDatabase, startApiApp, type ApiApp } from '../helpers/api-app';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { rawRequest, type RawResponse } from '../helpers/raw-http';

const TWENTY_KB = 'x'.repeat(20 * 1024);

let api: ApiApp;
let loopback: LoopbackServer;

beforeAll(async () => {
  api = await startApiApp();
  loopback = await listenOnLoopback(api.app);
});

afterAll(async () => {
  await loopback.close();
  await api.close();
});

/** Petición cruda con `Connection: close`: espera al cierre y devuelve la primera respuesta. */
async function call(
  method: string,
  path: string,
  headers: readonly string[],
  body: string | Buffer,
): Promise<RawResponse> {
  const length = body.length === 0 ? [] : [`Content-Length: ${body.length}`];
  const head = [`${method} ${path} HTTP/1.1`, 'Host: localhost', 'Connection: close', ...headers, ...length];
  const result = await rawRequest(loopback.port, [`${head.join('\r\n')}\r\n\r\n`, body]);
  const response = result.responses[0];
  if (response === undefined) {
    throw new Error(`Sin respuesta: ${result.text}`);
  }
  return response;
}

function detailsOf(response: RawResponse): unknown {
  return (JSON.parse(response.body) as { error: { details: unknown } }).error.details;
}

describe('RF-C1: orden de las etapas sobre la ruta real', () => {
  it('RF-C1 par 1-2: PATCH /api/tasks con 20 KB da 405 (no 413) y una ruta desconocida con 20 KB da 404', async () => {
    const json = ['Content-Type: application/json'];

    expect((await call('PATCH', '/api/tasks', json, TWENTY_KB)).status).toBe(405);
    expect((await call('GET', '/api/desconocida', json, TWENTY_KB)).status).toBe(404);
  });

  it('RF-C1 par 2-3: GET con 20 KB y text/plain da 413 (no 415)', async () => {
    const response = await call('GET', '/api/tasks', ['Content-Type: text/plain'], TWENTY_KB);

    expect(response.status).toBe(413);
  });

  it('RF-C1 par 3-4: GET con body FF FE sin Content-Type da 415 y con tipo JSON da 400 (mensaje de GET)', async () => {
    const bytes = Buffer.from([0xff, 0xfe]);

    const withoutType = await call('GET', '/api/tasks', [], bytes);
    const withJson = await call('GET', '/api/tasks', ['Content-Type: application/json'], bytes);

    expect(withoutType.status).toBe(415);
    expect(withJson.status).toBe(400);
    expect(detailsOf(withJson)).toEqual([{ field: 'body', message: 'Esta ruta no admite cuerpo.' }]);
  });

  it('RF-C1 par 3-4: POST con text/plain y JSON mal formado da 415', async () => {
    const response = await call('POST', '/api/tasks', ['Content-Type: text/plain'], '{"title":');

    expect(response.status).toBe(415);
  });

  it('RF-C1 par 4-6: POST /api/tasks?x=1 con JSON mal formado da 400 con SOLO body', async () => {
    const response = await call('POST', '/api/tasks?x=1', ['Content-Type: application/json'], '{"title":');

    expect(response.status).toBe(400);
    expect(detailsOf(response)).toEqual([{ field: 'body', message: 'El cuerpo debe ser un objeto JSON válido.' }]);
  });

  it('RF-C1 par 6-8: POST con campos inválidos y la BD apagada da 400, no 500', async () => {
    const capture = createCaptureLogger();
    const down = await startApiApp({ capture, database: await createClosedPortDatabase(capture.logger) });
    try {
      const res = await request(down.app).post('/api/tasks').send({ title: '' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      expect(capture.records()).toEqual([]);
    } finally {
      await down.close();
    }
  });

  it('RF-C1: la etapa 6 es la única que acumula: dan body, query y title, en ese orden', async () => {
    const response = await call('POST', '/api/tasks?x=1', ['Content-Type: application/json'], '{"foo":1,"title":5}');

    expect(response.status).toBe(400);
    expect(detailsOf(response)).toEqual([
      { field: 'body', message: 'El cuerpo contiene campos no permitidos.' },
      { field: 'query', message: 'Parámetros de consulta no permitidos.' },
      { field: 'title', message: 'Debe ser una cadena de texto.' },
    ]);
  });
});
