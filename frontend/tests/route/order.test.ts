import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE, bodyOf, browserHeaders, createHarness, ID, itemContext, type Harness } from '../helpers/route-harness';

const OK_BODY = '{"title":"Comprar pan"}';
const ENCODER = new TextEncoder();
const ITEM_URL = `${BASE}/api/tasks/${ID}`;

type Body = string | Uint8Array | ReadableStream<Uint8Array> | undefined;

function request(url: string, method: string, headers: Record<string, string>, body?: Body): Request {
  const init: RequestInit & { duplex?: 'half' } = { method, headers, body: body as BodyInit | undefined };
  if (body instanceof ReadableStream) {
    init.duplex = 'half';
  }
  return new Request(url, init);
}

function stream(chunks: Uint8Array[], then: 'close' | 'hang' | 'error'): ReadableStream<Uint8Array> {
  const pending = [...chunks];
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = pending.shift();
      if (next !== undefined) {
        controller.enqueue(next);
      } else if (then === 'close') {
        controller.close();
      } else if (then === 'error') {
        controller.error(new Error('cut'));
      } else {
        return new Promise<void>(() => undefined);
      }
      return undefined;
    },
  });
}

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(() => {
  vi.useRealTimers();
});

const post = (headers: Record<string, string>, body: Body = OK_BODY, query = ''): Request =>
  request(`${BASE}/api/tasks${query}`, 'POST', browserHeaders(headers), body);
const put = (headers: Record<string, string>, body: Body = OK_BODY, url = ITEM_URL): Request =>
  request(url, 'PUT', browserHeaders(headers), body);
const get = (url: string): Request => request(url, 'GET', { host: 'localhost:3001' });

async function expectRejected(response: Response, status: number, code: string, field?: string): Promise<void> {
  expect(response.status).toBe(status);
  const { json } = await bodyOf(response);
  const error = (json as { error: { code: string; details: { field: string }[] } }).error;
  expect(error.code).toBe(code);
  if (field !== undefined) {
    expect(error.details[0]?.field).toBe(field);
  }
  expect(h.calls).toHaveLength(0);
}

