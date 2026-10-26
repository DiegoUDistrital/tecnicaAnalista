import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShutdownApp } from '../../src/app';
import type { Database } from '../../src/db/pool';
import { startServer } from '../../src/server/start-server';
import { createCaptureLogger } from '../helpers/capture-logger';
import {
  OMIT_KEY_HEADER,
  TEST_API_KEY,
  TEST_CORS_ORIGIN,
  TEST_RATE_LIMIT,
  testProxies,
  testSecurity,
} from '../helpers/security';
import { createHarness, validEnv } from '../helpers/server-fakes';
import { createTestApp } from '../helpers/test-app';

// Valores centinela inventados: no son secretos. Ninguno debe aparecer en los logs.
const WRONG_KEY_SENTINEL = 'Centinela-Clave-Erronea_0123456789-abcdefghijk';
const INVALID_API_KEY_SENTINEL = 'centinela-api-key-invalida-Zq9';
const WRONG_BEARER = `Bearer ${WRONG_KEY_SENTINEL}`;
const NO_KEY = { [OMIT_KEY_HEADER]: '1' };

/** Base de datos que siempre falla. El mensaje lleva la key válida a propósito: el logger no debe registrarlo. */
function failingDatabase(): Database {
  return {
    query: () => Promise.reject(new Error(`fallo tras usar la key ${TEST_API_KEY}`)),
    close: () => Promise.resolve(),
  };
}

describe('RF-G18: la key y la cabecera Authorization nunca llegan a los logs', () => {
  it(
    'RF-G18: una petición con key válida que provoca un 500 y una con key errónea de valor centinela dejan ' +
      'los logs sin el centinela, sin la key válida y sin la palabra authorization',
    async () => {
      const capture = createCaptureLogger();
      const { app } = createTestApp({ capture, database: failingDatabase() });

      const failed = await request(app).get('/api/tasks').set('Authorization', `Bearer ${TEST_API_KEY}`);
      expect(failed.status).toBe(500);
      const linesAfterServerError = capture.lines.length;
      expect(linesAfterServerError).toBe(1);

      const denied = await request(app).get('/api/tasks').set('Authorization', `Bearer ${WRONG_KEY_SENTINEL}`);
      expect(denied.status).toBe(401);
      expect(capture.lines).toHaveLength(linesAfterServerError);

      const output = capture.output();
      expect(output).not.toContain(WRONG_KEY_SENTINEL);
      expect(output).not.toContain(TEST_API_KEY);
      expect(output.toLowerCase()).not.toContain('authorization');
    },
  );

  it('RF-G18: una API_KEY inválida centinela no aparece en startup_failed', async () => {
    const harness = createHarness({ env: validEnv({ API_KEY: INVALID_API_KEY_SENTINEL }) });

    const code = await startServer(harness.overrides);

    expect(code).toBe(1);
    expect(harness.events()).toEqual(['startup_failed']);
    expect(harness.capture.output()).toContain('API_KEY: formato inválido');
    expect(harness.capture.output()).not.toContain(INVALID_API_KEY_SENTINEL);
  });
});

describe('RF-G18: los límites, el preflight y la IP no escriben en ningún log ni en la consola', () => {
  const apps: ShutdownApp[] = [];

  afterEach(() => {
    for (const app of apps.splice(0)) {
      app.shutdown();
    }
    vi.restoreAllMocks();
  });

  it('RF-G18: 401, 429 y preflight no escriben ninguna línea (bloqueo tras 1 fallo y cupo general de 3)', async () => {
    const capture = createCaptureLogger();
    const { app } = createTestApp({
      capture,
      security: testSecurity({ rateLimit: { ...TEST_RATE_LIMIT, max: 3, authFailuresMax: 1 } }),
    });
    apps.push(app);

    const statuses = [
      (await request(app).get('/api/tasks').set(NO_KEY)).status, // 401: primer fallo y bloqueo de la IP
      (await request(app).get('/api/tasks').set('Authorization', WRONG_BEARER)).status, // 429 por bloqueo
      (
        await request(app)
          .options('/api/tasks')
          .set(NO_KEY)
          .set('Origin', TEST_CORS_ORIGIN)
          .set('Access-Control-Request-Method', 'GET')
      ).status, // 204: el preflight cuenta en el general (3.º)
      (await request(app).get('/api/tasks').set(NO_KEY)).status, // 429 por cupo general (4.º > 3)
    ];

    expect(statuses).toEqual([401, 429, 204, 429]);
    expect(capture.lines).toHaveLength(0);
  });

  it('RF-G18: nada en console ni en stdout/stderr con X-Forwarded-For, Forwarded, IPv6 o key errónea', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'debug').mockImplementation(() => undefined),
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true),
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true),
    ];
    const none = createTestApp({
      security: testSecurity({ rateLimit: { ...TEST_RATE_LIMIT, max: 4, authFailuresMax: 2 } }),
    });
    const loopback = createTestApp({
      security: testSecurity({
        rateLimit: { ...TEST_RATE_LIMIT, max: 3, authFailuresMax: 1 },
        trustedProxies: testProxies('loopback'),
      }),
    });
    apps.push(none.app, loopback.app);

    // Con TRUSTED_PROXIES=none: las cabeceras de proxy se ignoran y no deben escribir nada.
    await request(none.app)
      .get('/api/tasks')
      .set(NO_KEY)
      .set('X-Forwarded-For', '203.0.113.9')
      .set('Forwarded', 'for=198.51.100.7');
    await request(none.app).get('/api/tasks').set('Authorization', WRONG_BEARER).set('X-Forwarded-For', '2001:db8::1');
    // Con la conexión de confianza: la IPv6 de X-Forwarded-For cuenta como clave y la librería no debe quejarse.
    await request(loopback.app)
      .get('/api/tasks')
      .set(NO_KEY)
      .set('X-Forwarded-For', '2001:db8::1')
      .set('Forwarded', 'for=198.51.100.7');
    await request(loopback.app)
      .get('/api/tasks')
      .set('Authorization', WRONG_BEARER)
      .set('X-Forwarded-For', '2001:db8::1, 203.0.113.9');
    await request(loopback.app).get('/api/tasks').set(NO_KEY).set('X-Forwarded-For', '2001:db8::1');

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(none.capture.lines).toHaveLength(0);
    expect(loopback.capture.lines).toHaveLength(0);
  });

  it('RF-G18: la IP real y el origen no aparecen en ningún log, tampoco en request_error', async () => {
    const capture = createCaptureLogger();
    const { app } = createTestApp({
      capture,
      database: failingDatabase(),
      security: testSecurity({ trustedProxies: testProxies('loopback') }),
    });
    apps.push(app);

    const response = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${TEST_API_KEY}`)
      .set('X-Forwarded-For', '198.51.100.23')
      .set('Forwarded', 'for=203.0.113.44')
      .set('Origin', 'https://origen-centinela.example.test');

    expect(response.status).toBe(500);
    expect(capture.records().map((record) => record['event'])).toEqual(['request_error']);
    const output = capture.output();
    for (const secret of ['198.51.100.23', '203.0.113.44', 'origen-centinela.example.test']) {
      expect(output).not.toContain(secret);
    }
  });
});
