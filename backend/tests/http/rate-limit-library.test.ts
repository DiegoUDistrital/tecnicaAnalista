import express, { type Express, type Request } from 'express';
import { MemoryStore, rateLimit, type RateLimitInfo } from 'express-rate-limit';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';

/**
 * Caracterización de `express-rate-limit` (versión exacta fijada en package.json): fija con tests lo que el código de
 * producción da por sabido de la librería. Nacen en verde porque describen código ajeno que ya existe.
 */
const WINDOW_MS = 60000;
const servers: LoopbackServer[] = [];
const stores: MemoryStore[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    await server.close();
  }
  for (const store of stores.splice(0)) {
    store.shutdown();
  }
});

interface Built {
  readonly app: Express;
  readonly store: MemoryStore;
  readonly infos: RateLimitInfo[];
}

/** App mínima con las opciones EXACTAS que usa producción; la clave sale de la cabecera `x-key` (o de una fija). */
function build(limit: number, options: { validate?: boolean } = {}): Built {
  const store = new MemoryStore();
  const infos: RateLimitInfo[] = [];
  const limiter = rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: false,
    legacyHeaders: false,
    validate: options.validate ?? false,
    store,
    keyGenerator: (req: Request) => (req.headers['x-key'] as string | undefined) ?? 'same',
    handler: (req, res) => {
      infos.push((req as unknown as Record<string, RateLimitInfo>)['rateLimit'] as RateLimitInfo);
      res.status(429).json({ limited: true });
    },
  });
  const app = express();
  app.use(limiter);
  app.get('/ok', (_req, res) => {
    res.json({ ok: true });
  });
  return { app, store, infos };
}

describe('RF-G7: express-rate-limit (A VERIFICAR de la versión instalada)', () => {
  it('RF-G7: opciones de producción aceptadas; la N+1 es la primera rechazada', async () => {
    const { app, infos } = build(3);

    const statuses: number[] = [];
    for (let call = 0; call < 5; call += 1) {
      statuses.push((await request(app).get('/ok')).status);
    }

    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(infos).toHaveLength(2);
  });

  it('RF-G10: con ambas cabeceras desactivadas no escribe Retry-After ni RateLimit-* ni X-RateLimit-*', async () => {
    const { app } = build(1);

    const allowed = await request(app).get('/ok');
    const rejected = await request(app).get('/ok');

    for (const response of [allowed, rejected]) {
      expect(Object.keys(response.headers).filter((name) => /ratelimit|retry-after/.test(name))).toEqual([]);
    }
  });

  it('RF-G10: el handler recibe req.rateLimit con limit, used, remaining y resetTime (Date)', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-01T10:00:00.000Z') });
    const { app, infos } = build(1);

    await request(app).get('/ok');
    vi.setSystemTime(new Date('2026-03-01T10:00:20.000Z'));
    await request(app).get('/ok');

    const [info] = infos;
    expect(info).toMatchObject({ limit: 1, used: 2, remaining: 0, key: 'same' });
    expect(info?.resetTime).toBeInstanceOf(Date);
    expect(info?.resetTime?.toISOString()).toBe('2026-03-01T10:01:00.000Z');
  });

  it('RF-G7: cada clave tiene su propia ventana desde su primera petición (no una ventana global)', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-01T10:00:00.000Z') });
    const { app, infos } = build(1);

    await request(app).get('/ok').set('x-key', 'a');
    vi.setSystemTime(new Date('2026-03-01T10:00:30.000Z'));
    await request(app).get('/ok').set('x-key', 'b');
    await request(app).get('/ok').set('x-key', 'a');
    await request(app).get('/ok').set('x-key', 'b');

    expect(infos.map((info) => info.resetTime?.toISOString())).toEqual([
      '2026-03-01T10:01:00.000Z',
      '2026-03-01T10:01:30.000Z',
    ]);
  });

  it('RF-G7: 20 simultáneas con cupo 5 dan exactamente 5 sin 429 y 15 con 429', async () => {
    const { app } = build(5);
    const server = await listenOnLoopback(app);
    servers.push(server);

    const statuses = await Promise.all(
      Array.from({ length: 20 }, async () => (await fetch(`http://127.0.0.1:${String(server.port)}/ok`)).status),
    );

    expect(statuses.filter((status) => status === 200)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(15);
  });

  it('RF-G18: con validate: false no escribe en consola con X-Forwarded-For y Forwarded', async () => {
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
      vi.spyOn(process.stdout, 'write'),
      vi.spyOn(process.stderr, 'write'),
    ];
    const { app } = build(1);

    await request(app).get('/ok').set('X-Forwarded-For', '203.0.113.7').set('Forwarded', 'for=203.0.113.7');
    await request(app).get('/ok').set('X-Forwarded-For', '203.0.113.7').set('Forwarded', 'for=203.0.113.7');

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('RF-G18: control positivo: con validate activado y la clave por defecto SÍ escribe en consola', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = new MemoryStore();
    stores.push(store);
    const app = express();
    app.use(rateLimit({ windowMs: WINDOW_MS, limit: 5, standardHeaders: false, legacyHeaders: false, store }));
    app.get('/ok', (_req, res) => {
      res.json({ ok: true });
    });

    await request(app).get('/ok').set('X-Forwarded-For', '203.0.113.7');

    expect(error).toHaveBeenCalled();
  });

  it('RF-G7: MemoryStore tiene shutdown() y su temporizador está sin referencia (unref) y se cancela al cerrar', () => {
    const timers: NodeJS.Timeout[] = [];
    const realSetInterval = global.setInterval.bind(global);
    vi.spyOn(global, 'setInterval').mockImplementation(((...args: Parameters<typeof setInterval>) => {
      const timer = realSetInterval(...args);
      timers.push(timer);
      return timer;
    }) as typeof setInterval);
    const clear = vi.spyOn(global, 'clearInterval');

    const { store } = build(1);

    expect(timers).toHaveLength(1);
    expect(timers[0]?.hasRef()).toBe(false);
    store.shutdown();
    expect(clear).toHaveBeenCalledWith(timers[0]);
    expect(() => {
      store.shutdown();
    }).not.toThrow();
  });
});
