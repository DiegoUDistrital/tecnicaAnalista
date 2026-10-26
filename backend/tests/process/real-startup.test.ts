import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../../src/server/start-server';
import { baseEnv } from '../helpers/config-env';
import { createFakeProcess, type FakeProcess, getFreePort } from '../helpers/server-fakes';
import { getTestDatabase } from '../helpers/test-database';

/** Arranque con las dependencias reales (Pool, servidor, logger, temporizador); cambian solo env y process. */
async function startReal(): Promise<{ code: Promise<number>; port: number; fake: FakeProcess }> {
  getTestDatabase(); // aplica la guarda: solo se usa la base de pruebas
  const port = await getFreePort();
  const fake = createFakeProcess();
  const env = baseEnv({
    DATABASE_URL: process.env['TEST_DATABASE_URL'],
    PORT: String(port),
    HOST: '127.0.0.1',
  });
  return { code: startServer({ env, process: fake.process }), port, fake };
}

async function waitForHealth(port: number): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await fetch(`http://127.0.0.1:${String(port)}/health`);
    } catch (error) {
      lastError = error;
      await new Promise((done) => setTimeout(done, 50));
    }
  }
  throw lastError;
}

describe('arranque real', () => {
  let pending: { code: Promise<number>; fake: FakeProcess } | undefined;

  afterEach(async () => {
    if (pending !== undefined) {
      pending.fake.signal('SIGINT');
      await pending.code;
      pending = undefined;
    }
  });

  it('RF-S12: arranque real con las dependencias por defecto (salvo env y process): /health da 200', async () => {
    const started = await startReal();
    pending = started;

    const response = await waitForHealth(started.port);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('RF-S4: una señal emitida en el proceso falso cierra el servidor y el Pool reales y el código es 0', async () => {
    const started = await startReal();
    await waitForHealth(started.port);

    started.fake.signal('SIGTERM');

    expect(await started.code).toBe(0);
    await expect(fetch(`http://127.0.0.1:${String(started.port)}/health`)).rejects.toThrow();
  });
});
