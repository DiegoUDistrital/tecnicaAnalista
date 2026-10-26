import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forward, type FetchLike } from '../../src/server/proxy/backend-client';

// A VERIFICAR (T8): comportamiento del `fetch` real de este Node con un servidor local mínimo.
let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/api/tasks' }).end();
    } else if (req.url?.startsWith('/empty') === true) {
      res.writeHead(204).end();
    } else if (req.url === '/stall') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('[');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('[]');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe('fetch real (A VERIFICAR)', () => {
  it('RF-F22: redirect manual entrega el 3xx real', async () => {
    const response = await fetch(`${origin}/redirect`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    await response.body?.cancel();
  });

  it('RF-F20: una respuesta 204 llega con cuerpo nulo', async () => {
    const response = await fetch(`${origin}/empty`, { method: 'DELETE' });
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it('RF-F22: abortar la señal rechaza la lectura del cuerpo', async () => {
    const controller = new AbortController();
    const response = await fetch(`${origin}/stall`, { signal: controller.signal });
    const reader = response.body?.getReader();
    await reader?.read();
    const pending = reader?.read();
    controller.abort();
    await expect(pending).rejects.toBeDefined();
  });

  it('RF-F22: forward con fetch real clasifica 200, 3xx, 204 y un cuerpo colgado', async () => {
    const config = { backendUrl: origin, apiKey: 'k' };
    const via =
      (path: string): FetchLike =>
      (url, init) =>
        fetch(url.replace('/api/tasks', path), init);
    expect(await forward({ config, method: 'GET' })).toEqual({ kind: 'ok', body: [] });
    expect(await forward({ config, method: 'GET', fetchImpl: via('/redirect') })).toEqual({
      kind: 'unexpected',
      status: 302,
    });
    expect(await forward({ config, method: 'DELETE', id: 'x', fetchImpl: via('/empty') })).toEqual({
      kind: 'ok',
      body: undefined,
    });
    const stalled = await forward({ config, method: 'GET', fetchImpl: via('/stall'), timeoutMs: 100 });
    expect(stalled).toEqual({ kind: 'timeout' });
  });
});
