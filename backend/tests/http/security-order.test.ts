import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { ShutdownApp } from '../../src/app';
import type { AppConfig } from '../../src/config/config';
import type { Database } from '../../src/db/pool';
import { type CaptureLogger, createCaptureLogger } from '../helpers/capture-logger';
import {
  OMIT_KEY_HEADER,
  TEST_API_KEY,
  TEST_CORS_ORIGIN,
  TEST_RATE_LIMIT,
  testProxies,
  testSecurity,
} from '../helpers/security';
import { createTestApp } from '../helpers/test-app';

// Orden de RF-G1 con TODOS los mecanismos activos a la vez: cada test de par ejecuta la pila completa (cupo general,
// preflight, intentos fallidos, key, cupo de POST, rutas y manejador central) con cupos pequeños para forzar el 429.
// Cada test crea su propia app, así que sus contadores empiezan a cero.

const UUID = '3f2b1c9e-8a4d-4e7b-9c1a-5d6e7f8a9b0c';
const WRONG_KEY = 'Bearer clave-erronea-de-prueba-0000000000000000000';
const VALID_KEY = `Bearer ${TEST_API_KEY}`;
const NO_KEY = { [OMIT_KEY_HEADER]: '1' };
const HELMET_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

interface SpyDatabase {
  readonly database: Database;
  /** Cuántas consultas se han intentado: una petición que llega a la BD da 500 y este contador lo delata. */
  readonly calls: () => number;
}

/** Base de datos que cuenta las consultas y siempre falla (la BD está «apagada»). */
function spyDatabase(): SpyDatabase {
  let count = 0;
  return {
    database: {
      query: () => {
        count += 1;
        return Promise.reject(new Error('consulta de prueba: la base de datos no está disponible'));
      },
      close: () => Promise.resolve(),
    },
    calls: () => count,
  };
}

interface Stack {
  readonly app: ShutdownApp;
  readonly capture: CaptureLogger;
  readonly db: SpyDatabase;
}

const apps: ShutdownApp[] = [];

/** App con todos los mecanismos. `rateLimit` sobrescribe los cupos; `trusted` es el texto de `TRUSTED_PROXIES`. */
function stack(rateLimit: Partial<AppConfig['security']['rateLimit']> = {}, trusted = 'none'): Stack {
  const capture = createCaptureLogger();
  const db = spyDatabase();
  const { app } = createTestApp({
    capture,
    database: db.database,
    security: testSecurity({ rateLimit: { ...TEST_RATE_LIMIT, ...rateLimit }, trustedProxies: testProxies(trusted) }),
  });
  apps.push(app);
  return { app, capture, db };
}

/** Preflight válido de la lista de tareas, sin key (el navegador no la manda en el preflight). */
function preflight(app: ShutdownApp): request.Test {
  return request(app)
    .options('/api/tasks')
    .set(NO_KEY)
    .set('Origin', TEST_CORS_ORIGIN)
    .set('Access-Control-Request-Method', 'GET');
}

afterEach(() => {
  for (const app of apps.splice(0)) {
    app.shutdown();
  }
});