describe('orden de comprobaciones: casos hostiles sin tocar Express', () => {
  const methods: [string, 'collection' | 'item', string][] = [
    ['PATCH', 'collection', '/api/tasks'],
    ['HEAD', 'collection', '/api/tasks'],
    ['OPTIONS', 'collection', '/api/tasks'],
    ['PUT', 'collection', '/api/tasks'],
    ['DELETE', 'collection', '/api/tasks'],
    ['PATCH', 'item', `/api/tasks/${ID}`],
    ['HEAD', 'item', `/api/tasks/${ID}`],
    ['OPTIONS', 'item', `/api/tasks/${ID}`],
    ['GET', 'item', `/api/tasks/${ID}`],
    ['POST', 'item', `/api/tasks/${ID}`],
  ];
  it.each(methods)('RF-F19: paso 1, %s en %s responde 405', async (method, kind, path) => {
    const body = method === 'PATCH' || method === 'PUT' || method === 'POST' ? OK_BODY : undefined;
    const response = await h[kind](request(`${BASE}${path}`, method, browserHeaders(), body), itemContext());
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe(kind === 'collection' ? 'GET, POST' : 'PUT, DELETE');
    expect(h.calls).toHaveLength(0);
  });

  it('RF-F19: paso 2, origen ajeno, null y cross-site responden 403', async () => {
    const hostile: Record<string, string>[] = [
      { origin: 'http://evil.example' },
      { origin: 'null' },
      { 'sec-fetch-site': 'cross-site' },
    ];
    for (const headers of hostile) {
      await expectRejected(await h.collection(post(headers)), 403, 'FORBIDDEN');
    }
    const evilDelete = request(ITEM_URL, 'DELETE', browserHeaders({ origin: 'http://evil.example' }));
    await expectRejected(await h.item(evilDelete, itemContext()), 403, 'FORBIDDEN');
  });

  it('RF-F19: paso 3, id inválido responde 400 sin tocar Express', async () => {
    const cases: [string, string][] = [
      ['/api/tasks/abc', 'abc'],
      ['/api/tasks/%2e%2e', '..'],
      ['/api/tasks/a%2Fb', 'a/b'],
      [`/api/tasks/${ID}x`, `${ID}x`],
      [`/api/tasks/${ID}`, 'otro-id'],
    ];
    for (const [path, param] of cases) {
      const response = await h.item(put({}, OK_BODY, `${BASE}${path}`), itemContext(param));
      await expectRejected(response, 400, 'BAD_REQUEST', 'id');
    }
  });

  it('RF-F19: paso 4, consulta inválida responde 400 en GET, POST, PUT y DELETE', async () => {
    await expectRejected(await h.collection(get(`${BASE}/api/tasks?x=1`)), 400, 'BAD_REQUEST', 'query');
    await expectRejected(await h.collection(get(`${BASE}/api/tasks?filter=all`)), 400, 'BAD_REQUEST', 'query');
    await expectRejected(await h.collection(post({}, OK_BODY, '?x=1')), 400, 'BAD_REQUEST', 'query');
    await expectRejected(await h.item(put({}, OK_BODY, `${ITEM_URL}?x=1`), itemContext()), 400, 'BAD_REQUEST', 'query');
    const deleteWithQuery = request(`${ITEM_URL}?x=1`, 'DELETE', browserHeaders());
    await expectRejected(await h.item(deleteWithQuery, itemContext()), 400, 'BAD_REQUEST', 'query');
  });

  it('RF-F19: pasos 5 y 6, Content-Length, Content-Type y Content-Encoding', async () => {
    await expectRejected(await h.collection(post({ 'content-length': 'abc' })), 400, 'BAD_REQUEST', 'body');
    await expectRejected(await h.collection(post({ 'content-length': '10241' })), 413, 'PAYLOAD_TOO_LARGE');
    await expectRejected(await h.collection(post({ 'content-encoding': 'gzip' })), 415, 'UNSUPPORTED_MEDIA_TYPE');
    await expectRejected(await h.collection(post({ 'content-type': 'text/plain' })), 415, 'UNSUPPORTED_MEDIA_TYPE');
    const plainPut = put({ 'content-type': 'text/plain' });
    await expectRejected(await h.item(plainPut, itemContext()), 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('RF-F19: paso 7, flujo lento responde 408 y flujo cortado responde 400', async () => {
    vi.useFakeTimers();
    const slow = h.collection(post({}, stream([ENCODER.encode('{"title"')], 'hang')));
    await vi.advanceTimersByTimeAsync(5000);
    await expectRejected(await slow, 408, 'REQUEST_TIMEOUT');
    vi.useRealTimers();
    const cut = post({}, stream([ENCODER.encode('{"ti')], 'error'));
    await expectRejected(await h.collection(cut), 400, 'BAD_REQUEST', 'body');
  });

  it('RF-F19: paso 7, el tope cuenta bytes reales aunque Content-Length mienta', async () => {
    const big = ENCODER.encode(`{"title":"${'a'.repeat(10_300)}"}`);
    await expectRejected(await h.collection(post({ 'content-length': '10' }, big)), 413, 'PAYLOAD_TOO_LARGE');
    await expectRejected(await h.collection(post({}, stream([big], 'close'))), 413, 'PAYLOAD_TOO_LARGE');
  });

  const badBodies: [string, Body][] = [
    ['__proto__', '{"__proto__":{}}'],
    ['vacío', ''],
    ['arreglo', '[]'],
    ['null', 'null'],
    ['texto', 'hola'],
    ['BOM', new Uint8Array([0xef, 0xbb, 0xbf, ...ENCODER.encode('{"title":"a"}')])],
    ['UTF-8 inválido', new Uint8Array([0x7b, 0xff, 0x7d])],
  ];
  it.each(badBodies)('RF-F19: paso 8, cuerpo %s responde 400', async (_name, body) => {
    await expectRejected(await h.collection(post({}, body)), 400, 'BAD_REQUEST', 'body');
  });

  it('RF-F19: combinaciones, gana el primer error del orden', async () => {
    const hostile = { origin: 'http://evil.example', 'content-type': 'text/plain', 'content-length': 'abc' };
    const badUrl = `${BASE}/api/tasks/zzz?x=1`;
    await expectRejected(await h.item(put(hostile, '[]', badUrl), itemContext('zzz')), 403, 'FORBIDDEN');
    const noOrigin = { 'content-type': 'text/plain', 'content-length': 'abc' };
    await expectRejected(await h.item(put(noOrigin, '[]', badUrl), itemContext('zzz')), 400, 'BAD_REQUEST', 'id');
    const badQuery = put(noOrigin, '[]', `${ITEM_URL}?x=1`);
    await expectRejected(await h.item(badQuery, itemContext()), 400, 'BAD_REQUEST', 'query');
    await expectRejected(await h.collection(post(noOrigin, '[]')), 400, 'BAD_REQUEST', 'body');
    const big = { 'content-type': 'text/plain', 'content-length': '10241' };
    await expectRejected(await h.collection(post(big, '[]')), 413, 'PAYLOAD_TOO_LARGE');
    await expectRejected(
      await h.collection(post({ 'content-type': 'text/plain' }, '[]')),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
  });
});

describe('orden de comprobaciones: lo que sí se reenvía', () => {
  it('RF-F19: un cuerpo de 10240 bytes se reenvía re-serializado', async () => {
    const title = 'a'.repeat(10_240 - '{"title":""}'.length);
    const text = `{"title":"${title}"}`;
    expect(ENCODER.encode(text).length).toBe(10_240);
    const response = await h.collection(post({}, text));
    expect(response.status).toBe(201);
    expect(h.calls[0]?.init.body).toBe(text);
  });

  it('RF-F19: el texto crudo nunca se reenvía (espacios y claves repetidas desaparecen)', async () => {
    await h.collection(post({}, '{ "title" : "a", "title": "b" }'));
    expect(h.calls[0]?.init.body).toBe('{"title":"b"}');
  });

  it('RF-F19: Content-Length falso, menor o mayor que el real, no impide reenviar un cuerpo válido', async () => {
    expect((await h.collection(post({ 'content-length': '5' }))).status).toBe(201);
    expect((await h.collection(post({ 'content-length': '10000' }))).status).toBe(201);
    expect(h.calls.map((call) => call.init.body)).toEqual([OK_BODY, OK_BODY]);
  });

  it('RF-F19: Content-Encoding identity y charset utf-8 pasan', async () => {
    const headers = { 'content-encoding': 'identity', 'content-type': 'Application/JSON; charset=UTF-8' };
    expect((await h.collection(post(headers))).status).toBe(201);
  });

  it('RF-F19: las mayúsculas del UUID se pasan a minúsculas en la URL hacia Express', async () => {
    const upper = ID.toUpperCase();
    const response = await h.item(put({}, OK_BODY, `${BASE}/api/tasks/${upper}`), itemContext(upper));
    expect(response.status).toBe(200);
    expect(h.calls[0]?.url.endsWith(`/api/tasks/${ID}`)).toBe(true);
  });

  it('RF-F19: DELETE con cuerpo no lo lee ni lo envía', async () => {
    const withBody = request(ITEM_URL, 'DELETE', browserHeaders(), 'basura');
    const response = await h.item(withBody, itemContext());
    expect(response.status).toBe(204);
    expect(h.calls[0]?.init.body).toBeUndefined();
    expect(h.calls[0]?.init.headers).not.toHaveProperty('Content-Type');
  });

  it('RF-F19: GET filtra con ?filter y reenvía ?completed sin cuerpo', async () => {
    await h.collection(get(`${BASE}/api/tasks?filter=pending`));
    expect(h.calls[0]?.url.endsWith('/api/tasks?completed=false')).toBe(true);
    expect(h.calls[0]?.init.body).toBeUndefined();
  });
});
