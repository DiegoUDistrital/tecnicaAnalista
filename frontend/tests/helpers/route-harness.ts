import type { FrontendConfig } from '../../src/server/config/frontend-config';
import { createLogger } from '../../src/server/logging/logger';
import { createRouteHandler, type RouteContext, type RouteHandler } from '../../src/server/proxy/handlers';
import { createFakeFetch, fakeResponse, type RecordedCall } from './fake-fetch';

export const SENTINEL_KEY = 'SENTINEL-KEY-0123456789abcdefghijklmnopqrstuvwxyz';
export const SENTINEL_BACKEND = 'http://backend-sentinel.internal:4000';
export const SENTINEL_DATABASE = 'postgresql://reader:SENTINEL-DBPASS@db-sentinel.internal:5432/todo';
export const BASE = 'http://localhost:3001';
export const ID = '3f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6b';
export const TASK = {
  id: ID,
  title: 'Comprar pan',
  description: '',
  completed: false,
  createdAt: '2026-01-31T10:00:00.000Z',
};

export function makeConfig(allowedHosts?: readonly string[]): FrontendConfig {
  return { backendUrl: SENTINEL_BACKEND, apiKey: SENTINEL_KEY, readerDatabaseUrl: SENTINEL_DATABASE, allowedHosts };
}

/** Express simulado que responde bien a cada método. */
export function happyExpress(call: RecordedCall) {
  const method = call.init.method;
  if (method === 'DELETE') {
    return fakeResponse({ status: 204 });
  }
  if (method === 'GET') {
    return fakeResponse({ status: 200, body: JSON.stringify([TASK]) });
  }
  return fakeResponse({ status: method === 'POST' ? 201 : 200, body: JSON.stringify(TASK) });
}

export interface Harness {
  collection: RouteHandler;
  item: RouteHandler;
  calls: RecordedCall[];
  logs: string[];
}

export function createHarness(
  options: {
    allowedHosts?: readonly string[];
    express?: Parameters<typeof createFakeFetch>[0];
    getConfig?: () => FrontendConfig;
  } = {},
): Harness {
  const { fetchImpl, calls } = createFakeFetch(options.express ?? happyExpress);
  const logs: string[] = [];
  const logger = createLogger({ write: (line) => logs.push(line) });
  const config = makeConfig(options.allowedHosts);
  const deps = { getConfig: options.getConfig ?? (() => config), logger, fetchImpl };
  return {
    collection: createRouteHandler('collection', deps),
    item: createRouteHandler('item', deps),
    calls,
    logs,
  };
}

export function itemContext(id: string = ID): RouteContext {
  return { params: Promise.resolve({ id }) };
}

/** Cabeceras de un navegador que escribe desde la propia página. */
export function browserHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { host: 'localhost:3001', origin: BASE, 'content-type': 'application/json', ...extra };
}

export async function bodyOf(response: Response): Promise<{ text: string; json: unknown }> {
  const text = await response.text();
  return { text, json: text === '' ? undefined : (JSON.parse(text) as unknown) };
}
