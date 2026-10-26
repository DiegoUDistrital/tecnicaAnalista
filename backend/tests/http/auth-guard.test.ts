import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Database } from '../../src/db/pool';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { rawRequest, type RawResult } from '../helpers/raw-http';
import { OMIT_KEY_HEADER, TEST_API_KEY } from '../helpers/security';
import { createTestApp } from '../helpers/test-app';

const JSON_UTF8 = 'application/json; charset=utf-8';
const UNAUTHORIZED = { error: { code: 'UNAUTHORIZED', message: 'No autorizado.', details: [] } };
const UUID = '123e4567-e89b-42d3-a456-426614174000';

/** Sin key: el marcador pide a `withTestKey` que no inyecte nada. Con key: la cabecera correcta, escrita a mano. */
const NO_KEY = `${OMIT_KEY_HEADER}: 1`;
const VALID_KEY = `Authorization: Bearer ${TEST_API_KEY}`;
const WRONG_KEY = `Authorization: Bearer ${'x'.repeat(10)}${TEST_API_KEY.slice(10)}`;

/** Petición cruda con control total de la línea de petición y las cabeceras. */
function raw(
  port: number,
  line: string,
  headers: readonly string[],
  body: string | Buffer = '',
  options: Parameters<typeof rawRequest>[2] = {},
): Promise<RawResult> {
  const lines = headers.map((header) => `${header}\r\n`).join('');
  const head = `${line} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n${lines}\r\n`;
  return rawRequest(port, [head, body], options);
}

