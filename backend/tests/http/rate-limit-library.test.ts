import express, { type Express, type Request } from 'express';
import { MemoryStore, rateLimit, type RateLimitInfo } from 'express-rate-limit';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Caracterización de `express-rate-limit` (versión exacta fijada en package.json): fija con tests lo que el código de
 * producción da por sabido de la librería. Nacen en verde porque describen código ajeno que ya existe.
 */
const WINDOW_MS = 60000;
const stores: MemoryStore[] = [];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
});
