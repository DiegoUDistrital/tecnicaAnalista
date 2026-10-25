import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { startApiApp, type ApiApp } from '../helpers/api-app';
import { hasCompleteResponse, rawRequest, type RawResult } from '../helpers/raw-http';

// Pruebas de CARACTERIZACIÓN: no hay código de producción nuevo, así que no pueden nacer en rojo. Fijan lo que Node
// resuelve antes de Express y que el servicio sigue atendiendo después.

let api: ApiApp;
let loopback: LoopbackServer;

beforeAll(async () => {
  api = await startApiApp();
  loopback = await listenOnLoopback(api.app);
});

afterAll(async () => {
  await loopback.close();
  await api.close();
});

const VALID_GET = 'GET /api/tasks HTTP/1.1\r\nHost: localhost\r\n\r\n';
const CLIENT_ERROR_STATUSES = [400, 408, 414, 431];

/** Tras cada caso, una petición válida en una conexión nueva debe responder 200 con un arreglo. */
async function expectStillServing(): Promise<void> {
  const result = await rawRequest(loopback.port, [VALID_GET], { until: hasCompleteResponse });
  const response = result.responses[0];

  expect(response?.status).toBe(200);
  expect(Array.isArray(JSON.parse(response?.body ?? ''))).toBe(true);
}

/** Node responde con un estado de error de cliente o cierra sin responder; nunca un 5xx ni una respuesta de éxito. */
function expectNodeRejection(result: RawResult): void {
  const status = result.responses[0]?.status;

  if (status === undefined) {
    expect(result.closedByServer).toBe(true);
  } else {
    expect(CLIENT_ERROR_STATUSES).toContain(status);
  }
}

describe('RF-C3: errores de nivel HTTP que resuelve Node', () => {
  it('RF-C3: cabeceras enormes (sobre el límite de Node) reciben respuesta o cierre y el servidor sigue', async () => {
    const huge = `GET /api/tasks HTTP/1.1\r\nHost: localhost\r\nX-Huge: ${'a'.repeat(100_000)}\r\n\r\n`;

    const result = await rawRequest(loopback.port, [huge]);

    expectNodeRejection(result);
    await expectStillServing();
  });

  it('RF-C3: una URL enorme, un método desconocido y una petición mal formada no tumban el servidor', async () => {
    const hugeUrl = `GET /api/tasks?${'a'.repeat(100_000)} HTTP/1.1\r\nHost: localhost\r\n\r\n`;
    const unknownMethod = 'FOOBAR /api/tasks HTTP/1.1\r\nHost: localhost\r\n\r\n';
    const malformed = 'esto no es http\r\n\r\n';

    for (const raw of [hugeUrl, unknownMethod, malformed]) {
      expectNodeRejection(await rawRequest(loopback.port, [raw]));
      await expectStillServing();
    }
  });

  it('RF-C3: una ráfaga de 413 con conexión cerrada y después una petición válida: el servidor sigue', async () => {
    const tooLarge = (): string[] => [
      'POST /api/tasks HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 20000\r\n\r\n',
      ' '.repeat(20_000),
    ];

    const results = await Promise.all(Array.from({ length: 10 }, () => rawRequest(loopback.port, tooLarge())));

    for (const result of results) {
      expect(result.responses[0]?.status).toBe(413);
      expect(result.closedByServer).toBe(true);
    }
    await expectStillServing();
  });
});

describe('RF-C24: peticiones que Node rechaza por su cuenta', () => {
  it('RF-C24: Content-Length y Transfer-Encoding juntos (lo rechaza Node) no tumban el servidor', async () => {
    const both =
      'POST /api/tasks HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n' +
      'Content-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n';

    const result = await rawRequest(loopback.port, [both]);

    expectNodeRejection(result);
    expect(result.responses[0]?.status).not.toBe(201);
    await expectStillServing();
  });
});
