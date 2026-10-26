import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { rawRequest, type RawResponse } from '../helpers/raw-http';
import { OMIT_KEY_HEADER, TEST_CORS_ORIGIN, testSecurity } from '../helpers/security';
import { createTestApp } from '../helpers/test-app';

const ALLOWED = TEST_CORS_ORIGIN;

const servers: LoopbackServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close();
  }
});

function newApp(rateLimitMax?: number): ReturnType<typeof createTestApp>['app'] {
  const security =
    rateLimitMax === undefined
      ? testSecurity()
      : testSecurity({ rateLimit: { windowMs: 900000, max: rateLimitMax, postMax: rateLimitMax, authFailuresMax: 1 } });
  return createTestApp({
    security,
    registerRoutes: (app) => {
      app.get('/api/probe', (_req, res) => {
        res.json({ ok: true });
      });
    },
  }).app;
}

/** Petición con socket crudo y las líneas de cabecera TAL CUAL (nombres y repeticiones exactas). */
async function raw(app: ReturnType<typeof newApp>, path: string, headerLines: string[]): Promise<RawResponse> {
  const server = await listenOnLoopback(app);
  servers.push(server);
  const text = [`GET ${path} HTTP/1.1`, 'Host: localhost', ...headerLines, 'Connection: close', '', ''].join('\r\n');
  const result = await rawRequest(server.port, [text]);
  const [response] = result.responses;
  if (response === undefined) {
    throw new Error('Sin respuesta del servidor.');
  }
  return response;
}

function varyValues(vary: string | undefined): string[] {
  return (vary ?? '').split(',').map((value) => value.trim());
}

function corsHeaders(headers: Readonly<Record<string, string>>): string[] {
  return Object.keys(headers).filter((name) => name.startsWith('access-control-'));
}

const SCENARIOS = [
  ['200', 200, (app: ReturnType<typeof newApp>) => request(app).get('/api/probe')],
  ['401', 401, (app: ReturnType<typeof newApp>) => request(app).get('/api/probe').set(OMIT_KEY_HEADER, '1')],
  ['404', 404, (app: ReturnType<typeof newApp>) => request(app).get('/api/nada')],
  ['405', 405, (app: ReturnType<typeof newApp>) => request(app).patch('/api/tasks')],
] as const;

describe('RF-G13: origen permitido', () => {
  it.each(SCENARIOS)('RF-G13: Origin igual al permitido añade Allow-Origin y Vary en %s', async (_l, status, call) => {
    const response = await call(newApp()).set('Origin', ALLOWED);

    expect(response.status).toBe(status);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(varyValues(response.headers['vary'] as string)).toContain('Origin');
  });

  it.each(SCENARIOS)('RF-G13: sin Origin solo hay Vary: Origin en un %s', async (_l, status, call) => {
    const response = await call(newApp());

    expect(response.status).toBe(status);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(varyValues(response.headers['vary'] as string)).toContain('Origin');
  });

  it('RF-G13: nunca Access-Control-Allow-Origin: * ni Allow-Credentials, con origen permitido o no', async () => {
    const app = newApp();

    for (const origin of [ALLOWED, 'https://evil.example', '*', 'null']) {
      const response = await request(app).get('/api/probe').set('Origin', origin);
      expect(response.headers['access-control-allow-origin'], origin).not.toBe('*');
      expect(response.headers['access-control-allow-credentials'], origin).toBeUndefined();
    }
  });

  it('RF-G13: el nombre de la cabecera origin / ORIGIN / Origin se trata igual', async () => {
    const app = newApp();

    for (const name of ['origin', 'ORIGIN', 'Origin']) {
      const response = await raw(app, '/api/probe', [`${name}: ${ALLOWED}`]);
      expect(response.status, name).toBe(200);
      expect(response.headers['access-control-allow-origin'], name).toBe(ALLOWED);
    }
  });
});

describe('RF-G13: origen no permitido', () => {
  it.each([
    'https://evil.example',
    'null',
    '*',
    'http://localhost:3001',
    'https://localhost:3000',
    'http://localhost:3000/',
    'http://LOCALHOST:3000',
    'HTTP://localhost:3000',
    '',
  ])('RF-G13: Origin %j no añade Access-Control-Allow-* y la petición se procesa igual', async (origin) => {
    const response = await request(newApp()).get('/api/probe').set('Origin', origin);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(corsHeaders(response.headers as Record<string, string>)).toEqual([]);
    expect(varyValues(response.headers['vary'] as string)).toContain('Origin');
  });

  it('RF-G13: origen no permitido sin key sigue dando 401 y con ruta inexistente 404', async () => {
    const app = newApp();

    expect(
      (await request(app).get('/api/probe').set(OMIT_KEY_HEADER, '1').set('Origin', 'https://evil.example')).status,
    ).toBe(401);
    expect((await request(app).get('/api/nada').set('Origin', 'https://evil.example')).status).toBe(404);
  });

  it('RF-G13: Origin repetido (válido + válido) no añade Access-Control-Allow-* y se procesa igual', async () => {
    const response = await raw(newApp(), '/api/probe', [`Origin: ${ALLOWED}`, `Origin: ${ALLOWED}`]);

    expect(response.status).toBe(200);
    expect(corsHeaders(response.headers)).toEqual([]);
    expect(varyValues(response.headers['vary'])).toContain('Origin');
  });

  it('RF-G13: Origin repetido (válido + inválido, en ambos órdenes) no añade Access-Control-Allow-*', async () => {
    const app = newApp();

    for (const lines of [
      [`Origin: ${ALLOWED}`, 'Origin: https://evil.example'],
      ['Origin: https://evil.example', `Origin: ${ALLOWED}`],
      [`Origin: ${ALLOWED}`, 'origin: https://evil.example'],
    ]) {
      const response = await raw(app, '/api/probe', lines);
      expect(response.status).toBe(200);
      expect(corsHeaders(response.headers)).toEqual([]);
    }
  });
});

describe('RF-G13: rutas exentas y 429', () => {
  it('RF-G13: /health no lleva Vary ni cabeceras de CORS, ni con el origen permitido', async () => {
    const response = await request(newApp()).get('/health').set('Origin', ALLOWED);

    expect(response.status).toBe(200);
    expect(response.headers['vary']).toBeUndefined();
    expect(corsHeaders(response.headers as Record<string, string>)).toEqual([]);
  });

  it('RF-G10: un 429 de una conexión del origen permitido lleva Access-Control-Allow-Origin y Vary', async () => {
    const app = newApp(1);

    expect((await request(app).get('/api/probe').set('Origin', ALLOWED)).status).toBe(200);
    const limited = await request(app).get('/api/probe').set('Origin', ALLOWED);

    expect(limited.status).toBe(429);
    expect(limited.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(varyValues(limited.headers['vary'] as string)).toContain('Origin');
    expect(limited.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('RF-G10: un 429 de otro origen lleva Vary pero no Access-Control-Allow-*', async () => {
    const app = newApp(1);

    await request(app).get('/api/probe');
    const limited = await request(app).get('/api/probe').set('Origin', 'https://evil.example');

    expect(limited.status).toBe(429);
    expect(corsHeaders(limited.headers as Record<string, string>)).toEqual([]);
    expect(varyValues(limited.headers['vary'] as string)).toContain('Origin');
  });
});
