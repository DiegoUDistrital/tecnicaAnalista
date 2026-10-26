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

const WRONG_KEY = 'Bearer clave-erronea-de-prueba-0000000000000000000';
const VALID_KEY = `Bearer ${TEST_API_KEY}`;
const NO_KEY = { [OMIT_KEY_HEADER]: '1' };

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
});
