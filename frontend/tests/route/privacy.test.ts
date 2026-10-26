import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeView } from '../../src/components/home-view';
import { createConfigProvider } from '../../src/server/config/frontend-config';
import { readCounters } from '../../src/server/counters/counters';
import { createLogger } from '../../src/server/logging/logger';
import { createRouteHandler } from '../../src/server/proxy/handlers';
import { createFakeFetch, fakeResponse, type RecordedCall } from '../helpers/fake-fetch';
import {
  BASE,
  browserHeaders,
  ID,
  itemContext,
  makeConfig,
  SENTINEL_BACKEND,
  SENTINEL_DATABASE,
  SENTINEL_KEY,
  TASK,
} from '../helpers/route-harness';

// HomeView monta TaskManager, que usa `useRouter`: fuera de Next hay que simularlo (aquí solo importa el HTML).
vi.mock('next/navigation', async () => (await import('../helpers/router-mock')).navigationMock);
const SENTINELS = [SENTINEL_KEY, SENTINEL_BACKEND, SENTINEL_DATABASE, 'SENTINEL-DBPASS', 'backend-sentinel'];
const ALLOWED_KEYS = ['time', 'level', 'event', 'method', 'route', 'status', 'errorName', 'errorCode', 'variables'];
const LEAK = `fallo en ${SENTINEL_BACKEND} con ${SENTINEL_KEY} SELECT * FROM tasks at /srv/app.js:10`;

let captured: string[];

beforeEach(() => {
  captured = [];
  const capture = (chunk: unknown): boolean => {
    captured.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture);
  for (const name of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, name).mockImplementation((...args: unknown[]) => {
      captured.push(args.map(String).join(' '));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function leakyExpress(call: RecordedCall) {
  const attempt = Number(new URL(call.url, 'http://x').searchParams.get('n') ?? 0);
  const echo = { 'X-Leak': LEAK, 'Retry-After': LEAK, Location: SENTINEL_BACKEND };
  switch (call.init.method) {
    case 'GET':
      return fakeResponse({ status: 500, headers: echo, body: LEAK });
    case 'POST':
      return fakeResponse({
        status: 400,
        headers: echo,
        body: JSON.stringify({
          error: { code: 'VALIDATION_ERROR', message: LEAK, details: [{ field: 'title', message: LEAK }] },
        }),
      });
    case 'PUT':
      return fakeResponse({ status: 200, headers: echo, body: `{"id":"${LEAK}"` + attempt });
    default:
      return fakeResponse({ status: 429, headers: echo, body: LEAK });
  }
}

async function everything(response: Response): Promise<string> {
  const headers = [...response.headers.entries()].flat().join('\n');
  return `${headers}\n${await response.text()}`;
}

describe('privacidad de las rutas', () => {
  it('RF-F21: ni las respuestas ni lo capturado contienen la key ni las URL centinela', async () => {
    const logger = createLogger();
    const unreachable = (): Promise<never> => Promise.reject(Object.assign(new Error(LEAK), { code: 'ECONNREFUSED' }));
    const cases: [boolean, string][] = [
      [false, 'GET'],
      [false, 'POST'],
      [false, 'PUT'],
      [false, 'DELETE'],
      [true, 'GET'],
      [true, 'POST'],
    ];
    const outputs: string[] = [];
    for (const [fails, method] of cases) {
      const { fetchImpl } = fails ? { fetchImpl: unreachable } : createFakeFetch(leakyExpress);
      const deps = { getConfig: () => makeConfig(), logger, fetchImpl };
      const collection = createRouteHandler('collection', deps);
      const item = createRouteHandler('item', deps);
      const hasBody = method === 'POST' || method === 'PUT';
      const body = hasBody ? '{"title":"a"}' : undefined;
      const headers = browserHeaders();
      outputs.push(
        await everything(
          method === 'POST' || method === 'GET'
            ? await collection(new Request(`${BASE}/api/tasks`, { method, headers, body }))
            : await item(new Request(`${BASE}/api/tasks/${ID}`, { method, headers, body }), itemContext()),
        ),
      );
    }
    const text = [...outputs, ...captured].join('\n');
    for (const sentinel of SENTINELS) {
      expect(text).not.toContain(sentinel);
    }
    expect(text).not.toContain('SELECT');
    expect(captured.length).toBeGreaterThan(0);
  });

  it('RF-F31: cada línea registrada tiene solo claves de la lista cerrada', async () => {
    const logger = createLogger();
    const unreachable = (): Promise<never> => Promise.reject(Object.assign(new Error(LEAK), { code: 'ECONNREFUSED' }));
    const deps = { getConfig: () => makeConfig(), logger, fetchImpl: unreachable };
    await createRouteHandler(
      'collection',
      deps,
    )(new Request(`${BASE}/api/tasks`, { headers: { host: 'localhost:3001' } }));
    const broken = {
      ...deps,
      getConfig: (): never => {
        throw new Error(LEAK);
      },
    };
    await createRouteHandler('item', broken)(
      new Request(`${BASE}/api/tasks/${ID}`, { method: 'DELETE', headers: browserHeaders() }),
      itemContext(),
    );
    const invalid = createConfigProvider({ readEnv: () => ({ API_KEY: LEAK }), logger });
    await createRouteHandler('collection', { ...deps, getConfig: invalid })(
      new Request(`${BASE}/api/tasks`, { headers: { host: 'localhost:3001' } }),
    );
    const lines = captured.filter((line) => line.trim() !== '');
    expect(lines.length).toBe(3);
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(parsed).every((key) => ALLOWED_KEYS.includes(key))).toBe(true);
    }
  });

  it('RF-F4/F31: la página con contadores que fallan con centinelas tampoco las deja en la salida', async () => {
    const database = () => ({
      $queryRaw: () => Promise.reject(Object.assign(new Error(LEAK), { code: 'ECONNREFUSED' })),
    });
    const counters = await readCounters({ database });
    const html = renderToStaticMarkup(HomeView({ filter: 'all', counters }));
    expect(html).toContain('No se pudieron cargar los contadores.');
    const text = [html, ...captured].join('\n');
    for (const sentinel of SENTINELS) {
      expect(text).not.toContain(sentinel);
    }
    expect(captured).toHaveLength(1);
    expect(Object.keys(JSON.parse(captured[0] ?? '') as object)).toEqual([
      'time',
      'level',
      'event',
      'errorName',
      'errorCode',
    ]);
    expect(TASK.id).toBe(ID);
  });
});
