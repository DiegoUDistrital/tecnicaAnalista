import type { Express } from 'express';
import request, { type Response } from 'supertest';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../../src/http/http-error';
import { OMIT_KEY_HEADER, TEST_RATE_LIMIT, testSecurity } from '../helpers/security';
import { createTestApp } from '../helpers/test-app';

const NO_KEY = { [OMIT_KEY_HEADER]: '1' };

// Valores por defecto de helmet 8.3.0 que debe llevar TODA respuesta (lista cerrada de la spec).
const HELMET_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

function registerTestRoutes(app: Express): void {
  app.get('/test/ok', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.post('/test/created', (_req, res) => {
    res.status(201).json({ ok: true });
  });
  app.delete('/test/no-content', (_req, res) => {
    res.status(204).end();
  });
  app.get('/test/boom', () => {
    throw new Error('fallo inesperado');
  });
  app.get('/test/http-500', () => {
    throw new HttpError(500);
  });
}

interface Case {
  readonly label: string;
  readonly status: number;
  readonly send: (app: Express) => Promise<Response>;
}

const CASES: readonly Case[] = [
  { label: '200', status: 200, send: (app) => request(app).get('/test/ok') },
  { label: '201', status: 201, send: (app) => request(app).post('/test/created') },
  { label: '204 (DELETE)', status: 204, send: (app) => request(app).delete('/test/no-content') },
  {
    label: '400',
    status: 400,
    send: (app) => request(app).post('/api/tasks').set('Content-Type', 'application/json').send('{roto'),
  },
  { label: '401', status: 401, send: (app) => request(app).get('/api/tasks').set(NO_KEY) },
  { label: '404', status: 404, send: (app) => request(app).get('/nada') },
  { label: '405', status: 405, send: (app) => request(app).patch('/api/tasks') },
  {
    label: '413',
    status: 413,
    send: (app) =>
      request(app)
        .post('/api/tasks')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ title: 'a'.repeat(11000) })),
  },
  {
    label: '415',
    status: 415,
    send: (app) => request(app).post('/api/tasks').set('Content-Type', 'text/plain').send('hola'),
  },
  {
    label: '429',
    status: 429,
    send: async () => {
      const limited = createTestApp({ security: testSecurity({ rateLimit: { ...TEST_RATE_LIMIT, max: 1 } }) }).app;
      await request(limited).get('/api/tasks').set(NO_KEY);
      const res = await request(limited).get('/api/tasks').set(NO_KEY);
      limited.shutdown();
      return res;
    },
  },
  { label: '500', status: 500, send: (app) => request(app).get('/test/boom') },
  { label: '500 (HttpError)', status: 500, send: (app) => request(app).get('/test/http-500') },
];

describe('RF-G16: cabeceras de seguridad', () => {
  const { app } = createTestApp({ registerRoutes: registerTestRoutes });

  it.each(CASES)('RF-G16: la respuesta $label lleva helmet y no-store', async ({ status, send }) => {
    const res = await send(app);

    expect(res.status).toBe(status);
    expect(res.headers['cache-control']).toBe('no-store');
    for (const [name, value] of Object.entries(HELMET_HEADERS)) {
      expect(res.headers[name], name).toBe(value);
    }
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'");
  });

  it('RF-G16: /health lleva las cabeceras de helmet y NO lleva Cache-Control: no-store', async () => {
    const res = await request(app).get('/health').set(NO_KEY);

    expect(res.status).toBe(200);
    for (const [name, value] of Object.entries(HELMET_HEADERS)) {
      expect(res.headers[name], name).toBe(value);
    }
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['cache-control']).toBeUndefined();
  });
});
