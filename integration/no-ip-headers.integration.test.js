import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPortFree } from '../scripts/lib/ports.js';
import { assertNoIpHeaders, FORBIDDEN_HEADERS } from '../scripts/testing/assert-no-ip-headers.js';
import { startStubExpress } from '../scripts/testing/stub-express.js';
import { buildFrontend } from './helpers/build-frontend.js';
import { sendRequest } from './helpers/http-client.js';
import { startFrontend, TEST_API_KEY } from './helpers/start-frontend.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STUB_PORT = 3110;
const FRONTEND_PORT = 3111;
const DEV_PORT = 3001;
const TASK_ID = '3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b';
const HOST = `127.0.0.1:${FRONTEND_PORT}`;

/** Cabeceras hostiles que el cliente envía en los doce casos. */
const HOSTILE = {
  Forwarded: 'for=198.51.100.50',
  'X-Real-IP': '198.51.100.51',
  'X-Forwarded-Host': 'evil.example',
  'X-Forwarded-Proto': 'https',
  Cookie: 'session=sentinel-cookie',
  Referer: `http://${HOST}/`,
};

/**
 * Los tres casos de `X-Forwarded-For`: ninguno, uno falsificado de 1 entrada y uno de 3 entradas.
 * @type {Array<{ name: string, headers: Record<string, string> }>}
 */
const FORWARDED_CASES = [
  { name: 'sin cabecera', headers: {} },
  { name: 'una entrada falsificada', headers: { 'X-Forwarded-For': '203.0.113.9' } },
  {
    name: 'tres entradas falsificadas',
    headers: { 'X-Forwarded-For': '203.0.113.9, 198.51.100.7, 192.0.2.1' },
  },
];

/** Las cuatro operaciones del navegador hacia las API Routes del frontend. */
const OPERATIONS = [
  { name: 'GET', method: 'GET', path: '/api/tasks', status: 200 },
  { name: 'POST', method: 'POST', path: '/api/tasks', status: 201, body: '{"title":"t","description":""}' },
  { name: 'PUT', method: 'PUT', path: `/api/tasks/${TASK_ID}`, status: 200, body: '{"completed":true}' },
  { name: 'DELETE', method: 'DELETE', path: `/api/tasks/${TASK_ID}`, status: 204 },
];

/** @type {Awaited<ReturnType<typeof startStubExpress>> | undefined} */
let stub;
/** @type {Awaited<ReturnType<typeof startFrontend>> | undefined} */
let frontend;
/** @type {Array<{ label: string, request: import('../scripts/testing/assert-no-ip-headers.js').RecordedRequest }>} */
const results = [];

beforeAll(async () => {
  for (const port of [DEV_PORT, STUB_PORT, FRONTEND_PORT]) {
    if (!(await isPortFree(port))) {
      throw new Error(`El puerto ${port} está ocupado: pare el programa que lo usa antes de ejecutar esta prueba`);
    }
  }
  await buildFrontend(ROOT);
  stub = await startStubExpress({ port: STUB_PORT });
  frontend = await startFrontend({ root: ROOT, port: FRONTEND_PORT, backendPort: STUB_PORT });

  for (const operation of OPERATIONS) {
    for (const forwarded of FORWARDED_CASES) {
      const before = stub.requests.length;
      const writes = operation.method !== 'GET';
      const response = await sendRequest({
        port: FRONTEND_PORT,
        method: operation.method,
        path: operation.path,
        headers: {
          ...HOSTILE,
          ...forwarded.headers,
          ...(writes ? { Origin: `http://${HOST}` } : {}),
          ...(operation.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: operation.body,
      });
      const label = `${operation.name} ${forwarded.name}`;
      if (response.status !== operation.status) {
        throw new Error(`${label}: el frontend respondió ${response.status} y se esperaba ${operation.status}`);
      }
      const received = stub.requests.slice(before);
      if (received.length !== 1 || received[0] === undefined) {
        throw new Error(`${label}: el sustituto recibió ${received.length} peticiones y se esperaba 1`);
      }
      results.push({ label, request: received[0] });
    }
  }
});

afterAll(async () => {
  await frontend?.stop();
  await stub?.close();
  for (const port of [STUB_PORT, FRONTEND_PORT]) {
    expect(await isPortFree(port), `el puerto ${port} debe quedar libre`).toBe(true);
  }
});

describe('Next real (next start) frente al Express sustituto', () => {
  it('RF-I2: se recorrieron los doce casos y cada uno llegó una sola vez al sustituto', () => {
    expect(results).toHaveLength(12);
    expect(new Set(results.map((result) => result.label)).size).toBe(12);
  });

  it('RF-I2: en los doce casos el sustituto no recibe X-Forwarded-For (ni una línea en rawHeaders)', () => {
    for (const { label, request } of results) {
      expect(request.headers['x-forwarded-for'], label).toBeUndefined();
      const rawNames = request.rawHeaders.filter((_entry, index) => index % 2 === 0).map((name) => name.toLowerCase());
      expect(rawNames, label).not.toContain('x-forwarded-for');
    }
  });

  it('RF-I2: en los doce casos no llegan Forwarded, X-Real-IP, X-Forwarded-*, Cookie, Origin ni Referer', () => {
    for (const { label, request } of results) {
      for (const name of FORBIDDEN_HEADERS) expect(request.headers[name], `${label}: ${name}`).toBeUndefined();
    }
  });

  it('RF-I2: Authorization llega con la key de la prueba (el entorno del proceso prevalece)', () => {
    for (const { label, request } of results) {
      expect(request.headers.authorization, label).toBe(`Bearer ${TEST_API_KEY}`);
    }
  });

  it('RF-I2: solo llegan las cabeceras de la lista de esperadas', () => {
    for (const { label, request } of results) {
      expect(() => assertNoIpHeaders(request), label).not.toThrow();
    }
  });

  it('RF-I4: ninguna cabecera de IP llega a Express, así que Express contará la dirección de su conexión', () => {
    for (const { label, request } of results) {
      expect(request.remoteAddress, label).toBe('127.0.0.1');
    }
  });

  it('RF-I2: control negativo real: un X-Forwarded-For directo SÍ se registra y la aserción falla', async () => {
    if (stub === undefined) throw new Error('sin sustituto');
    const before = stub.requests.length;
    await sendRequest({
      port: STUB_PORT,
      method: 'GET',
      path: '/api/tasks',
      headers: { 'X-Forwarded-For': '203.0.113.9' },
    });
    const direct = stub.requests.slice(before)[0];
    expect(direct?.headers['x-forwarded-for']).toBe('203.0.113.9');
    expect(() => assertNoIpHeaders(/** @type {NonNullable<typeof direct>} */ (direct))).toThrow('x-forwarded-for');
  });
});
