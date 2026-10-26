import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/config/config';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { OMIT_KEY_HEADER, testProxies, testSecurity } from '../helpers/security';
import { createTestApp } from '../helpers/test-app';

type RateLimit = AppConfig['security']['rateLimit'];

const WINDOW_MS = 900000;
const WRONG = 'Bearer wrong-key-wrong-key-wrong-key-wrong-key-0000';
const TOO_MANY = { error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiadas peticiones.', details: [] } };

const servers: LoopbackServer[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const server of servers.splice(0)) {
    await server.close();
  }
});

/** App real con cupos explícitos (los de intentos fallidos casi siempre pequeños) y una ruta que falla con 500. */
function appWith(rateLimit: Partial<RateLimit>, trusted = 'none'): ReturnType<typeof createTestApp>['app'] {
  const security = testSecurity({
    rateLimit: { windowMs: WINDOW_MS, max: 10000, postMax: 10000, authFailuresMax: 1000, ...rateLimit },
    trustedProxies: testProxies(trusted),
  });
  return createTestApp({
    security,
    registerRoutes: (app) => {
      app.get('/api/boom', () => {
        throw new Error('fallo de prueba');
      });
    },
  }).app;
}

async function listen(app: ReturnType<typeof appWith>): Promise<LoopbackServer> {
  const server = await listenOnLoopback(app);
  servers.push(server);
  return server;
}

/** GET a una ruta inexistente con key errónea: 401 si no está bloqueada la IP, 429 si lo está. */
function wrongKey(app: ReturnType<typeof appWith>, forwardedFor?: string): request.Test {
  const call = request(app).get('/api/nada').set('Authorization', WRONG);
  return forwardedFor === undefined ? call : call.set('X-Forwarded-For', forwardedFor);
}

/** GET a una ruta inexistente con la key válida (la inyecta el ayudante): 404, o 429 si la IP está bloqueada. */
function goodKey(app: ReturnType<typeof appWith>, forwardedFor?: string): request.Test {
  const call = request(app).get('/api/nada');
  return forwardedFor === undefined ? call : call.set('X-Forwarded-For', forwardedFor);
}

