import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withInput } from '../../src/http/input/request-input';
import { registerRoute } from '../../src/http/route-table';
import type { CaptureLogger } from '../helpers/capture-logger';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { hasCompleteResponse, rawRequest, type RawResult } from '../helpers/raw-http';
import { createTestApp } from '../helpers/test-app';

const JSON_TYPE = 'Content-Type: application/json';

function registerTestRoutes(app: Express): void {
  const echo = (bodyMode: 'none' | 'required') =>
    withInput({ bodyMode }, (_req, res, input) => {
      res.status(200).json({ body: input.body ?? null });
    });
  registerRoute(app, '/api/test-input', { GET: echo('none'), POST: echo('required') });
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

function head(method: string, headers: readonly string[]): string {
  const lines = headers.map((line) => `${line}\r\n`).join('');
  return `${method} /api/test-input HTTP/1.1\r\nHost: localhost\r\n${lines}\r\n`;
}

/** Declara 50 bytes y envía solo 10. */
function shortBody(headers: readonly string[] = [JSON_TYPE]): string[] {
  return [head('POST', [...headers, 'Content-Length: 50']), '0123456789'];
}

/** Chunked cortado a mitad del segundo fragmento. */
function cutChunked(): string[] {
  return [head('POST', [JSON_TYPE, 'Transfer-Encoding: chunked']), '5\r\nabcde\r\n5\r\nab'];
}

function reply(result: RawResult): { status: number; body: Record<string, unknown> } {
  const response = result.responses[0];
  if (response === undefined) {
    throw new Error(`Sin respuesta: ${result.text}`);
  }
  return { status: response.status, body: JSON.parse(response.body) as Record<string, unknown> };
}

async function expectStillServing(): Promise<void> {
  const result = await rawRequest(loopback.port, [head('GET', [])], { until: hasCompleteResponse });

  expect(reply(result).status).toBe(200);
}

describe('RF-C24: desajuste de longitud con el cliente aún presente', () => {
  it.each([
    ['Content-Length 50 con 10 bytes', shortBody],
    ['chunked cortado a mitad', cutChunked],
  ])('RF-C24: %s y cierre del lado de escritura da 400 body y la conexión se cierra', async (_name, build) => {
    const result = await rawRequest(loopback.port, build(), { afterWrite: 'end' });

    expect(result.text).toMatch(/^HTTP\/1\.1 400 Bad Request\r\n/);
    expect(result.responses).toHaveLength(1);
    const response = result.responses[0];
    expect(response?.status).toBe(400);
    expect(response?.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response?.headers['connection']).toBe('close');
    expect(response?.headers['content-length']).toBe(String(Buffer.byteLength(response?.body ?? '')));
    expect(JSON.parse(response?.body ?? '')).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Datos inválidos.',
        details: [{ field: 'body', message: 'El cuerpo no coincide con la longitud declarada.' }],
      },
    });
    expect(result.closedByServer).toBe(true);
  });

  it('RF-C24: tras el 400 por desajuste el servidor sigue atendiendo y no registra nada', async () => {
    await rawRequest(loopback.port, shortBody(), { afterWrite: 'end' });

    await expectStillServing();
    expect(capture.lines).toHaveLength(0);
  });
});

describe('RF-C24: aborto del cliente', () => {
  it.each([
    ['Content-Length 50 con 10 bytes', shortBody],
    ['chunked cortado a mitad', cutChunked],
  ])('RF-C24: aborto total (%s): sin respuesta, sin request_error y el servidor sigue', async (_name, build) => {
    const result = await rawRequest(loopback.port, build(), { afterWrite: 'destroy' });

    expect(result.responses).toHaveLength(0);
    expect(result.text).toBe('');
    await expectStillServing();
    expect(capture.output()).not.toContain('request_error');
    expect(capture.lines).toHaveLength(0);
  });
});

describe('RF-C24: orden con el tipo y errores del lector', () => {
  it('RF-C24: con Content-Length y tipo no JSON gana el 415 sin esperar al final del body', async () => {
    const result = await rawRequest(loopback.port, shortBody(['Content-Type: text/plain']), {
      until: hasCompleteResponse,
    });

    expect(reply(result).status).toBe(415);
    expect(result.closedByServer).toBe(false);
  });

  it('RF-C24: el 415 ya enviado no va seguido de un 400 aunque el cliente cierre con el body incompleto', async () => {
    const result = await rawRequest(loopback.port, shortBody(['Content-Type: text/plain']), { afterWrite: 'end' });

    expect(result.responses.map((response) => response.status)).toEqual([415]);
    expect(result.text).not.toContain('400');
    expect(result.closedByServer).toBe(true);
  });

  it('RF-C3: ningún error del lector (límite, longitud, aborto, codificación) llega como 500 ni al log', async () => {
    const outcomes = [
      await rawRequest(loopback.port, [head('POST', [JSON_TYPE, 'Content-Length: 20000'])]),
      await rawRequest(loopback.port, shortBody(), { afterWrite: 'end' }),
      await rawRequest(loopback.port, shortBody(), { afterWrite: 'destroy' }),
      await rawRequest(loopback.port, cutChunked(), { afterWrite: 'destroy' }),
      await rawRequest(loopback.port, shortBody([JSON_TYPE, 'Content-Encoding: gzip']), { afterWrite: 'end' }),
    ];

    const statuses = outcomes.flatMap((outcome) => outcome.responses.map((response) => response.status));
    expect(statuses).toEqual([413, 400, 415]);
    expect(capture.output()).not.toContain('request_error');
    expect(capture.lines).toHaveLength(0);
  });
});