describe('RF-G1: orden completo de etapas con todos los mecanismos activos', () => {
  it('RF-G1: secuencia completa (preflight, bloqueo, cupo general) y la BD nunca se consulta', async () => {
    const { app, capture, db } = stack({ max: 6, postMax: 1, authFailuresMax: 2 });

    // Peticiones 1 a 3 (cupo general 1 a 3): el preflight pasa (P2), la key falla dos veces y la IP queda bloqueada.
    expect((await preflight(app)).status).toBe(204);
    expect((await request(app).get('/api/tasks').set(NO_KEY)).status).toBe(401);
    expect((await request(app).get('/api/tasks').set('Authorization', WRONG_KEY)).status).toBe(401);
    // Petición 4: el preflight sigue dando 204 aunque la IP esté bloqueada (P2 antes que P3).
    expect((await preflight(app)).status).toBe(204);
    // Peticiones 5 y 6: el bloqueo gana a la key válida y a la ruta inexistente (P3 antes que la key y que el 404).
    expect((await request(app).get('/api/tasks').set('Authorization', VALID_KEY)).status).toBe(429);
    expect((await request(app).get('/api/nada').set('Authorization', VALID_KEY)).status).toBe(429);
    // Petición 7 (sobre el cupo general de 6): el general gana incluso al preflight (P1 antes que P2).
    expect((await preflight(app)).status).toBe(429);

    expect(db.calls()).toBe(0);
    expect(capture.lines).toHaveLength(0);
  });

  it('RF-G1: P0 (helmet, no-store, Vary: Origin y Access-Control-Allow-Origin) en 204, 401 y 429', async () => {
    const { app } = stack({ max: 2 });

    const responses = [
      await preflight(app),
      await request(app).get('/api/tasks').set(NO_KEY).set('Origin', TEST_CORS_ORIGIN),
      await request(app).get('/api/tasks').set(NO_KEY).set('Origin', TEST_CORS_ORIGIN),
    ];

    expect(responses.map((response) => response.status)).toEqual([204, 401, 429]);
    for (const response of responses) {
      for (const [name, value] of Object.entries(HELMET_HEADERS)) {
        expect(response.headers[name]).toBe(value);
      }
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['vary']).toContain('Origin');
      expect(response.headers['access-control-allow-origin']).toBe(TEST_CORS_ORIGIN);
    }
  });

  it('RF-G1 par 429-401: cupo general agotado con key errónea da 429, no 401', async () => {
    const { app } = stack({ max: 1 });
    await request(app).get('/api/tasks').set(NO_KEY);

    const response = await request(app).get('/api/tasks').set('Authorization', WRONG_KEY);

    expect(response.status).toBe(429);
    expect(response.body).toEqual({
      error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiadas peticiones.', details: [] },
    });
  });

  it('RF-G1 par 429 de fallos-key válida: IP bloqueada da 429 con key buena y no llega a la BD', async () => {
    const { app, db } = stack({ authFailuresMax: 2, postMax: 1 });
    expect((await request(app).get('/api/tasks').set('Authorization', WRONG_KEY)).status).toBe(401);
    expect((await request(app).get('/api/tasks').set('Authorization', WRONG_KEY)).status).toBe(401);

    const get = await request(app).get('/api/tasks').set('Authorization', VALID_KEY);
    const post = await request(app)
      .post('/api/tasks')
      .set('Authorization', VALID_KEY)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ title: 'tarea' }));

    expect(get.status).toBe(429);
    expect(post.status).toBe(429);
    expect(db.calls()).toBe(0);
  });

  it('RF-G1 par 401-404: /api/nada sin key da 401 y con key da 404', async () => {
    const { app } = stack();

    expect((await request(app).get('/api/nada').set(NO_KEY)).status).toBe(401);
    expect((await request(app).get('/api/nada').set('Authorization', VALID_KEY)).status).toBe(404);
  });

  it('RF-G1 par 401-405: PATCH /api/tasks sin key da 401 y con key da 405 con Allow', async () => {
    const { app } = stack();

    const withoutKey = await request(app).patch('/api/tasks').set(NO_KEY);
    const withKey = await request(app).patch('/api/tasks').set('Authorization', VALID_KEY);

    expect(withoutKey.status).toBe(401);
    expect(withKey.status).toBe(405);
    expect(withKey.headers['allow']).toBe('GET, POST');
  });

  it('RF-G1 par 401-413: 20 KB sin key dan 401 y con key y text/plain dan 413', async () => {
    const { app } = stack();
    const body = 'x'.repeat(20 * 1024);

    const withoutKey = await request(app).post('/api/tasks').set(NO_KEY).set('Content-Type', 'text/plain').send(body);
    const withKey = await request(app)
      .post('/api/tasks')
      .set('Authorization', VALID_KEY)
      .set('Content-Type', 'text/plain')
      .send(body);

    expect(withoutKey.status).toBe(401);
    expect(withKey.status).toBe(413);
  });

  it('RF-G1 par 401-415: POST sin key con text/plain da 401 y con key da 415', async () => {
    const { app } = stack();

    const withoutKey = await request(app).post('/api/tasks').set(NO_KEY).set('Content-Type', 'text/plain').send('hola');
    const withKey = await request(app)
      .post('/api/tasks')
      .set('Authorization', VALID_KEY)
      .set('Content-Type', 'text/plain')
      .send('hola');

    expect(withoutKey.status).toBe(401);
    expect(withKey.status).toBe(415);
  });

  it('RF-G1 par 401-400: JSON roto sin key da 401 y con key da 400', async () => {
    const { app } = stack();

    const withoutKey = await request(app)
      .post('/api/tasks')
      .set(NO_KEY)
      .set('Content-Type', 'application/json')
      .send('{"title": ');
    const withKey = await request(app)
      .post('/api/tasks')
      .set('Authorization', VALID_KEY)
      .set('Content-Type', 'application/json')
      .send('{"title": ');

    expect(withoutKey.status).toBe(401);
    expect(withKey.status).toBe(400);
  });

  it('RF-G1 par P2-P3: preflight sin key da 204 con todos los mecanismos activos', async () => {
    const { app } = stack();

    const response = await preflight(app);

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-methods']).toBe('GET, POST');
  });

  it('RF-G1 par P4-etapa 1: POST agotado a /api/tasks/<uuid> (ruta que daría 405) da 429', async () => {
    const { app } = stack({ postMax: 1 });

    const first = await request(app).post(`/api/tasks/${UUID}`).set('Authorization', VALID_KEY);
    const second = await request(app).post(`/api/tasks/${UUID}`).set('Authorization', VALID_KEY);

    expect(first.status).toBe(405);
    expect(second.status).toBe(429);
  });

  it('RF-G1 par 401 con BD apagada: sin key da 401 sin consultar la BD; con key la consulta y da 500', async () => {
    const { app, db } = stack();

    const withoutKey = await request(app).get('/api/tasks').set(NO_KEY);
    expect(withoutKey.status).toBe(401);
    expect(db.calls()).toBe(0);

    const withKey = await request(app).get('/api/tasks').set('Authorization', VALID_KEY);
    expect(withKey.status).toBe(500);
    expect(db.calls()).toBe(1);
  });
});
