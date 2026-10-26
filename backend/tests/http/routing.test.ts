import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { registerRoute } from '../../src/http/route-table';
import { createTestApp } from '../helpers/test-app';

const JSON_UTF8 = 'application/json; charset=utf-8';
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Recurso no encontrado.', details: [] } };

function build(): Express {
  return createTestApp({
    registerRoutes: (target) => {
      registerRoute(target, '/boom', {
        GET: () => {
          throw new Error('boom');
        },
      });
    },
  }).app;
}

describe('RF-S9: rutas estrictas', () => {
  it.each(['/Health', '/health/', '/health%ZZ', '/nada'])(
    'RF-S9: GET %s responde 404 NOT_FOUND en JSON',
    async (path) => {
      const res = await request(build()).get(path);

      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toBe(JSON_UTF8);
      expect(res.body).toEqual(NOT_FOUND);
    },
  );

  it('RF-S9: POST /nada responde 404 NOT_FOUND', async () => {
    const res = await request(build()).post('/nada').send({ a: 1 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });
});

describe('RF-S8: cabeceras de 404, 405 y 500', () => {
  it('RF-S8: 404 y 405 son JSON con charset utf-8', async () => {
    const app = build();

    expect((await request(app).get('/nada')).headers['content-type']).toBe(JSON_UTF8);
    expect((await request(app).post('/health')).headers['content-type']).toBe(JSON_UTF8);
  });

  it('RF-S8: X-Powered-By ausente en 200, 404, 405 y 500', async () => {
    const app = build();

    for (const res of [
      await request(app).get('/health'),
      await request(app).get('/nada'),
      await request(app).post('/health'),
      await request(app).get('/boom'),
    ]) {
      expect(res.headers['x-powered-by']).toBeUndefined();
    }
  });
});
