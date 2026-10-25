import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApiApp, type ApiApp } from '../helpers/api-app';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { rawRequest, type RawResponse } from '../helpers/raw-http';

const UUID = '3f1c2d5e-8a0b-4c7d-9e1f-0a2b3c4d5e6f';
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

describe('RF-C22: contrato definitivo de métodos y rutas de /api/tasks/<uuid>', () => {
  it.each(['GET', 'POST', 'PATCH', 'OPTIONS', 'PROPFIND'])(
    'RF-C22: %s en /api/tasks/<uuid> da 405 con Allow: PUT, DELETE',
    async (method) => {
      const response = await call(method, `/api/tasks/${UUID}`);

      expect(response.status).toBe(405);
      expect(response.headers['allow']).toBe('PUT, DELETE');
      expect(JSON.parse(response.body)).toEqual({
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido.', details: [] },
      });
    },
  );

  it('RF-C22: HEAD en /api/tasks/<uuid> da 405 con Allow: PUT, DELETE (solo estado y cabecera)', async () => {
    const response = await request(api.app).head(`/api/tasks/${UUID}`);

    expect(response.status).toBe(405);
    expect(response.headers['allow']).toBe('PUT, DELETE');
    expect(response.text ?? '').toBe('');
  });

  it.each([`/api/tasks/${UUID}/`, `/api/tasks/${UUID}/x`])('RF-C22: %s da 404', async (path) => {
    const response = await call('GET', path);

    expect(response.status).toBe(404);
    expect(response.headers['allow']).toBeUndefined();
  });
});

describe('RF-C6: cruce con las rutas estrictas de la 002 (RF-S9)', () => {
  it('RF-C6: /api/%74asks/<uuid> da 404 (la ruta literal no coincide)', async () => {
    expect((await call('GET', `/api/%74asks/${UUID}`)).status).toBe(404);
    expect((await call('PUT', `/api/%74asks/${UUID}`, '{"completed":true}')).status).toBe(404);
  });

  it('RF-C6: /api/Tasks/<uuid> (mayúsculas) y /api/tasks//<uuid> (barra doble) dan 404', async () => {
    expect((await call('GET', `/api/Tasks/${UUID}`)).status).toBe(404);
    expect((await call('GET', `/api/tasks//${UUID}`)).status).toBe(404);
  });

  it('RF-C6: /api/otra/%E0%A4%A y /api/tasks/%E0%A4%A/x dan 404 también con PUT', async () => {
    expect((await call('PUT', '/api/otra/%E0%A4%A', '{"completed":true}')).status).toBe(404);
    expect((await call('PUT', '/api/tasks/%E0%A4%A/x', '{"completed":true}')).status).toBe(404);
  });
});

describe('RF-C1: el método se evalúa antes que el identificador', () => {
  it('RF-C1: GET /api/tasks/%E0%A4%A da 405 con Allow: PUT, DELETE (no 400 ni 500)', async () => {
    const response = await call('GET', '/api/tasks/%E0%A4%A');

    expect(response.status).toBe(405);
    expect(response.headers['allow']).toBe('PUT, DELETE');
  });

  it('RF-C1: POST con id inválido y cuerpo roto da 405 (el método gana al cuerpo y al id)', async () => {
    const response = await call('POST', '/api/tasks/no-es-uuid', '{roto');

    expect(response.status).toBe(405);
    expect(response.headers['allow']).toBe('PUT, DELETE');
  });
});

describe('RF-C6: el identificador nunca se refleja ni en la respuesta ni en el log', () => {
  const SENTINEL = 'SENTINELA-ID-ZZ9';

  it.each([
    ['GET', 405, ''],
    ['PUT', 400, '{"completed":true}'],
    ['DELETE', 400, ''],
  ])('RF-C6: %s con id centinela inválido (%i) no lo refleja ni lo registra', async (method, status, body) => {
    const before = api.capture.lines.length;

    const response = await call(method, `/api/tasks/${SENTINEL}`, body);

    expect(response.status).toBe(status);
    expect(response.body).not.toContain(SENTINEL);
    expect(JSON.stringify(response.headers)).not.toContain(SENTINEL);
    expect(api.capture.output()).not.toContain(SENTINEL);
    expect(api.capture.lines.slice(before)).toEqual([]);
  });

  it('RF-C6: un 404 de ruta anidada con el centinela tampoco lo refleja ni lo registra', async () => {
    const response = await call('GET', `/api/tasks/${SENTINEL}/x`);

    expect(response.status).toBe(404);
    expect(response.body).not.toContain(SENTINEL);
    expect(api.capture.output()).not.toContain(SENTINEL);
  });
});
