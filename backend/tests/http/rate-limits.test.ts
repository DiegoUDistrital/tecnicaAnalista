import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/config/config';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { hasCompleteResponse, rawRequest } from '../helpers/raw-http';
import { OMIT_KEY_HEADER, TEST_API_KEY, testProxies, testSecurity } from '../helpers/security';
import { createTestApp } from '../helpers/test-app';

type RateLimit = AppConfig['security']['rateLimit'];

const WINDOW_MS = 900000;
const UUID = '123e4567-e89b-42d3-a456-426614174000';
const TOO_MANY = { error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiadas peticiones.', details: [] } };

const servers: LoopbackServer[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const server of servers.splice(0)) {
    await server.close();
  }
});

/** App real con cupos explícitos; `trusted` es el texto de TRUSTED_PROXIES (por defecto, nadie). */
function appWith(rateLimit: Partial<RateLimit>, trusted = 'none'): ReturnType<typeof createTestApp>['app'] {
  const security = testSecurity({
    rateLimit: { windowMs: WINDOW_MS, max: 10000, postMax: 10000, ...rateLimit },
    trustedProxies: testProxies(trusted),
  });
  return createTestApp({ security }).app;
}

async function listen(app: ReturnType<typeof appWith>): Promise<LoopbackServer> {
  const server = await listenOnLoopback(app);
  servers.push(server);
  return server;
}

/** GET que solo cuenta en el cupo general y no toca la base de datos: la ruta no existe y da 404 con key. */
function getNothing(app: ReturnType<typeof appWith>, forwardedFor?: string): request.Test {
  const call = request(app).get('/api/nada');
  return forwardedFor === undefined ? call : call.set('X-Forwarded-For', forwardedFor);
}

/** POST con JSON vacío: pasa por el cupo de POST y la validación (400) sin tocar la base de datos. */
function postEmpty(app: ReturnType<typeof appWith>): request.Test {
  return request(app).post('/api/tasks').send({});
}

