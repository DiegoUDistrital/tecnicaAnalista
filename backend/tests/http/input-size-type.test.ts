import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerRoute } from '../../src/http/route-table';
import { withInput } from '../../src/http/input/request-input';
import { createTestApp } from '../helpers/test-app';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { hasCompleteResponse, parseResponses, rawRequest, type RawResult } from '../helpers/raw-http';
import type { CaptureLogger } from '../helpers/capture-logger';

const LIMIT = 10240;
const JSON_TYPE = 'Content-Type: application/json';

function registerTestRoutes(app: Express): void {
  // T4: el cuerpo ya llega parseado (objeto, o `undefined` si la ruta no admite cuerpo).
  const echo = (bodyMode: 'none' | 'required') =>
    withInput({ bodyMode }, (_req, res, input) => {
      res.status(200).json({ rawQuery: input.rawQuery, body: input.body ?? null });
    });
  registerRoute(app, '/api/test-input', { GET: echo('none'), POST: echo('required') });
  // Sin withInput: muestra lo que Node deja en `req.headers` y en `req.rawHeaders`.
  registerRoute(app, '/api/test-headers', {
    GET: (req, res) => {
      res.status(200).json({
        contentType: req.headers['content-type'],
        contentEncoding: req.headers['content-encoding'],
        rawContentType: req.rawHeaders.filter(
          (_value, index) => req.rawHeaders[index - 1]?.toLowerCase() === 'content-type',
        ),
      });
    },
  });
}

let loopback: LoopbackServer;
let capture: CaptureLogger;

beforeAll(async () => {
  const testApp = createTestApp({ registerRoutes: registerTestRoutes });
  capture = testApp.capture;
  loopback = await listenOnLoopback(testApp.app);
});

afterAll(async () => {
  await loopback.close();
});

beforeEach(() => {
  capture.lines.length = 0;
});

function head(method: string, headers: readonly string[], path = '/api/test-input'): string {
  return `${method} ${path} HTTP/1.1\r\nHost: localhost\r\n${headers.map((line) => `${line}\r\n`).join('')}\r\n`;
}

/** Envía las partes y espera a una respuesta completa (sin esperar al cierre). */
function exchange(parts: readonly (string | Buffer)[]): Promise<RawResult> {
  return rawRequest(loopback.port, parts, { until: hasCompleteResponse });
}

/** Envía las partes y espera a que el SERVIDOR cierre la conexión (o venza el plazo de seguridad). */
function untilServerCloses(parts: readonly (string | Buffer)[]): Promise<RawResult> {
  return rawRequest(loopback.port, parts);
}

function json(result: RawResult, index = 0): { status: number; body: Record<string, unknown> } {
  const response = result.responses[index];
  if (response === undefined) {
    throw new Error(`Sin respuesta número ${index}: ${result.text}`);
  }
  return { status: response.status, body: JSON.parse(response.body) as Record<string, unknown> };
}

function errorCode(result: RawResult): unknown {
  return (json(result).body['error'] as { code: unknown }).code;
}

function chunked(size: number): string[] {
  const piece = 'a'.repeat(size);
  return [`${size.toString(16)}\r\n${piece}\r\n`];
}

function postWithBody(headers: readonly string[], body: string): string[] {
  return [head('POST', [...headers, `Content-Length: ${Buffer.byteLength(body)}`]), body];
}

describe('RF-C3: límite de 10 240 bytes', () => {
  it('RF-C3: 10 240 bytes (con espacios de relleno) no se rechazan por tamaño', async () => {
    const body = `{}${' '.repeat(LIMIT - 2)}`;

    const result = await exchange(postWithBody([JSON_TYPE], body));

    expect(json(result).status).toBe(200);
    expect(json(result).body['body']).toEqual({});
  });

  it('RF-C3: 10 241 bytes dan 413 PAYLOAD_TOO_LARGE y el servidor cierra la conexión', async () => {
    const body = `{}${' '.repeat(LIMIT - 1)}`;

    const result = await untilServerCloses(postWithBody([JSON_TYPE], body));

    expect(Buffer.byteLength(body)).toBe(LIMIT + 1);
    expect(json(result).status).toBe(413);
    expect(errorCode(result)).toBe('PAYLOAD_TOO_LARGE');
    expect(result.responses[0]?.headers['connection']).toBe('close');
    expect(result.closedByServer).toBe(true);
  });

  it('RF-C3: Content-Length mayor que el límite da 413 sin leer el body y la conexión se cierra', async () => {
    // El cliente declara 20 000 bytes y no envía ninguno: la respuesta no puede depender de leer el body.
    const result = await untilServerCloses([head('POST', [JSON_TYPE, 'Content-Length: 20000'])]);

    expect(json(result).status).toBe(413);
    expect(result.closedByServer).toBe(true);
    expect(capture.output()).toBe('');
  });

  it('RF-C3: chunked que supera el límite da 413 y la conexión se cierra aunque el cliente no termine', async () => {
    // Dos fragmentos de 6 000 bytes y sin el fragmento final: el servidor corta al pasar el límite.
    const result = await untilServerCloses([
      head('POST', [JSON_TYPE, 'Transfer-Encoding: chunked']),
      ...chunked(6000),
      ...chunked(6000),
    ]);

    expect(json(result).status).toBe(413);
    expect(errorCode(result)).toBe('PAYLOAD_TOO_LARGE');
    expect(result.closedByServer).toBe(true);
  });

  it('RF-C3: tras el 413 el servidor sigue atendiendo conexiones nuevas', async () => {
    await untilServerCloses([head('POST', [JSON_TYPE, 'Content-Length: 20000'])]);

    const result = await exchange([head('GET', [])]);

    expect(json(result).status).toBe(200);
  });
});