describe('RF-G9: bloqueo de la IP tras intentos fallidos', () => {
  it('RF-G9: con límite 3 tres keys erróneas dan 401; la cuarta y la quinta (key VÁLIDA) dan 429', async () => {
    const app = appWith({ authFailuresMax: 3 });

    for (let call = 1; call <= 3; call += 1) {
      expect((await wrongKey(app)).status, `intento ${String(call)}`).toBe(401);
    }
    const fourth = await wrongKey(app);
    const fifth = await goodKey(app);

    expect(fourth.status).toBe(429);
    expect(fourth.body).toEqual(TOO_MANY);
    expect(fifth.status).toBe(429);
    expect(fifth.body).toEqual(TOO_MANY);
  });

  it('RF-G9: una petición sin Authorization también es un intento fallido', async () => {
    const app = appWith({ authFailuresMax: 2 });

    expect((await goodKey(app).set(OMIT_KEY_HEADER, '1')).status).toBe(401);
    expect((await goodKey(app).set(OMIT_KEY_HEADER, '1')).status).toBe(401);
    expect((await goodKey(app)).status).toBe(429);
  });

  it('RF-G9: ráfaga de 20 con key errónea y cupo 3 da EXACTAMENTE 3 respuestas 401 y 17 respuestas 429', async () => {
    for (let round = 1; round <= 3; round += 1) {
      const { port } = await listen(appWith({ authFailuresMax: 3 }));

      const statuses = await Promise.all(
        Array.from(
          { length: 20 },
          async () =>
            (await fetch(`http://127.0.0.1:${String(port)}/api/nada`, { headers: { Authorization: WRONG } })).status,
        ),
      );

      expect(
        statuses.filter((status) => status === 401),
        `ronda ${String(round)}`,
      ).toHaveLength(3);
      expect(
        statuses.filter((status) => status === 429),
        `ronda ${String(round)}`,
      ).toHaveLength(17);
    }
  });

  it('RF-G9: una key válida seguida de 404, 400 y 500 repetidos más veces que el límite no bloquea la IP', async () => {
    const app = appWith({ authFailuresMax: 3 });

    for (let call = 0; call < 8; call += 1) {
      expect((await goodKey(app)).status).toBe(404);
      expect((await request(app).post('/api/tasks').send({})).status).toBe(400);
      expect((await request(app).get('/api/boom')).status).toBe(500);
    }

    expect((await goodKey(app)).status).toBe(404);
    // Sigue sin intentos fallidos acumulados: la primera key errónea todavía da 401.
    expect((await wrongKey(app)).status).toBe(401);
  });

  it('RF-G9: un 429 no cuenta como intento fallido ni mueve la ventana', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-01T10:00:00.000Z') });
    const app = appWith({ authFailuresMax: 2 });

    expect((await wrongKey(app)).status).toBe(401);
    expect((await wrongKey(app)).status).toBe(401);
    const first = await wrongKey(app);
    vi.setSystemTime(new Date('2026-03-01T10:05:00.000Z'));
    const later = await wrongKey(app);

    expect(first.status).toBe(429);
    expect(later.status).toBe(429);
    // La ventana es la del primer fallo: 900 s al principio y 600 s cinco minutos después.
    expect(first.headers['retry-after']).toBe('900');
    expect(later.headers['retry-after']).toBe('600');
    vi.setSystemTime(new Date('2026-03-01T10:15:00.000Z'));
    expect((await wrongKey(app)).status).toBe(401);
  });

  it('RF-G9: otra IP (X-Forwarded-For desde una conexión de confianza) sigue autenticándose', async () => {
    const app = appWith({ authFailuresMax: 2 }, 'loopback');
    const blocked = '203.0.113.1';
    const other = '203.0.113.2';

    expect((await wrongKey(app, blocked)).status).toBe(401);
    expect((await wrongKey(app, blocked)).status).toBe(401);

    expect((await wrongKey(app, blocked)).status).toBe(429);
    expect((await goodKey(app, blocked)).status).toBe(429);
    expect((await goodKey(app, other)).status).toBe(404);
    expect((await wrongKey(app, other)).status).toBe(401);
  });

  it('RF-G9: /health no cuenta ni se bloquea', async () => {
    const app = appWith({ authFailuresMax: 1 });

    for (let call = 0; call < 5; call += 1) {
      expect((await request(app).get('/health')).status).toBe(200);
    }
    expect((await wrongKey(app)).status).toBe(401);
    expect((await wrongKey(app)).status).toBe(429);
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('RF-G9: la ventana de fallos es fija por IP: la de B empieza cuando llega el primer fallo de B', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-01T10:00:00.000Z') });
    const app = appWith({ authFailuresMax: 1 }, 'loopback');

    expect((await wrongKey(app, '203.0.113.1')).status).toBe(401);
    vi.setSystemTime(new Date('2026-03-01T10:05:00.000Z'));
    expect((await wrongKey(app, '203.0.113.2')).status).toBe(401);
    const blockedA = await goodKey(app, '203.0.113.1');
    const blockedB = await goodKey(app, '203.0.113.2');

    expect(blockedA.headers['retry-after']).toBe('600');
    expect(blockedB.headers['retry-after']).toBe('900');
  });

  it('RF-G9: tras la ventana (reloj simulado) la IP se autentica; Retry-After es el del 1.er fallo', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-01T10:00:00.000Z') });
    const app = appWith({ authFailuresMax: 2 });

    expect((await wrongKey(app)).status).toBe(401);
    vi.setSystemTime(new Date('2026-03-01T10:05:00.000Z'));
    expect((await wrongKey(app)).status).toBe(401);
    vi.setSystemTime(new Date('2026-03-01T10:06:00.000Z'));
    const blocked = await goodKey(app);
    vi.setSystemTime(new Date('2026-03-01T10:14:59.999Z'));
    const lastSecond = await goodKey(app);
    vi.setSystemTime(new Date('2026-03-01T10:15:00.000Z'));
    const released = await goodKey(app);

    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBe('540');
    expect(lastSecond.headers['retry-after']).toBe('1');
    expect(released.status).toBe(404);
    expect((await wrongKey(app)).status).toBe(401);
  });

  it('RF-G10: el 429 por fallos lleva Retry-After entero, helmet, no-store y ningún RateLimit-*', async () => {
    const app = appWith({ authFailuresMax: 1 });
    await wrongKey(app);

    const blocked = await goodKey(app);

    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toMatch(/^[1-9]\d*$/);
    expect(blocked.headers['x-content-type-options']).toBe('nosniff');
    expect(blocked.headers['cache-control']).toBe('no-store');
    expect(blocked.headers['www-authenticate']).toBeUndefined();
    expect(Object.keys(blocked.headers).filter((name) => /^(x-)?ratelimit/.test(name))).toEqual([]);
  });
});

describe('RF-G1: P3 (intentos fallidos) en el orden de la tubería', () => {
  it('RF-G1 par 429-key válida: la IP bloqueada con key buena da 429; sin bloquear, la misma pasa', async () => {
    const control = appWith({ authFailuresMax: 1 });
    const app = appWith({ authFailuresMax: 1 });

    expect((await goodKey(control)).status).toBe(404);
    expect((await wrongKey(app)).status).toBe(401);
    expect((await goodKey(app)).status).toBe(429);
  });

  it('RF-G1 P3 antes que P4: un POST con key buena de una IP bloqueada da 429 sin gastar el de POST', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-01T10:00:00.000Z') });
    const app = appWith({ windowMs: 10000, authFailuresMax: 1, postMax: 1 });

    expect((await wrongKey(app)).status).toBe(401);
    vi.setSystemTime(new Date('2026-03-01T10:00:01.000Z'));
    expect((await request(app).post('/api/tasks').send({})).status).toBe(429);
    // La ventana de fallos termina en t=10 s; si el POST bloqueado hubiera gastado el cupo de POST (ventana abierta
    // en t=1 s hasta t=11 s), el siguiente POST ya sería un 429.
    vi.setSystemTime(new Date('2026-03-01T10:00:10.500Z'));
    expect((await request(app).post('/api/tasks').send({})).status).toBe(400);
    expect((await request(app).post('/api/tasks').send({})).status).toBe(429);
  });
});