describe('RF-G7: cupo general', () => {
  it('RF-G7: con cupo 5 las 5 primeras no dan 429 y la sexta sí', async () => {
    const app = appWith({ max: 5 });

    for (let call = 1; call <= 5; call += 1) {
      expect((await getNothing(app)).status, `petición ${String(call)}`).toBe(404);
    }
    expect((await getNothing(app)).status).toBe(429);
    expect((await getNothing(app)).status).toBe(429);
  });

  it('RF-G7: 20 simultáneas con cupo 5 dan exactamente 5 sin 429 y 15 con 429', async () => {
    const { port } = await listen(appWith({ max: 5 }));

    const statuses = await Promise.all(
      Array.from({ length: 20 }, async () => (await fetch(`http://127.0.0.1:${String(port)}/api/nada`)).status),
    );

    expect(statuses.filter((status) => status === 429)).toHaveLength(15);
    expect(statuses.filter((status) => status === 404)).toHaveLength(5);
  });

  it('RF-G7: GET, POST, PUT, DELETE, OPTIONS, 404 y 405 cuentan en el general (con y sin key)', async () => {
    const app = appWith({ max: 7 });
    const calls = [
      () => request(app).get('/api/nada'),
      () => postEmpty(app),
      () => request(app).put(`/api/tasks/${UUID}`).send({}),
      () => request(app).delete('/api/tasks/not-a-uuid'),
      () => request(app).options('/api/tasks'),
      () => request(app).patch('/api/tasks'),
      () => request(app).get('/api/nada').set(OMIT_KEY_HEADER, '1'),
    ];

    for (const [index, call] of calls.entries()) {
      expect((await call()).status, `petición ${String(index)}`).not.toBe(429);
    }
    expect((await getNothing(app)).status).toBe(429);
  });

  it('RF-G7: 1000 GET /health con cupo 5 dan siempre 200 y no consumen el cupo', async () => {
    const { port } = await listen(appWith({ max: 5 }));
    const url = `http://127.0.0.1:${String(port)}`;
    const statuses: number[] = [];

    for (let batch = 0; batch < 20; batch += 1) {
      statuses.push(
        ...(await Promise.all(Array.from({ length: 50 }, async () => (await fetch(`${url}/health`)).status))),
      );
    }

    expect(statuses).toHaveLength(1000);
    expect(statuses.every((status) => status === 200)).toBe(true);
    for (let call = 1; call <= 5; call += 1) {
      expect((await fetch(`${url}/api/nada`)).status).toBe(404);
    }
    expect((await fetch(`${url}/api/nada`)).status).toBe(429);
  });

  it('RF-G7: dos IPs tienen contadores y ventanas independientes (la de B empieza con su primera)', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-01T10:00:00.000Z') });
    const app = appWith({ max: 2 }, 'loopback');
    const ipA = '203.0.113.1';
    const ipB = '203.0.113.2';

    expect((await getNothing(app, ipA)).status).toBe(404);
    expect((await getNothing(app, ipA)).status).toBe(404);
    expect((await getNothing(app, ipA)).status).toBe(429);
    vi.setSystemTime(new Date('2026-03-01T10:05:00.000Z'));
    expect((await getNothing(app, ipB)).status).toBe(404);
    expect((await getNothing(app, ipB)).status).toBe(404);
    const blockedA = await getNothing(app, ipA);
    const blockedB = await getNothing(app, ipB);

    expect(blockedA.status).toBe(429);
    expect(blockedB.status).toBe(429);
    // A empezó hace 5 minutos (quedan 600 s); B acaba de empezar (quedan los 900 s completos).
    expect(blockedA.headers['retry-after']).toBe('600');
    expect(blockedB.headers['retry-after']).toBe('900');
  });

  it('RF-G7: dos direcciones IPv6 del mismo /64 comparten cupo y otro /64 tiene el suyo', async () => {
    const app = appWith({ max: 1 }, 'loopback');

    expect((await getNothing(app, '2001:db8:1:2::1')).status).toBe(404);
    expect((await getNothing(app, '2001:db8:1:2:ffff::9')).status).toBe(429);
    expect((await getNothing(app, '2001:db8:1:3::1')).status).toBe(404);
  });

  it('RF-G7: tras terminar la ventana (1 000 ms reales) se atiende de nuevo', async () => {
    const app = appWith({ max: 1, windowMs: 1000 });

    expect((await getNothing(app)).status).toBe(404);
    expect((await getNothing(app)).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect((await getNothing(app)).status).toBe(404);
  });
});

