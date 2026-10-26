import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forward, type ForwardOptions } from '../../src/server/proxy/backend-client';
import { createFakeFetch, fakeResponse } from '../helpers/fake-fetch';

const CONFIG = { backendUrl: 'http://127.0.0.1:3000', apiKey: 'test-key-0123456789abcdefghijklmnopqrstuvwxyz' };
const ID = '3f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6b';
const TASK_JSON = JSON.stringify({
  id: ID,
  title: 'a',
  description: '',
  completed: false,
  createdAt: '2026-01-31T10:00:00Z',
});

const json = (status: number, body: string = TASK_JSON) =>
  fakeResponse({ status, headers: { 'Content-Type': 'application/json' }, body });

/** Flujo que no se lee hasta que alguien lo pide (HWM 0): cuenta lecturas y cancelaciones. */
function lazyStream(): { stream: ReadableStream<Uint8Array>; stats: { pulls: number; cancelled: boolean } } {
  const stats = { pulls: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        stats.pulls += 1;
        controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        stats.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, stats };
}

describe('forward', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const run = (options: Partial<ForwardOptions> & Pick<ForwardOptions, 'method' | 'fetchImpl'>) =>
    forward({ config: CONFIG, ...options });

  it('RF-F17: reenvía método, URL exacta (con ?completed=true|false solo en GET con filtro) e id', async () => {
    const { fetchImpl, calls } = createFakeFetch(() => json(200, '[]'));
    await run({ method: 'GET', fetchImpl });
    await run({ method: 'GET', filter: 'completed', fetchImpl });
    await run({ method: 'GET', filter: 'pending', fetchImpl });
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['GET', 'http://127.0.0.1:3000/api/tasks'],
      ['GET', 'http://127.0.0.1:3000/api/tasks?completed=true'],
      ['GET', 'http://127.0.0.1:3000/api/tasks?completed=false'],
    ]);
    const writes = createFakeFetch((call) =>
      call.init.method === 'DELETE' ? fakeResponse({ status: 204 }) : json(200),
    );
    await run({ method: 'POST', bodyText: '{"title":"a"}', fetchImpl: writes.fetchImpl });
    await run({ method: 'PUT', id: ID, bodyText: '{"completed":true}', fetchImpl: writes.fetchImpl });
    await run({ method: 'DELETE', id: ID, fetchImpl: writes.fetchImpl });
    expect(writes.calls.map((c) => [c.init.method, c.url, c.init.body])).toEqual([
      ['POST', 'http://127.0.0.1:3000/api/tasks', '{"title":"a"}'],
      ['PUT', `http://127.0.0.1:3000/api/tasks/${ID}`, '{"completed":true}'],
      ['DELETE', `http://127.0.0.1:3000/api/tasks/${ID}`, undefined],
    ]);
  });

  it('RF-I1: nunca se envía X-Forwarded-For, Forwarded, X-Real-IP, X-Forwarded-Host ni X-Forwarded-Proto', async () => {
    const forbidden = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'x-forwarded-host', 'x-forwarded-proto'];
    const { fetchImpl, calls } = createFakeFetch((call) =>
      call.init.method === 'DELETE' ? fakeResponse({ status: 204 }) : json(200, '[]'),
    );
    await run({ method: 'GET', fetchImpl });
    await run({ method: 'POST', bodyText: '{"title":"a"}', fetchImpl });
    await run({ method: 'PUT', id: ID, bodyText: '{"completed":true}', fetchImpl });
    await run({ method: 'DELETE', id: ID, fetchImpl });
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      const names = Object.keys(call.init.headers as Record<string, string>).map((name) => name.toLowerCase());
      expect(names.filter((name) => forbidden.includes(name))).toEqual([]);
      expect(names).toEqual(call.init.body === undefined ? ['authorization'] : ['authorization', 'content-type']);
    }
  });

  it('RF-F22: usa redirect manual y no reintenta (una sola llamada) ni ante error ni ante 429', async () => {
    const failing = createFakeFetch(() => Promise.reject(new Error('boom')));
    expect(await run({ method: 'POST', bodyText: '{}', fetchImpl: failing.fetchImpl })).toMatchObject({
      kind: 'unreachable',
    });
    expect(failing.calls).toHaveLength(1);
    expect(failing.calls[0]?.init).toMatchObject({ redirect: 'manual', cache: 'no-store' });
    const limited = createFakeFetch(() => fakeResponse({ status: 429, headers: { 'Retry-After': '7' } }));
    expect(await run({ method: 'GET', fetchImpl: limited.fetchImpl })).toEqual({
      kind: 'rate_limited',
      retryAfter: '7',
    });
    expect(limited.calls).toHaveLength(1);
    const missing = createFakeFetch(() => fakeResponse({ status: 429 }));
    expect(await run({ method: 'GET', fetchImpl: missing.fetchImpl })).toEqual({
      kind: 'rate_limited',
      retryAfter: null,
    });
  });

  it('RF-F22: al agotar 15 s cancela la petición y devuelve timeout', async () => {
    let signal: AbortSignal | undefined;
    const { fetchImpl } = createFakeFetch(({ init }) => {
      signal = init.signal ?? undefined;
      return new Promise(() => undefined);
    });
    const pending = run({ method: 'GET', fetchImpl });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect(await pending).toEqual({ kind: 'timeout' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('RF-F22: el plazo cubre también la lectura del cuerpo de la respuesta', async () => {
    const hanging = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined) });
    const { fetchImpl } = createFakeFetch(() => fakeResponse({ status: 200, body: hanging }));
    const pending = run({ method: 'GET', fetchImpl });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toEqual({ kind: 'timeout' });
  });

  it('RF-F22: si el navegador cancela, cancela la de Express y no devuelve error registrable', async () => {
    const browser = new AbortController();
    let signal: AbortSignal | undefined;
    const { fetchImpl } = createFakeFetch(({ init }) => {
      signal = init.signal ?? undefined;
      return new Promise(() => undefined);
    });
    const pending = run({ method: 'GET', browserSignal: browser.signal, fetchImpl });
    browser.abort();
    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const already = AbortSignal.abort();
    const second = createFakeFetch(() => json(200, '[]'));
    expect(await run({ method: 'GET', browserSignal: already, fetchImpl: second.fetchImpl })).toEqual({
      kind: 'cancelled',
    });
  });

  it('RF-F22: conexión rechazada devuelve unreachable con el error', async () => {
    const error = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const { fetchImpl } = createFakeFetch(() => Promise.reject(error));
    expect(await run({ method: 'GET', fetchImpl })).toEqual({ kind: 'unreachable', error });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('RF-F20: respuestas de éxito entregan el JSON analizado; DELETE 204 sin cuerpo', async () => {
    const get = createFakeFetch(() => json(200, '[]'));
    expect(await run({ method: 'GET', fetchImpl: get.fetchImpl })).toEqual({ kind: 'ok', body: [] });
    const post = createFakeFetch(() => json(201));
    expect(await run({ method: 'POST', bodyText: '{}', fetchImpl: post.fetchImpl })).toEqual({
      kind: 'ok',
      body: JSON.parse(TASK_JSON) as unknown,
    });
    const del = createFakeFetch(() => fakeResponse({ status: 204 }));
    expect(await run({ method: 'DELETE', id: ID, fetchImpl: del.fetchImpl })).toEqual({ kind: 'ok', body: undefined });
  });

  it.each([
    ['JSON roto', 'GET', 200, '{"a":'],
    ['cuerpo vacío', 'GET', 200, ''],
    ['UTF-8 inválido', 'GET', 200, new Uint8Array([0xff, 0xfe])],
    ['POST 201 con JSON roto', 'POST', 201, 'x'],
    ['204 con cuerpo', 'DELETE', 204, '{}'],
  ] as const)('RF-F20: %s es invalid', async (_name, method, status, body) => {
    const { fetchImpl } = createFakeFetch(() => fakeResponse({ status, body }));
    expect(await run({ method, id: method === 'DELETE' ? ID : undefined, bodyText: '{}', fetchImpl })).toEqual({
      kind: 'invalid',
    });
  });

  it('RF-F20: una respuesta de más de 8 MiB se corta, cancela la lectura y devuelve invalid', async () => {
    const { stream, stats } = lazyStream();
    const { fetchImpl } = createFakeFetch(() => fakeResponse({ status: 200, body: stream }));
    const result = await run({ method: 'GET', maxResponseBytes: 4096, fetchImpl });
    expect(result).toEqual({ kind: 'invalid' });
    expect(stats.pulls).toBeLessThan(10);
    expect(stats.cancelled).toBe(true);
    const exact = createFakeFetch(() => fakeResponse({ status: 200, body: `[${' '.repeat(8 * 1024 * 1024 - 2)}]` }));
    expect(await run({ method: 'GET', fetchImpl: exact.fetchImpl })).toEqual({ kind: 'ok', body: [] });
    const over = createFakeFetch(() => fakeResponse({ status: 200, body: `[${' '.repeat(8 * 1024 * 1024 - 1)}]` }));
    expect(await run({ method: 'GET', fetchImpl: over.fetchImpl })).toEqual({ kind: 'invalid' });
  });

  it('RF-F20: el 400 de POST y PUT se lee; 404 y 413 se clasifican; el resto es unexpected', async () => {
    const validation = '{"error":{"code":"VALIDATION_ERROR","details":[]}}';
    for (const method of ['POST', 'PUT'] as const) {
      const bad = createFakeFetch(() => json(400, validation));
      expect(await run({ method, id: ID, bodyText: '{}', fetchImpl: bad.fetchImpl })).toEqual({
        kind: 'validation',
        body: JSON.parse(validation) as unknown,
      });
      const broken = createFakeFetch(() => json(400, 'no es json'));
      expect(await run({ method, id: ID, bodyText: '{}', fetchImpl: broken.fetchImpl })).toEqual({ kind: 'invalid' });
      const large = createFakeFetch(() => fakeResponse({ status: 413 }));
      expect(await run({ method, id: ID, bodyText: '{}', fetchImpl: large.fetchImpl })).toEqual({ kind: 'too_large' });
    }
    for (const method of ['PUT', 'DELETE'] as const) {
      const gone = createFakeFetch(() => fakeResponse({ status: 404 }));
      expect(await run({ method, id: ID, bodyText: '{}', fetchImpl: gone.fetchImpl })).toEqual({ kind: 'not_found' });
    }
    const cases: [ForwardOptions['method'], number][] = [
      ['GET', 400],
      ['DELETE', 400],
      ['GET', 404],
      ['POST', 404],
      ['GET', 413],
      ['DELETE', 413],
      ['GET', 401],
      ['GET', 500],
      ['GET', 302],
      ['GET', 204],
      ['DELETE', 200],
      ['POST', 200],
      ['PUT', 201],
    ];
    for (const [method, status] of cases) {
      const other = createFakeFetch(() => fakeResponse({ status }));
      expect(await run({ method, id: ID, bodyText: '{}', fetchImpl: other.fetchImpl })).toEqual({
        kind: 'unexpected',
        status,
      });
    }
  });

  it('RF-F20: en errores de Express (salvo el 400 de POST y PUT) no se lee el cuerpo, solo se cancela', async () => {
    const cases: [ForwardOptions['method'], number][] = [
      ['GET', 400],
      ['GET', 401],
      ['GET', 404],
      ['PUT', 404],
      ['POST', 413],
      ['GET', 429],
      ['POST', 500],
      ['GET', 302],
    ];
    for (const [method, status] of cases) {
      const { stream, stats } = lazyStream();
      const { fetchImpl } = createFakeFetch(() => fakeResponse({ status, body: stream }));
      await run({ method, id: ID, bodyText: '{}', fetchImpl });
      expect(stats.pulls).toBe(0);
      expect(stats.cancelled).toBe(true);
    }
  });
});
