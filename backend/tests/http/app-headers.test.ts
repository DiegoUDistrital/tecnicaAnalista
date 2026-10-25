import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { createCaptureLogger } from '../helpers/capture-logger';
import { listenOnLoopback } from '../helpers/loopback';

describe('RF-S8: cabeceras de la respuesta 200', () => {
  it('RF-S8: la respuesta 200 es JSON con charset utf-8 y no lleva X-Powered-By', async () => {
    const app = createApp({
      logger: createCaptureLogger().logger,
      registerRoutes: (target) => {
        target.get('/ok', (_req, res) => {
          res.json({ ok: true });
        });
      },
    });

    const res = await request(app).get('/ok');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['etag']).toBeUndefined();
  });

  it('RF-S8: control: un express() sin configurar sí envía X-Powered-By', async () => {
    const app = express();
    app.get('/ok', (_req, res) => {
      res.json({ ok: true });
    });
    const loopback = await listenOnLoopback(app);
    try {
      const res = await fetch(`http://127.0.0.1:${loopback.port}/ok`);
      expect(res.headers.get('x-powered-by')).toBe('Express');
    } finally {
      await loopback.close();
    }
  });
});