describe('RF-G8: cupo de POST', () => {
  it('RF-G8: con cupo de POST 3 el cuarto POST da 429 y un GET inmediato no da 429', async () => {
    const app = appWith({ postMax: 3 });

    for (let call = 1; call <= 3; call += 1) {
      expect((await postEmpty(app)).status, `POST ${String(call)}`).toBe(400);
    }
    expect((await postEmpty(app)).status).toBe(429);
    expect((await getNothing(app)).status).toBe(404);
  });

  it('RF-G8: PUT y DELETE no consumen el cupo de POST', async () => {
    const app = appWith({ postMax: 3 });

    for (let call = 0; call < 5; call += 1) {
      expect((await request(app).put(`/api/tasks/${UUID}`).send({})).status).not.toBe(429);
      expect((await request(app).delete('/api/tasks/not-a-uuid')).status).not.toBe(429);
    }
    for (let call = 1; call <= 3; call += 1) {
      expect((await postEmpty(app)).status, `POST ${String(call)}`).toBe(400);
    }
    expect((await postEmpty(app)).status).toBe(429);
  });

  it('RF-G8: un POST sin key (401) no consume el cupo de POST', async () => {
    const app = appWith({ postMax: 3 });

    for (let call = 0; call < 5; call += 1) {
      expect((await postEmpty(app).set(OMIT_KEY_HEADER, '1')).status).toBe(401);
    }
    for (let call = 1; call <= 3; call += 1) {
      expect((await postEmpty(app)).status, `POST ${String(call)}`).toBe(400);
    }
    expect((await postEmpty(app)).status).toBe(429);
  });

  it('RF-G8: con el general justo agotado un POST da 429 por P1 y NO consume el cupo de POST', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-01T10:00:00.000Z') });
    const app = appWith({ windowMs: 10000, max: 4, postMax: 3 });

    // Ventana general: abierta en t=0 con tres GET. Ventana de POST: abierta en t=1 s con el primer POST.
    for (let call = 0; call < 3; call += 1) {
      expect((await getNothing(app)).status).toBe(404);
    }
    vi.setSystemTime(new Date('2026-03-01T10:00:01.000Z'));
    expect((await postEmpty(app)).status).toBe(400);
    vi.setSystemTime(new Date('2026-03-01T10:00:02.000Z'));
    expect((await postEmpty(app)).status).toBe(429);
    expect((await postEmpty(app)).status).toBe(429);

    // El general se reabre en t=10 s; la ventana de POST sigue abierta hasta t=11 s con 1 POST contado:
    // si los rechazados por P1 hubieran consumido el cupo de POST, ya estaría agotado.
    vi.setSystemTime(new Date('2026-03-01T10:00:10.500Z'));
    expect((await postEmpty(app)).status).toBe(400);
    expect((await postEmpty(app)).status).toBe(400);
    expect((await postEmpty(app)).status).toBe(429);
  });

  it('RF-G8: POST /health no cuenta en ningún cupo', async () => {
    const app = appWith({ max: 5, postMax: 3 });

    for (let call = 0; call < 10; call += 1) {
      expect((await request(app).post('/health')).status).toBe(405);
    }
    for (let call = 1; call <= 3; call += 1) {
      expect((await postEmpty(app)).status, `POST ${String(call)}`).toBe(400);
    }
    expect((await postEmpty(app)).status).toBe(429);
    // Del general se gastaron 4 (los POST a la API); queda 1.
    expect((await getNothing(app)).status).toBe(404);
    expect((await getNothing(app)).status).toBe(429);
  });

  it('RF-G8: un POST rechazado con 400 o 415 sí cuenta', async () => {
    const app = appWith({ postMax: 3 });

    expect((await postEmpty(app)).status).toBe(400);
    expect((await postEmpty(app)).status).toBe(400);
    expect((await request(app).post('/api/tasks').set('Content-Type', 'text/plain').send('hola')).status).toBe(415);
    expect((await postEmpty(app)).status).toBe(429);
  });
});

