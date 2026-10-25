import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApiApp, type ApiApp } from '../helpers/api-app';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { rawRequest, type RawResponse } from '../helpers/raw-http';

const ID_DETAIL = { field: 'id', message: 'El identificador no es un UUID válido.' };

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

/** Petición cruda con `Connection: close`: la ruta llega tal cual, sin normalizar. */
async function call(method: string, path: string, body = ''): Promise<RawResponse> {
  const headers = ['Host: localhost', 'Connection: close'];
  if (body !== '') {
    headers.push('Content-Type: application/json', `Content-Length: ${Buffer.byteLength(body)}`);
  }
  const result = await rawRequest(loopback.port, [
    `${method} ${path} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n${body}`,
  ]);
  const response = result.responses[0];
  if (response === undefined) {
    throw new Error(`Sin respuesta: ${result.text}`);
  }
  return response;
}

describe('RF-C6 / RF-C22: la ruta de identificador no deja que Express decodifique el segmento', () => {
  it('RF-C22: GET /api/tasks/%E0%A4%A (porcentaje roto) da 405, no 500', async () => {
    const response = await call('GET', '/api/tasks/%E0%A4%A');

    expect(response.status).toBe(405);
  });

  it('RF-C22: /api/tasks/%E0%A4%A/x (ruta anidada) da 404', async () => {
    expect((await call('GET', '/api/tasks/%E0%A4%A/x')).status).toBe(404);
  });

  it('RF-C22: /api/otra/%E0%A4%A (otra ruta) da 404', async () => {
    expect((await call('GET', '/api/otra/%E0%A4%A')).status).toBe(404);
  });

  it('RF-C6: PUT /api/tasks/%E0%A4%A da 400 con SOLO la entrada id', async () => {
    const response = await call('PUT', '/api/tasks/%E0%A4%A', '{"completed":true}');

    expect(response.status).toBe(400);
    expect((JSON.parse(response.body) as { error: { details: unknown } }).error.details).toEqual([ID_DETAIL]);
  });
});
