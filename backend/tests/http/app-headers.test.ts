import express from 'express';
import { describe, expect, it } from 'vitest';
import { listenOnLoopback } from '../helpers/loopback';

describe('RF-S8: cabeceras de la respuesta 200', () => {
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
