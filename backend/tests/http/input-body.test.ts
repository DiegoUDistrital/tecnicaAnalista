import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withInput } from '../../src/http/input/request-input';
import { registerRoute } from '../../src/http/route-table';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { hasCompleteResponse, rawRequest, type RawResult } from '../helpers/raw-http';
import { createTestApp } from '../helpers/test-app';

const JSON_TYPE = 'Content-Type: application/json';
const INVALID_BODY = 'El cuerpo debe ser un objeto JSON válido.';
const NO_BODY_ALLOWED = 'Esta ruta no admite cuerpo.';

function registerTestRoutes(app: Express): void {
  const echo = (bodyMode: 'none' | 'required') =>
    withInput({ bodyMode }, (_req, res, input) => {
      res.status(200).json({ body: input.body ?? null });
    });
  registerRoute(app, '/api/test-input', { GET: echo('none'), POST: echo('required') });
}

let loopback: LoopbackServer;

beforeAll(async () => {
  loopback = await listenOnLoopback(createTestApp({ registerRoutes: registerTestRoutes }).app);
});

afterAll(async () => {
  await loopback.close();
});

function head(method: string, headers: readonly string[]): string {
  const lines = headers.map((line) => `${line}\r\n`).join('');
  return `${method} /api/test-input HTTP/1.1\r\nHost: localhost\r\n${lines}\r\n`;
}

function exchange(parts: readonly (string | Buffer)[]): Promise<RawResult> {
  return rawRequest(loopback.port, parts, { until: hasCompleteResponse });
}

/** Petición con cuerpo y `Content-Length` exacto. */
function withBody(method: string, headers: readonly string[], body: string | Buffer): (string | Buffer)[] {
  return [head(method, [...headers, `Content-Length: ${body.length}`]), body];
}

function reply(result: RawResult): { status: number; body: Record<string, unknown> } {
  const response = result.responses[0];
  if (response === undefined) {
    throw new Error(`Sin respuesta: ${result.text}`);
  }
  return { status: response.status, body: JSON.parse(response.body) as Record<string, unknown> };
}

function detailsOf(result: RawResult): unknown {
  return (reply(result).body['error'] as { details: unknown }).details;
}

function expectBodyError(result: RawResult, message: string): void {
  expect(reply(result).status).toBe(400);
  expect(detailsOf(result)).toEqual([{ field: 'body', message }]);
}

describe('RF-C5: POST sin cuerpo útil', () => {
  it('RF-C5: POST con body vacío y Content-Type JSON da 400 body', async () => {
    expectBodyError(await exchange([head('POST', [JSON_TYPE])]), INVALID_BODY);
  });

  it('RF-C5: POST sin Content-Type y sin body da 400 body', async () => {
    expectBodyError(await exchange([head('POST', [])]), INVALID_BODY);
  });

  it('RF-C5: POST con Content-Length: 0 y text/plain da 400 body (vacío), no 415', async () => {
    const result = await exchange([head('POST', ['Content-Type: text/plain', 'Content-Length: 0'])]);

    expectBodyError(result, INVALID_BODY);
  });

  it('RF-C5: chunked de cero bytes con Content-Type JSON da 400 body (vacío)', async () => {
    const result = await exchange([head('POST', [JSON_TYPE, 'Transfer-Encoding: chunked']), '0\r\n\r\n']);

    expectBodyError(result, INVALID_BODY);
  });
});

describe('RF-C5: GET y DELETE no admiten cuerpo', () => {
  it('RF-C5: GET con body JSON y Content-Type JSON da 400 body «Esta ruta no admite cuerpo.»', async () => {
    expectBodyError(await exchange(withBody('GET', [JSON_TYPE], '{"a":1}')), NO_BODY_ALLOWED);
  });

  it('RF-C5: GET con body FF FE y tipo JSON da el mismo mensaje', async () => {
    const result = await exchange(withBody('GET', [JSON_TYPE], Buffer.from([0xff, 0xfe])));

    expectBodyError(result, NO_BODY_ALLOWED);
  });

  it('RF-C5: GET con body y sin Content-Type da 415', async () => {
    expect(reply(await exchange(withBody('GET', [], '{}'))).status).toBe(415);
  });
});

describe('RF-C5: bytes y JSON a través de la tubería', () => {
  it.each([
    ['FF FE', Buffer.from([0xff, 0xfe])],
    ['C3 truncado', Buffer.from([0x7b, 0xc3])],
    ['ED A0 80', Buffer.from([0xed, 0xa0, 0x80])],
    ['BOM más {}', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{}')])],
    ['JSON roto', Buffer.from('{"a":')],
    ['[]', Buffer.from('[]')],
    ['null', Buffer.from('null')],
    ['"x"', Buffer.from('"x"')],
    ['5', Buffer.from('5')],
  ])('RF-C5: POST con %s da 400 body', async (_name, body) => {
    expectBodyError(await exchange(withBody('POST', [JSON_TYPE], body)), INVALID_BODY);
  });

  it('RF-C5: U+FFFD legítimo en un valor llega intacto', async () => {
    const body = Buffer.concat([Buffer.from('{"title":"a'), Buffer.from([0xef, 0xbf, 0xbd]), Buffer.from('b"}')]);

    const result = await exchange(withBody('POST', [JSON_TYPE], body));

    expect(reply(result)).toEqual({ status: 200, body: { body: { title: 'a\u{fffd}b' } } });
  });

  it('RF-C5: con claves repetidas gana la última', async () => {
    const result = await exchange(withBody('POST', [JSON_TYPE], '{"title":"a","title":"b"}'));

    expect(reply(result).body).toEqual({ body: { title: 'b' } });
  });

  it('RF-C5: el cuerpo llega con charset=utf-8 declarado', async () => {
    const result = await exchange(withBody('POST', ['Content-Type: application/json; charset=utf-8'], '{"a":1}'));

    expect(reply(result).body).toEqual({ body: { a: 1 } });
  });
});