describe('RF-G10: respuesta 429', () => {
  it('RF-G10: el 429 trae el cuerpo exacto, helmet, no-store y ninguna cabecera de cupo (RateLimit-*)', async () => {
    const app = appWith({ max: 1 });

    const allowed = await getNothing(app);
    const rejected = await getNothing(app);

    expect(rejected.status).toBe(429);
    expect(rejected.body).toEqual(TOO_MANY);
    expect(rejected.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(rejected.headers['x-content-type-options']).toBe('nosniff');
    expect(rejected.headers['cache-control']).toBe('no-store');
    for (const response of [allowed, rejected]) {
      const names = Object.keys(response.headers);
      expect(names.filter((name) => /^(x-)?ratelimit/.test(name))).toEqual([]);
    }
    expect(allowed.headers['retry-after']).toBeUndefined();
  });

  it('RF-G10: Retry-After entero igual a max(1, ceil(restante/1000)) con el reloj simulado y en rango', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-01T10:00:00.000Z') });
    const app = appWith({ max: 1 });

    await getNothing(app);
    const first = await getNothing(app);
    vi.setSystemTime(new Date('2026-03-01T10:00:02.500Z'));
    const second = await getNothing(app);
    vi.setSystemTime(new Date('2026-03-01T10:14:59.999Z'));
    const last = await getNothing(app);

    expect(first.headers['retry-after']).toBe('900');
    expect(second.headers['retry-after']).toBe('898');
    expect(last.headers['retry-after']).toBe('1');
    for (const response of [first, second, last]) {
      const value = response.headers['retry-after'] ?? '';
      expect(value).toMatch(/^[1-9]\d*$/);
      expect(Number(value)).toBeLessThanOrEqual(WINDOW_MS / 1000);
    }
  });

  it('RF-G10: el 429 no lee el cuerpo: con body presente Connection: close y cierra; sin body no', async () => {
    const { port } = await listen(appWith({ max: 2 }));
    const head = (extra: string): string =>
      `${extra} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${TEST_API_KEY}\r\n`;

    await rawRequest(port, [`${head('GET /api/nada')}\r\n`], { until: hasCompleteResponse });
    const withoutBody = await rawRequest(port, [`${head('GET /api/nada')}\r\n`], { until: hasCompleteResponse });
    const body = '{}';
    const withBody = await rawRequest(port, [
      `${head('POST /api/tasks')}Content-Type: application/json\r\nContent-Length: ${String(body.length)}\r\n\r\n`,
      body,
    ]);

    expect(withoutBody.responses[0]?.status).toBe(404);
    const rejected = await rawRequest(port, [`${head('GET /api/nada')}\r\n`], { until: hasCompleteResponse });
    expect(rejected.responses[0]?.status).toBe(429);
    expect(rejected.responses[0]?.headers['connection']).not.toBe('close');
    expect(withBody.responses[0]?.status).toBe(429);
    expect(withBody.responses[0]?.headers['connection']).toBe('close');
    expect(withBody.closedByServer).toBe(true);
  });

  it('RF-G10: socket crudo con 20 KB y cupo general agotado da 429, conexión cerrada, nunca 413', async () => {
    const { port } = await listen(appWith({ max: 1 }));
    const auth = `Authorization: Bearer ${TEST_API_KEY}\r\n`;
    await rawRequest(port, [`GET /api/nada HTTP/1.1\r\nHost: localhost\r\n${auth}\r\n`], {
      until: hasCompleteResponse,
    });
    const body = 'a'.repeat(20 * 1024);

    const result = await rawRequest(port, [
      `POST /api/tasks HTTP/1.1\r\nHost: localhost\r\n${auth}Content-Type: text/plain\r\n` +
        `Content-Length: ${String(body.length)}\r\n\r\n`,
      body,
    ]);

    expect(result.responses[0]?.status).toBe(429);
    expect(result.responses[0]?.headers['connection']).toBe('close');
    expect(result.closedByServer).toBe(true);
    expect(result.text).not.toContain('413');
  });
});

describe('RF-G1: pares de orden con los cupos', () => {
  it('RF-G1 par 429-401: con el general agotado una key errónea da 429; sin agotar, 401', async () => {
    const wrong = `Bearer ${'x'.repeat(10)}${TEST_API_KEY.slice(10)}`;
    const control = appWith({ max: 1 });
    const app = appWith({ max: 1 });

    expect((await request(control).get('/api/nada').set('Authorization', wrong)).status).toBe(401);
    expect((await getNothing(app)).status).toBe(404);
    expect((await request(app).get('/api/nada').set('Authorization', wrong)).status).toBe(429);
    expect((await getNothing(app).set(OMIT_KEY_HEADER, '1')).status).toBe(429);
  });

  it('RF-G1 par P4-etapa 1: con el cupo de POST agotado, POST a /api/tasks/<uuid> (que daría 405) da 429', async () => {
    const app = appWith({ postMax: 1 });

    expect((await request(app).post(`/api/tasks/${UUID}`)).status).toBe(405);
    expect((await request(app).post(`/api/tasks/${UUID}`)).status).toBe(429);
  });
});

describe('RF-G18: la librería de cupos no escribe en la consola', () => {
  it('RF-G18: ni console ni process.stdout/stderr reciben nada con X-Forwarded-For y Forwarded presentes', async () => {
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'debug'),
      vi.spyOn(process.stdout, 'write'),
      vi.spyOn(process.stderr, 'write'),
    ];
    const app = appWith({ max: 2, postMax: 1 });

    for (let call = 0; call < 4; call += 1) {
      await getNothing(app).set('X-Forwarded-For', '203.0.113.9').set('Forwarded', 'for=203.0.113.9;proto=http');
      await postEmpty(app).set('X-Forwarded-For', '2001:db8::1').set('Forwarded', 'for="[2001:db8::1]"');
    }

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
    vi.restoreAllMocks();
  });
});
