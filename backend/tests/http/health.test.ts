import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { guard } from '../../src/http/guard';
import { registerRoute } from '../../src/http/route-table';
import { createCaptureLogger } from '../helpers/capture-logger';
import { createTestApp } from '../helpers/test-app';

const JSON_UTF8 = 'application/json; charset=utf-8';

function build(): { app: Express; lines: string[] } {
  const capture = createCaptureLogger();
  return { app: createTestApp({ capture }).app, lines: capture.lines };
}

describe('RF-S12: GET /health', () => {
  it('RF-S12: GET /health responde 200 con exactamente {"status":"ok"}', async () => {
    const res = await request(build().app).get('/health');

    expect(res.status).toBe(200);
    expect(res.text).toBe('{"status":"ok"}');
    expect(res.headers['content-type']).toBe(JSON_UTF8);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['etag']).toBeUndefined();
  });

  it(
    'RF-S12: GET /health con body, con Content-Type text/plain, con Content-Encoding gzip, ' +
      'con Authorization y con query responde 200',
    async () => {
      const { app } = build();

      const withBody = await request(app).get('/health').send('{"x":1}');
      const plain = await request(app).get('/health').set('Content-Type', 'text/plain').send('hola');
      const gzip = await request(app).get('/health').set('Content-Encoding', 'gzip').send('no es gzip');
      const length = await request(app).get('/health').set('Content-Length', '0');
      const auth = await request(app).get('/health').set('Authorization', 'Bearer cualquiera');
      const query = await request(app).get('/health?x=1');

      for (const res of [withBody, plain, gzip, length, auth, query]) {
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ok' });
      }
    },
  );

  it.each(['*', '"abc"', 'W/"abc"'])('RF-S12: If-None-Match %s no produce 304', async (value) => {
    const res = await request(build().app).get('/health').set('If-None-Match', value);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it.each(['head', 'options', 'post', 'put', 'delete', 'patch', 'propfind'] as const)(
    'RF-S12: %s /health da 405 con Allow: GET (ver RF-S9)',
    async (method) => {
      const res = await request(build().app)[method]('/health');

      expect(res.status).toBe(405);
      expect(res.headers['allow']).toBe('GET');
      if (method !== 'head') {
        expect(res.body).toEqual({
          error: { code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido.', details: [] },
        });
      }
    },
  );

  it('RF-S11: GET /health (200) y GET /nada (404) no escriben ninguna línea en el log', async () => {
    const { app, lines } = build();

    await request(app).get('/health');
    await request(app).get('/nada');

    expect(lines).toEqual([]);
  });

  it('RF-S10: tras provocar errores 500, /nada sigue dando 404 y /health 200', async () => {
    const capture = createCaptureLogger();
    const { app } = createTestApp({
      capture,
      registerRoutes: (target) => {
        registerRoute(target, '/boom', {
          GET: () => {
            throw new Error('boom');
          },
        });
        target.get(
          '/undef',
          guard(() => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- el test necesita lanzar un no-Error
            throw undefined;
          }),
        );
      },
    });

    expect((await request(app).get('/boom')).status).toBe(500);
    expect((await request(app).get('/undef')).status).toBe(500);

    expect((await request(app).get('/nada')).status).toBe(404);
    expect((await request(app).get('/health')).status).toBe(200);
  });
});
