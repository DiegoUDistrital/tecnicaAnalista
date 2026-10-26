import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { rawRequest, type RawResponse } from '../helpers/raw-http';
import { OMIT_KEY_HEADER, TEST_CORS_ORIGIN, TEST_RATE_LIMIT, testSecurity } from '../helpers/security';
import { createTestApp } from '../helpers/test-app';

const ORIGIN = TEST_CORS_ORIGIN;
const UUID = '3f2b8c1e-5d4a-4b7e-9a10-2c6d8e0f1a23';
const WRONG = 'Bearer wrong-key-wrong-key-wrong-key-wrong-key-0000';

type App = ReturnType<typeof createTestApp>['app'];

const servers: LoopbackServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close();
  }
});

function newApp(rateLimit: Partial<typeof TEST_RATE_LIMIT> = {}): App {
  return createTestApp({
    security: testSecurity({ rateLimit: { ...TEST_RATE_LIMIT, ...rateLimit } }),
    registerRoutes: (app) => {
      app.get('/api/probe', (_req, res) => {
        res.json({ ok: true });
      });
      app.post('/api/post-probe', (_req, res) => {
        res.json({ ok: true });
      });
    },
  }).app;
}

/** App cuyo único manejador final devuelve el `req.path` con el que el enrutador vio la petición. */
function pathEchoApp(): App {
  return createTestApp({
    registerRoutes: (app) => {
      app.use((req, res) => {
        res.json({ path: req.path });
      });
    },
  }).app;
}

/** Preflight completo hacia `path`; `omitKey` lo manda sin `Authorization`. */
function preflight(app: App, path: string, omitKey = true): request.Test {
  const call = request(app)
    .options(path)
    .set('Origin', ORIGIN)
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'authorization, content-type');
  return omitKey ? call.set(OMIT_KEY_HEADER, '1') : call;
}

/** Petición con socket crudo: línea de petición y cabeceras tal cual; devuelve la primera respuesta. */
async function raw(app: App, requestLine: string, headerLines: string[], extra = ''): Promise<RawResponse> {
  const server = await listenOnLoopback(app);
  servers.push(server);
  const text = [requestLine, 'Host: localhost', ...headerLines, '', extra].join('\r\n');
  const result = await rawRequest(server.port, [text]);
  const [response] = result.responses;
  if (response === undefined) {
    throw new Error('Sin respuesta del servidor.');
  }
  return response;
}

describe('RF-G14: caracterización de req.path', () => {
  it.each([
    ['/api/nada?x=1', '/api/nada'],
    ['/api/tasks/', '/api/tasks/'],
    [`/api/tasks/${UUID}/`, `/api/tasks/${UUID}/`],
    ['//api/tasks', '//api/tasks'],
    ['/API/tasks', '/API/tasks'],
    ['/api/tasks%2F', '/api/tasks%2F'],
    ['/api/tasks/%E0%A4%A/x', '/api/tasks/%E0%A4%A/x'],
  ])('RF-G14: GET %s llega al enrutador con req.path %s (crudo y sin consulta)', async (target, expected) => {
    const response = await raw(pathEchoApp(), `GET ${target} HTTP/1.1`, ['Connection: close']);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ path: expected });
  });
});

