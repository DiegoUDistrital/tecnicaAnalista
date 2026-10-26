import { MemoryStore } from 'express-rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startServer } from '../../src/server/start-server';
import { createHarness, getFreePort, validEnv } from '../helpers/server-fakes';
import { createTestApp } from '../helpers/test-app';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RF-G7: cierre de los almacenes de los cupos', () => {
  it('RF-G7: app.shutdown() llama a shutdown de los dos almacenes y se puede llamar dos veces', () => {
    const shutdown = vi.spyOn(MemoryStore.prototype, 'shutdown');
    const { app } = createTestApp();

    app.shutdown();
    expect(shutdown).toHaveBeenCalledTimes(2);

    expect(() => {
      app.shutdown();
    }).not.toThrow();
    expect(shutdown).toHaveBeenCalledTimes(4);
  });

  it('RF-G7: el servidor por defecto cierra los almacenes al cerrarse (server.once close)', async () => {
    const port = await getFreePort();
    const harness = createHarness({ env: validEnv({ PORT: String(port), HOST: '127.0.0.1' }) });
    // Se usa el createServer REAL de `startServer`: el resto de dependencias son falsas.
    const overrides = { ...harness.overrides };
    delete overrides.createServer;
    const shutdown = vi.spyOn(MemoryStore.prototype, 'shutdown');

    const result = startServer(overrides);
    await vi.waitFor(() => expect(harness.events()).toContain('startup'));
    expect(shutdown).not.toHaveBeenCalled();
    harness.fakeProcess.signal('SIGTERM');

    expect(await result).toBe(0);
    expect(shutdown).toHaveBeenCalledTimes(2);
  });
});
