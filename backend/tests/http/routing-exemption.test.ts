import { afterEach, describe, expect, it } from 'vitest';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { rawRequest } from '../helpers/raw-http';
import { createTestApp } from '../helpers/test-app';

/**
 * Caracterización del enrutador (A VERIFICAR de la 005, T3): la exención de `/health` la decide el MISMO enrutador, así
 * que lo que cuenta es qué rutas resuelve como `/health`. Estas peticiones llevan la key (la inyecta `withTestKey`):
 * así se ve el enrutado puro, sin depender de la guarda.
 */
async function statusOf(port: number, target: string): Promise<number | undefined> {
  const result = await rawRequest(port, [`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`]);
  return result.responses[0]?.status;
}

describe('RF-G2: enrutado de /health (caracterización)', () => {
  let loopback: LoopbackServer | undefined;

  afterEach(async () => {
    await loopback?.close();
    loopback = undefined;
  });

  async function start(): Promise<number> {
    loopback = await listenOnLoopback(createTestApp().app);
    return loopback.port;
  }

  it.each(['/health', '/health?x=1', '/health?'])(
    'RF-G2: GET %s lo resuelve el enrutador como /health (200)',
    async (t) => {
      expect(await statusOf(await start(), t)).toBe(200);
    },
  );

  it.each(['/health;x', '//health', '/%68ealth', '/Health', '/health/', '/health%ZZ', '/health/x', '/healthz'])(
    'RF-G2: GET %s NO se resuelve como /health (404)',
    async (target) => {
      expect(await statusOf(await start(), target)).toBe(404);
    },
  );

  it('RF-G2: la forma absoluta http://host/health se resuelve como /health (200)', async () => {
    expect(await statusOf(await start(), 'http://localhost/health')).toBe(200);
  });

  it('RF-G2: la forma absoluta http://host/nada se resuelve como /nada (404)', async () => {
    expect(await statusOf(await start(), 'http://localhost/nada')).toBe(404);
  });
});