describe('RF-G14: preflight válido', () => {
  it.each([
    ['/api/tasks', 'GET, POST'],
    ['/api/tasks?x=1', 'GET, POST'],
    ['/api/tasks?completed=true', 'GET, POST'],
    [`/api/tasks/${UUID}`, 'PUT, DELETE'],
    ['/api/tasks/%E0%A4%A', 'PUT, DELETE'],
  ])('RF-G14: preflight sin key a %s da 204 con los métodos %s y las cabeceras de CORS', async (path, methods) => {
    const response = await preflight(newApp(), path);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(response.headers['content-type']).toBeUndefined();
    expect(response.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(response.headers['access-control-allow-methods']).toBe(methods);
    expect(response.headers['access-control-allow-headers']).toBe('Authorization, Content-Type');
    expect(response.headers['access-control-max-age']).toBe('600');
    expect((response.headers['vary'] as string).split(',').map((value) => value.trim())).toContain('Origin');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('RF-G14: con key también da 204 (la key no es necesaria ni estorba)', async () => {
    expect((await preflight(newApp(), '/api/tasks', false)).status).toBe(204);
  });

  it.each(['PATCH', 'basura-xyz', 'GET, POST'])(
    'RF-G14: método pedido %j (no permitido o basura) da 204 con la lista real de la ruta',
    async (asked) => {
      const response = await preflight(newApp(), `/api/tasks/${UUID}`).set('Access-Control-Request-Method', asked);

      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-methods']).toBe('PUT, DELETE');
    },
  );
});

describe('RF-G14: no es preflight, sigue el flujo normal', () => {
  function withoutKey(path: string): request.Test {
    return request(newApp()).options(path).set(OMIT_KEY_HEADER, '1');
  }

  it.each([
    [
      'Access-Control-Request-Method vacío',
      async () => await preflight(newApp(), '/api/tasks').set('Access-Control-Request-Method', ''),
    ],
    ['sin Origin', async () => await withoutKey('/api/tasks').set('Access-Control-Request-Method', 'POST')],
    [
      'Origin repetido',
      async () =>
        await raw(newApp(), 'OPTIONS /api/tasks HTTP/1.1', [
          `Origin: ${ORIGIN}`,
          `Origin: ${ORIGIN}`,
          'Access-Control-Request-Method: GET',
          'Connection: close',
          `${OMIT_KEY_HEADER}: 1`,
        ]),
    ],
  ])('RF-G14: %s no es preflight (401 sin key)', async (_label, send) => {
    expect((await send()).status).toBe(401);
  });

  it('RF-G14: sin Access-Control-Request-Method: 401 sin key y 405 con Allow con key', async () => {
    const app = newApp();

    expect((await request(app).options('/api/tasks').set(OMIT_KEY_HEADER, '1').set('Origin', ORIGIN)).status).toBe(401);
    const keyed = await request(app).options('/api/tasks').set('Origin', ORIGIN);
    expect(keyed.status).toBe(405);
    expect(keyed.headers['allow']).toBe('GET, POST');
  });

  it('RF-G14: con origen no permitido no es preflight (401 sin key, 405 con key)', async () => {
    const app = newApp();
    const call = (): request.Test =>
      request(app)
        .options('/api/tasks')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'GET');

    expect((await call().set(OMIT_KEY_HEADER, '1')).status).toBe(401);
    const keyed = await call();
    expect(keyed.status).toBe(405);
    expect(keyed.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each([
    [`/api/tasks/${UUID}/`, 404],
    ['/API/tasks', 404],
    ['//api/tasks', 404],
    ['/api/tasks%2F', 404],
    ['/api/nada', 404],
    ['/api/tasks/', 404],
  ])('RF-G14: preflight a %s no lo es: 401 sin key y %i con key', async (path, status) => {
    const app = newApp();

    const anonymous = await preflight(app, path);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers['access-control-allow-methods']).toBeUndefined();
    const keyed = await preflight(app, path, false);
    expect(keyed.status).toBe(status);
    expect(keyed.headers['access-control-allow-methods']).toBeUndefined();
  });

  it('RF-G14: HEAD con Origin no es preflight (401 sin key, 405 con key)', async () => {
    const app = newApp();
    const call = (): request.Test =>
      request(app).head('/api/tasks').set('Origin', ORIGIN).set('Access-Control-Request-Method', 'GET');

    expect((await call().set(OMIT_KEY_HEADER, '1')).status).toBe(401);
    expect((await call()).status).toBe(405);
  });

  it('RF-G14: OPTIONS /health da 405 con Allow: GET aun sin key, nunca 204', async () => {
    const response = await preflight(newApp(), '/health');

    expect(response.status).toBe(405);
    expect(response.headers['allow']).toBe('GET');
  });
});

describe('RF-G1: el preflight va tras el cupo general y antes de la key', () => {
  it('RF-G14: con el cupo de fallos agotado el preflight da 204 (P2 antes de P3)', async () => {
    const app = newApp({ authFailuresMax: 1 });

    expect((await request(app).get('/api/probe').set('Authorization', WRONG)).status).toBe(401);
    expect((await request(app).get('/api/probe').set('Authorization', WRONG)).status).toBe(429);
    expect((await preflight(app, '/api/tasks')).status).toBe(204);
  });

  it('RF-G14: con el cupo general agotado el preflight da 429 (P1 antes de P2)', async () => {
    const app = newApp({ max: 2 });

    expect((await preflight(app, '/api/tasks')).status).toBe(204);
    expect((await preflight(app, '/api/tasks')).status).toBe(204);
    const limited = await preflight(app, '/api/tasks');
    expect(limited.status).toBe(429);
    expect(limited.headers['access-control-allow-methods']).toBeUndefined();
  });

  it('RF-G9: los preflights no se bloquean ni cuentan como fallo', async () => {
    const app = newApp({ authFailuresMax: 1 });

    for (let i = 0; i < 5; i += 1) {
      expect((await preflight(app, '/api/tasks')).status).toBe(204);
    }
    expect((await request(app).get('/api/probe').set('Authorization', WRONG)).status).toBe(401);
  });

  it('RF-G14: los preflights no consumen el cupo de POST', async () => {
    const app = newApp({ postMax: 1 });

    for (let i = 0; i < 3; i += 1) {
      expect((await preflight(app, '/api/tasks', false)).status).toBe(204);
    }
    expect((await request(app).post('/api/post-probe').send({})).status).toBe(200);
    expect((await request(app).post('/api/post-probe').send({})).status).toBe(429);
  });
});

describe('RF-G14: preflight con cuerpo', () => {
  const HEADERS = [`Origin: ${ORIGIN}`, 'Access-Control-Request-Method: POST', 'Connection: keep-alive'];

  it('RF-G14: con Content-Length > 0 da 204 con Connection: close (socket crudo)', async () => {
    const response = await raw(
      newApp(),
      'OPTIONS /api/tasks HTTP/1.1',
      [...HEADERS, `${OMIT_KEY_HEADER}: 1`, 'Content-Length: 5'],
      'hello',
    );

    expect(response.status).toBe(204);
    expect(response.headers['connection']).toBe('close');
  });

  it('RF-G14: con Transfer-Encoding da 204 con Connection: close (socket crudo)', async () => {
    const response = await raw(
      newApp(),
      'OPTIONS /api/tasks HTTP/1.1',
      [...HEADERS, `${OMIT_KEY_HEADER}: 1`, 'Transfer-Encoding: chunked'],
      '5\r\nhello\r\n0\r\n\r\n',
    );

    expect(response.status).toBe(204);
    expect(response.headers['connection']).toBe('close');
  });

  it('RF-G14: sin cuerpo no pide cerrar la conexión', async () => {
    const response = await raw(newApp(), 'OPTIONS /api/tasks HTTP/1.1', [...HEADERS, `${OMIT_KEY_HEADER}: 1`]);

    expect(response.status).toBe(204);
    expect(response.headers['connection']).not.toBe('close');
  });
});