/** Estado leído de la línea de estado (sirve también para HEAD, cuya respuesta no trae cuerpo). */
function statusOf(result: RawResult): number | undefined {
  const match = /^HTTP\/1\.1 (\d{3})/.exec(result.text);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

describe('guarda de API key', () => {
  let loopback: LoopbackServer;
  let queries = 0;
  const database: Database = {
    query: () => {
      queries += 1;
      return Promise.reject(new Error('base de datos apagada'));
    },
    close: () => Promise.resolve(),
  };

  beforeAll(async () => {
    const { app } = createTestApp({
      database,
      registerRoutes: (target) => {
        target.get('/extra', (_req, res) => {
          res.json({ extra: true });
        });
      },
    });
    loopback = await listenOnLoopback(app);
  });

  afterAll(async () => {
    await loopback.close();
  });

  const send = (line: string, headers: readonly string[], body: string | Buffer = ''): Promise<RawResult> =>
    raw(loopback.port, line, headers, body);

  // [método, destino, estado con key]; el estado con key es el que daban la 002 a la 004 (la BD falla: 500).
  const PROTECTED: readonly [string, string, number][] = [
    ['GET', '/api/tasks', 500],
    ['POST', '/api/tasks', 400],
    ['PUT', `/api/tasks/${UUID}`, 400],
    ['DELETE', `/api/tasks/${UUID}`, 500],
    ['PATCH', '/api/tasks', 405],
    ['HEAD', '/api/tasks', 405],
    ['OPTIONS', '/api/tasks', 405],
    ['GET', '/api', 404],
    ['GET', '/api/', 404],
    ['GET', '/api/nada', 404],
    ['GET', '/nada', 404],
    ['GET', '/Health', 404],
    ['GET', '/health/', 404],
    ['GET', '/health%ZZ', 404],
    ['GET', '/health;x', 404],
    ['GET', '//health', 404],
    ['GET', '/%68ealth', 404],
    ['GET', '/API/tasks', 404],
    ['GET', '//api/tasks', 404],
    ['GET', '/%61pi/tasks', 404],
    ['GET', '/api/%74asks', 404],
    ['GET', `/api/tasks/${UUID}/`, 404],
    ['GET', 'http://localhost/api/tasks', 500],
    ['GET', '/extra', 200],
  ];

  describe('RF-G2: denegar por defecto', () => {
    it.each(PROTECTED)('RF-G2: %s %s sin key da 401 y con key da lo de siempre', async (method, target, status) => {
      const length = method === 'POST' || method === 'PUT' ? ['Content-Length: 0'] : [];

      const without = await send(`${method} ${target}`, [NO_KEY, ...length]);
      const withKey = await send(`${method} ${target}`, [VALID_KEY, ...length]);

      expect(statusOf(without)).toBe(401);
      expect(statusOf(withKey)).toBe(status);
    });

    it.each(['/health', '/health?x=1', 'http://localhost/health'])(
      'RF-G2: GET %s da 200 sin key y con key errónea',
      async (target) => {
        expect(statusOf(await send(`GET ${target}`, [NO_KEY]))).toBe(200);
        expect(statusOf(await send(`GET ${target}`, [WRONG_KEY]))).toBe(200);
      },
    );

    it('RF-G2: HEAD /health sin key da 405 con Allow: GET (es la tabla de /health, no la guarda)', async () => {
      const result = await send('HEAD /health', [NO_KEY]);

      expect(statusOf(result)).toBe(405);
      expect(result.text).toMatch(/\r\nAllow: GET\r\n/i);
    });

    it('RF-G2: una ruta extra registrada por registerRoutes queda protegida y /health es la única exenta', async () => {
      const app = createTestApp({
        registerRoutes: (target) => {
          target.get('/otra', (_req, res) => {
            res.json({ otra: true });
          });
        },
      }).app;

      expect((await request(app).get('/otra').set(OMIT_KEY_HEADER, '1')).status).toBe(401);
      expect((await request(app).get('/otra')).status).toBe(200);
      expect((await request(app).get('/health').set(OMIT_KEY_HEADER, '1')).status).toBe(200);
    });
  });

  describe('RF-G3: formato de la cabecera', () => {
    const key = TEST_API_KEY;
    const REJECTED: readonly [string, readonly string[]][] = [
      ['Basic', [`Authorization: Basic ${key}`]],
      ['Token', [`Authorization: Token ${key}`]],
      ['solo el esquema', ['Authorization: Bearer']],
      ['repetida e idéntica', [VALID_KEY, VALID_KEY]],
      ['repetida, válida y errónea', [VALID_KEY, WRONG_KEY]],
      ['repetida, errónea y válida', [WRONG_KEY, VALID_KEY]],
      ['repetida con otra mayúscula del nombre', [VALID_KEY, `authorization: Bearer ${key}`]],
      ['Proxy-Authorization', [NO_KEY, `Proxy-Authorization: Bearer ${key}`]],
      ['key en una cookie', [NO_KEY, `Cookie: api_key=${key}`]],
    ];

    it.each(REJECTED)('RF-G3: %s da 401', async (_name, headers) => {
      expect(statusOf(await send('GET /nada', headers))).toBe(401);
    });

    it('RF-G3: la key en ?access_token= o ?api_key= no sirve sin la cabecera', async () => {
      for (const query of [`access_token=${key}`, `api_key=${key}`]) {
        expect(statusOf(await send(`GET /api/tasks?${query}`, [NO_KEY]))).toBe(401);
      }
    });

    it('RF-G3: ?api_key= con la cabecera válida llega a la validación de la consulta (400)', async () => {
      expect(statusOf(await send(`GET /api/tasks?api_key=${key}`, [VALID_KEY]))).toBe(400);
    });

    it('RF-G3: la key válida con Proxy-Authorization además pasa; la Proxy-Authorization se ignora', async () => {
      expect(statusOf(await send('GET /nada', [VALID_KEY, 'Proxy-Authorization: Basic abc']))).toBe(404);
    });

    it('RF-G3: socket crudo con espacio final (Bearer <key> ) da 404 (pasa) y Bearer vacío da 401', async () => {
      expect(statusOf(await send('GET /nada', [`Authorization: Bearer ${key} `]))).toBe(404);
      expect(statusOf(await send('GET /nada', ['Authorization: Bearer ']))).toBe(401);
    });
  });

  describe('RF-G5: la respuesta 401', () => {
    it('RF-G5: cuerpo exacto, WWW-Authenticate: Bearer sin realm, JSON con charset y sin X-Powered-By', async () => {
      const res = await request(createTestApp().app).get('/api/tasks').set(OMIT_KEY_HEADER, '1');

      expect(res.status).toBe(401);
      expect(res.body).toEqual(UNAUTHORIZED);
      expect(res.headers['www-authenticate']).toBe('Bearer');
      expect(res.headers['content-type']).toBe(JSON_UTF8);
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('RF-G5: el cuerpo es idéntico para todas las causas y la key candidata no aparece en la respuesta', async () => {
      const candidate = 'Zz9-candidate_KEY_0123456789-abcdefghijklmnopqrs';
      const causes = [
        [NO_KEY],
        ['Authorization: Basic abc'],
        ['Authorization: Bearer'],
        [VALID_KEY, VALID_KEY],
        [`Authorization: Bearer ${candidate}`],
      ];

      for (const headers of causes) {
        const result = await send('GET /api/tasks', headers);

        expect(result.responses[0]?.status).toBe(401);
        expect(result.responses[0]?.body).toBe(JSON.stringify(UNAUTHORIZED));
        expect(result.text).not.toContain(candidate);
        expect(result.text).not.toContain(TEST_API_KEY);
      }
    });

    it('RF-G5: sin body no cierra la conexión', async () => {
      const result = await rawRequest(
        loopback.port,
        [`GET /api/tasks HTTP/1.1\r\nHost: localhost\r\n${NO_KEY}\r\n\r\n`],
        { until: (text) => text.includes('\r\n\r\n') && text.includes('"details":[]') },
      );

      expect(result.responses[0]?.status).toBe(401);
      expect(result.responses[0]?.headers['connection']).not.toBe('close');
      expect(result.closedByServer).toBe(false);
    });

    it('RF-G5: con body presente responde 401 con Connection: close y cierra', async () => {
      const result = await send(
        'POST /api/tasks',
        [NO_KEY, 'Content-Type: application/json', 'Content-Length: 2'],
        '{}',
      );

      expect(result.responses[0]?.status).toBe(401);
      expect(result.responses[0]?.headers['connection']).toBe('close');
      expect(result.closedByServer).toBe(true);
    });

    it('RF-G5: 20 KB sin key por socket crudo da 401 y cierra (no 413)', async () => {
      const body = 'a'.repeat(20 * 1024);

      const result = await send(
        'POST /api/tasks',
        [NO_KEY, 'Content-Type: application/json', `Content-Length: ${String(body.length)}`],
        body,
      );

      expect(statusOf(result)).toBe(401);
      expect(result.closedByServer).toBe(true);
    });

    it('RF-G5: Expect: 100-continue con body y sin key da 401 con la conexión cerrada', async () => {
      const result = await send(
        'POST /api/tasks',
        [NO_KEY, 'Content-Type: application/json', 'Content-Length: 2', 'Expect: 100-continue'],
        '{}',
      );

      expect(result.responses.at(-1)?.status).toBe(401);
      expect(result.responses.at(-1)?.headers['connection']).toBe('close');
      expect(result.closedByServer).toBe(true);
    });
  });

  describe('RF-G1: pares de orden con la guarda', () => {
    it('RF-G1: /api/nada y PATCH /api/tasks sin key dan 401; con key, 404 y 405', async () => {
      expect(statusOf(await send('GET /api/nada', [NO_KEY]))).toBe(401);
      expect(statusOf(await send('GET /api/nada', [VALID_KEY]))).toBe(404);
      expect(statusOf(await send('PATCH /api/tasks', [NO_KEY]))).toBe(401);
      expect(statusOf(await send('PATCH /api/tasks', [VALID_KEY]))).toBe(405);
    });

    it('RF-G1: 20 KB sin key da 401; con key y text/plain, 413', async () => {
      const body = 'a'.repeat(20 * 1024);
      const headers = ['Content-Type: text/plain', `Content-Length: ${String(body.length)}`];

      expect(statusOf(await send('POST /api/tasks', [NO_KEY, ...headers], body))).toBe(401);
      expect(statusOf(await send('POST /api/tasks', [VALID_KEY, ...headers], body))).toBe(413);
    });

    it('RF-G1: text/plain sin key da 401; con key, 415', async () => {
      const headers = ['Content-Type: text/plain', 'Content-Length: 2'];

      expect(statusOf(await send('POST /api/tasks', [NO_KEY, ...headers], '{}'))).toBe(401);
      expect(statusOf(await send('POST /api/tasks', [VALID_KEY, ...headers], '{}'))).toBe(415);
    });

    it('RF-G1: JSON roto sin key da 401; con key, 400', async () => {
      const headers = ['Content-Type: application/json', 'Content-Length: 1'];

      expect(statusOf(await send('POST /api/tasks', [NO_KEY, ...headers], '{'))).toBe(401);
      expect(statusOf(await send('POST /api/tasks', [VALID_KEY, ...headers], '{'))).toBe(400);
    });

    it('RF-G1: con la BD apagada, sin key da 401 y no la consulta; con key, 500', async () => {
      const before = queries;

      expect(statusOf(await send('GET /api/tasks', [NO_KEY]))).toBe(401);
      expect(statusOf(await send(`DELETE /api/tasks/${UUID}`, [NO_KEY]))).toBe(401);
      expect(queries).toBe(before);
      expect(statusOf(await send('GET /api/tasks', [VALID_KEY]))).toBe(500);
      expect(queries).toBe(before + 1);
    });
  });
});
