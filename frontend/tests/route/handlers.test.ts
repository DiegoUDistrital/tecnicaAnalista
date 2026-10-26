import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConfigProvider } from '../../src/server/config/frontend-config';
import { createLogger } from '../../src/server/logging/logger';
import { createRouteHandler } from '../../src/server/proxy/handlers';
import { fakeResponse } from '../helpers/fake-fetch';
import {
  BASE,
  bodyOf,
  browserHeaders,
  createHarness,
  ID,
  itemContext,
  makeConfig,
  SENTINEL_BACKEND,
  SENTINEL_KEY,
  TASK,
} from '../helpers/route-harness';

const OK_BODY = '{"title":"Comprar pan"}';
const ITEM_URL = `${BASE}/api/tasks/${ID}`;

afterEach(() => {
  vi.useRealTimers();
});

const json = (url: string, method: string, headers: Record<string, string> = {}, body?: string): Request =>
  new Request(url, { method, headers: browserHeaders(headers), body });

describe('rutas: las cuatro operaciones', () => {
  it('RF-F17: GET y POST en /api/tasks y PUT y DELETE en /api/tasks/<id> reenvían a la misma ruta con Bearer', async () => {
    const h = createHarness();
    const list = await h.collection(
      new Request(`${BASE}/api/tasks?filter=completed`, { headers: { host: 'localhost:3001' } }),
    );
    const created = await h.collection(json(`${BASE}/api/tasks`, 'POST', {}, OK_BODY));
    const updated = await h.item(json(ITEM_URL, 'PUT', {}, OK_BODY), itemContext());
    const removed = await h.item(json(ITEM_URL, 'DELETE'), itemContext());
    expect([list.status, created.status, updated.status, removed.status]).toEqual([200, 201, 200, 204]);
    expect((await bodyOf(created)).json).toEqual(TASK);
    expect(h.calls.map((call) => [call.init.method, call.url])).toEqual([
      ['GET', `${SENTINEL_BACKEND}/api/tasks?completed=true`],
      ['POST', `${SENTINEL_BACKEND}/api/tasks`],
      ['PUT', `${SENTINEL_BACKEND}/api/tasks/${ID}`],
      ['DELETE', `${SENTINEL_BACKEND}/api/tasks/${ID}`],
    ]);
    for (const call of h.calls) {
      expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SENTINEL_KEY}`);
    }
    expect(h.calls[2]?.init.body).toBe(OK_BODY);
  });

  it('RF-F17: los 405 llevan Allow fijo, no tocan Express y HEAD no lleva cuerpo', async () => {
    const h = createHarness();
    const patch = await h.collection(json(`${BASE}/api/tasks`, 'PATCH', {}, OK_BODY));
    expect(patch.status).toBe(405);
    expect(patch.headers.get('Allow')).toBe('GET, POST');
    expect(patch.headers.get('Cache-Control')).toBe('no-store');
    expect((await bodyOf(patch)).json).toEqual({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Operación no permitida.', details: [] },
    });
    const head = await h.item(json(ITEM_URL, 'HEAD'), itemContext());
    expect(head.status).toBe(405);
    expect(head.headers.get('Allow')).toBe('PUT, DELETE');
    expect(await head.text()).toBe('');
    expect(h.calls).toHaveLength(0);
  });

  it('RF-F17: el 405 no lee la configuración', async () => {
    const getConfig = vi.fn(() => makeConfig());
    const h = createHarness({ getConfig });
    await h.collection(json(`${BASE}/api/tasks`, 'OPTIONS'));
    expect(getConfig).not.toHaveBeenCalled();
  });
});

describe('rutas: cabeceras hacia Express', () => {
  it('RF-F18, RF-I1: ninguna cabecera del navegador llega a Express; solo Authorization y Content-Type', async () => {
    const h = createHarness();
    const hostile = {
      cookie: 'sid=abc',
      authorization: 'Bearer falsa',
      'x-forwarded-for': '1.2.3.4',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https',
      forwarded: 'for=1.2.3.4',
      'x-real-ip': '1.2.3.4',
      referer: 'http://localhost:3001/',
      'content-encoding': 'identity',
    };
    await h.collection(json(`${BASE}/api/tasks`, 'POST', hostile, OK_BODY));
    await h.item(json(ITEM_URL, 'DELETE', hostile), itemContext());
    const [postHeaders, deleteHeaders] = h.calls.map((call) => call.init.headers as Record<string, string>);
    expect(Object.keys(postHeaders ?? {}).sort()).toEqual(['Authorization', 'Content-Type']);
    expect(Object.keys(deleteHeaders ?? {})).toEqual(['Authorization']);
    expect(postHeaders?.Authorization).toBe(`Bearer ${SENTINEL_KEY}`);
  });

  it('RF-I1: ninguna cabecera de IP sale hacia Express aunque Express responda 400, 404, 429 o 500', async () => {
    const forbidden = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'x-forwarded-host', 'x-forwarded-proto'];
    const hostile = { 'x-forwarded-for': '203.0.113.99', forwarded: 'for=203.0.113.99', 'x-real-ip': '203.0.113.99' };
    for (const status of [400, 404, 429, 500]) {
      const h = createHarness({ express: () => fakeResponse({ status, body: '{"error":{"code":"X"}}' }) });
      await h.collection(json(`${BASE}/api/tasks`, 'POST', hostile, OK_BODY));
      await h.collection(new Request(`${BASE}/api/tasks`, { headers: { host: 'localhost:3001', ...hostile } }));
      await h.item(json(ITEM_URL, 'PUT', hostile, OK_BODY), itemContext());
      await h.item(json(ITEM_URL, 'DELETE', hostile), itemContext());
      expect(h.calls).toHaveLength(4);
      for (const call of h.calls) {
        const names = Object.keys(call.init.headers as Record<string, string>).map((name) => name.toLowerCase());
        expect(names.filter((name) => forbidden.includes(name))).toEqual([]);
      }
    }
  });

  it('RF-I3: un X-Forwarded-For centinela no aparece en el cuerpo, las cabeceras ni lo registrado', async () => {
    const sentinel = '203.0.113.99';
    const out: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => out.push(String(chunk)) > 0);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => out.push(String(chunk)) > 0);
    try {
      const hostile = { 'x-forwarded-for': sentinel, forwarded: `for=${sentinel}`, 'x-real-ip': sentinel };
      const seen: string[] = [];
      for (const status of [200, 400, 429, 500]) {
        const h = createHarness({ express: () => fakeResponse({ status, body: '{"error":{"code":"X"}}' }) });
        const responses = [
          await h.collection(json(`${BASE}/api/tasks`, 'POST', hostile, OK_BODY)),
          await h.collection(new Request(`${BASE}/api/tasks`, { headers: { host: 'localhost:3001', ...hostile } })),
          await h.item(json(ITEM_URL, 'DELETE', hostile), itemContext()),
        ];
        for (const response of responses) {
          seen.push(JSON.stringify([...response.headers.entries()]), await response.text());
        }
        seen.push(...h.logs, JSON.stringify(h.calls));
      }
      expect(seen.length).toBeGreaterThan(0);
      expect([...seen, ...out].join('\n')).not.toContain(sentinel);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});

describe('rutas: fallos de Express y del servidor', () => {
  it('RF-F22: caída de Express (rechazo y plazo agotado) no impide atender la siguiente petición', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const h = createHarness({
      express: () => {
        attempt += 1;
        if (attempt === 1) {
          return Promise.reject(Object.assign(new Error('boom'), { code: 'ECONNREFUSED' }));
        }
        if (attempt === 2) {
          return new Promise(() => undefined);
        }
        return fakeResponse({ status: 200, body: JSON.stringify([TASK]) });
      },
    });
    const list = (): Promise<Response> =>
      h.collection(new Request(`${BASE}/api/tasks`, { headers: { host: 'localhost:3001' } }));
    const refused = await list();
    expect(refused.status).toBe(502);
    const slow = list();
    await vi.advanceTimersByTimeAsync(15_000);
    const timedOut = await slow;
    expect(timedOut.status).toBe(504);
    expect((await list()).status).toBe(200);
    expect(h.logs).toHaveLength(1);
    expect(JSON.parse(h.logs[0] ?? '')).toMatchObject({
      event: 'route_failed',
      method: 'GET',
      route: '/api/tasks',
      errorName: 'Error',
      errorCode: 'ECONNREFUSED',
    });
  });

  it('RF-F22: si el navegador cancela, no se registra error', async () => {
    const controller = new AbortController();
    const h = createHarness({ express: () => new Promise(() => undefined) });
    const pending = h.collection(
      new Request(`${BASE}/api/tasks`, { headers: { host: 'localhost:3001' }, signal: controller.signal }),
    );
    controller.abort();
    await pending;
    expect(h.logs).toHaveLength(0);
  });

  it('RF-F30: en cada 403 Express no recibe petición (también con ALLOWED_HOSTS)', async () => {
    const h = createHarness({ allowedHosts: ['localhost:3001'] });
    const wrongHost = new Request(`${BASE}/api/tasks`, { headers: { host: 'evil.example' } });
    expect((await h.collection(wrongHost)).status).toBe(403);
    const crossSite = json(`${BASE}/api/tasks`, 'POST', { 'sec-fetch-site': 'cross-site' }, OK_BODY);
    expect((await h.collection(crossSite)).status).toBe(403);
    expect(h.calls).toHaveLength(0);
    const same = new Request(`${BASE}/api/tasks`, { headers: { host: 'localhost:3001' } });
    expect((await h.collection(same)).status).toBe(200);
  });

  it('RF-F31: un error inesperado responde 500 genérico y registra solo route_failed con clase y código', async () => {
    const failing = Object.assign(new TypeError('postgresql://reader:SECRET@db/x'), { code: 'ECONNRESET' });
    const h = createHarness({
      getConfig: () => {
        throw failing;
      },
    });
    const response = await h.item(json(ITEM_URL, 'DELETE'), itemContext());
    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await bodyOf(response)).json).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'El servicio no está disponible. Inténtalo más tarde.',
        details: [],
      },
    });
    expect(h.logs).toHaveLength(1);
    const line = JSON.parse(h.logs[0] ?? '') as Record<string, unknown>;
    expect(Object.keys(line)).toEqual(['time', 'level', 'event', 'method', 'route', 'errorName', 'errorCode']);
    expect(line).toMatchObject({
      event: 'route_failed',
      method: 'DELETE',
      route: '/api/tasks/:id',
      errorName: 'TypeError',
      errorCode: 'ECONNRESET',
    });
    expect(h.logs[0]).not.toContain('SECRET');
  });

  it('RF-F23: con configuración inválida las rutas responden 500 y los nombres se registran UNA vez (plan B)', async () => {
    const logs: string[] = [];
    const logger = createLogger({ write: (line) => logs.push(line) });
    const getConfig = createConfigProvider({ readEnv: () => ({ API_KEY: 'corta' }), logger });
    const deps = { getConfig, logger, fetchImpl: () => Promise.reject(new Error('no debe llamarse')) };
    const collection = createRouteHandler('collection', deps);
    const item = createRouteHandler('item', deps);
    const first = await collection(new Request(`${BASE}/api/tasks`, { headers: { host: 'localhost:3001' } }));
    const second = await item(json(ITEM_URL, 'DELETE'), itemContext());
    expect([first.status, second.status]).toEqual([500, 500]);
    expect(((await bodyOf(first)).json as { error: { code: string } }).error.code).toBe('INTERNAL_ERROR');
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0] ?? '')).toMatchObject({
      event: 'config_invalid',
      variables: ['BACKEND_URL', 'API_KEY', 'READER_DATABASE_URL'],
    });
  });
});