describe('RF-C1: el tamaño (2) se decide antes que el tipo (3)', () => {
  it('RF-C3: 20 KB con text/plain da 413, no 415', async () => {
    const result = await untilServerCloses(postWithBody(['Content-Type: text/plain'], 'a'.repeat(20 * 1024)));

    expect(json(result).status).toBe(413);
  });

  it('RF-C3: 20 KB con Content-Encoding gzip da 413', async () => {
    const result = await untilServerCloses(postWithBody([JSON_TYPE, 'Content-Encoding: gzip'], 'a'.repeat(20 * 1024)));

    expect(json(result).status).toBe(413);
  });

  it('RF-C3: chunked de 20 KB con gzip da 413, no 415', async () => {
    const result = await untilServerCloses([
      head('POST', ['Content-Encoding: gzip', 'Content-Type: text/plain', 'Transfer-Encoding: chunked']),
      ...chunked(20 * 1024),
    ]);

    expect(json(result).status).toBe(413);
    expect(result.closedByServer).toBe(true);
  });
});

describe('RF-C4: Content-Encoding', () => {
  const rejected: [string, string[]][] = [
    ['gzip', ['Content-Encoding: gzip']],
    ['identity,identity', ['Content-Encoding: identity,identity']],
    ['vacío', ['Content-Encoding:']],
    ['cabecera duplicada', ['Content-Encoding: identity', 'Content-Encoding: identity']],
  ];

  it.each(rejected)('RF-C4: Content-Encoding %s da 415 sin body (GET incluido)', async (_name, headers) => {
    const get = await exchange([head('GET', headers)]);
    const post = await exchange([head('POST', headers)]);

    expect(json(get).status).toBe(415);
    expect(json(post).status).toBe(415);
  });

  it('RF-C4: Content-Encoding Identity (con mayúscula) se acepta', async () => {
    const result = await exchange(postWithBody([JSON_TYPE, 'Content-Encoding: Identity'], '{}'));

    expect(json(result).status).toBe(200);
    expect(json(result).body['body']).toEqual({});
  });
});

describe('RF-C4: Content-Type', () => {
  it.each([
    ['text/plain', ['Content-Type: text/plain']],
    ['ausente', []],
  ])('RF-C4: con body presente y Content-Type %s da 415', async (_name, headers) => {
    const result = await exchange(postWithBody(headers, '{}'));

    expect(json(result).status).toBe(415);
  });

  it('RF-C4: sin body (sin Content-Length) el Content-Type se ignora', async () => {
    // GET: un POST sin cuerpo ya no llega a la ruta (cuerpo vacío = 400, T4); la regla de las etapas 2-3 es la misma.
    const result = await exchange([head('GET', ['Content-Type: text/plain'])]);

    expect(json(result)).toMatchObject({ status: 200, body: { body: null } });
  });

  it('RF-C4: Content-Length: 0 con text/plain NO es presente (la ruta recibe el body vacío)', async () => {
    const result = await exchange([head('GET', ['Content-Type: text/plain', 'Content-Length: 0'])]);

    expect(json(result)).toMatchObject({ status: 200, body: { body: null } });
  });

  it('RF-C4: chunked de cero bytes con text/plain da 415 (presente por cabeceras)', async () => {
    const result = await exchange([
      head('POST', ['Content-Type: text/plain', 'Transfer-Encoding: chunked']),
      '0\r\n\r\n',
    ]);

    expect(json(result).status).toBe(415);
  });

  it('RF-C4: chunked de cero bytes con Content-Type JSON llega vacío a la ruta', async () => {
    const result = await exchange([head('GET', [JSON_TYPE, 'Transfer-Encoding: chunked']), '0\r\n\r\n']);

    expect(json(result)).toMatchObject({ status: 200, body: { body: null } });
  });

  it('RF-C4: un body de solo espacios cuenta como presente (con text/plain da 415)', async () => {
    const plain = await exchange(postWithBody(['Content-Type: text/plain'], '   '));
    const jsonType = await exchange(postWithBody([JSON_TYPE], '   '));

    expect(json(plain).status).toBe(415);
    // Con tipo JSON supera las etapas 2-3 y falla después como JSON mal formado (T4).
    expect(json(jsonType).status).toBe(400);
  });

  it('RF-C4: tras un 415 con body sin leer la conexión keep-alive sigue sirviendo la petición siguiente', async () => {
    const result = await rawRequest(
      loopback.port,
      [...postWithBody(['Content-Type: text/plain'], 'hello'), head('GET', [])],
      { until: (text) => parseResponses(text).length >= 2 },
    );

    expect(result.responses.map((response) => response.status)).toEqual([415, 200]);
  });
});

describe('RF-C4: comportamiento de Node con las cabeceras (por qué se usa rawHeaders)', () => {
  it('RF-C4: Node conserva solo el primer Content-Type duplicado y une Content-Encoding con coma', async () => {
    const result = await exchange([
      head(
        'GET',
        [
          'Content-Type: application/json',
          'Content-Type: text/plain',
          'Content-Encoding: gzip',
          'Content-Encoding: br',
        ],
        '/api/test-headers',
      ),
    ]);

    expect(json(result).body).toMatchObject({
      contentType: 'application/json',
      contentEncoding: 'gzip, br',
      rawContentType: ['application/json', 'text/plain'],
    });
  });

  it('RF-C4: Node entrega el valor de Content-Type sin espacios en los extremos', async () => {
    const headers = head('GET', ['Content-Type:   application/json \t '], '/api/test-headers');
    const seen = await exchange([headers]);
    const accepted = await exchange(postWithBody(['Content-Type:   application/json \t '], '{}'));

    expect(json(seen).body['rawContentType']).toEqual(['application/json']);
    expect(json(accepted).status).toBe(200);
  });
});
