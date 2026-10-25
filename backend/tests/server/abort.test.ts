import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseUnavailableError } from '../../src/errors/database-unavailable-error';
import { startServer } from '../../src/server/start-server';
import { createHarness, getFreePort, type Harness, type HarnessOptions, validEnv } from '../helpers/server-fakes';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  vi.restoreAllMocks();
});

/** Espera real máxima: si el código aún no aborta, el test falla por aserción y no por tiempo agotado. */
const GRACE_MS = 300;

/** Código de salida, o `'pending'` si la promesa no termina en `GRACE_MS`. */
async function outcome(result: Promise<number>): Promise<number | 'pending'> {
  return Promise.race([result, new Promise<'pending'>((resolve) => setTimeout(resolve, GRACE_MS, 'pending'))]);
}

/** Arranca y espera a que el arranque llegue a la fase pedida. */
async function startUntil(
  options: HarnessOptions,
  call: 'query' | 'listen',
): Promise<{ harness: Harness; result: Promise<number> }> {
  const harness = createHarness(options);
  const result = startServer(harness.overrides);
  await vi.waitFor(() => expect(harness.calls).toContain(call));
  return { harness, result };
}

describe('RF-S4: señal durante la comprobación de la base de datos', () => {
  it('RF-S4: los manejadores de señal se registran al principio, antes de cualquier espera', () => {
    const harness = createHarness({ database: { query: 'pending' } });

    const result = startServer(harness.overrides);

    // Dos señales y, desde la T7, los manejadores de excepciones y rechazos.
    expect(harness.fakeProcess.listenerTotal()).toBe(4);
    harness.fakeProcess.signal('SIGTERM');
    harness.fakeDatabase.pendingQuery.resolve();
    return result;
  });

  it('RF-S4: señal con la comprobación de BD pendiente: sin listen, Pool cerrado, código 0', async () => {
    const { harness, result } = await startUntil({ database: { query: 'pending' } }, 'query');

    harness.fakeProcess.signal('SIGTERM');
    await vi.waitFor(() => expect(harness.fakeDatabase.closeCalls()).toBe(1));
    harness.fakeDatabase.pendingQuery.reject(new DatabaseUnavailableError());

    expect(await outcome(result)).toBe(0);
    expect(harness.calls).toEqual(['query', 'close']);
    expect(harness.created().server).toBe(0);
    expect(harness.events()).toEqual(['shutdown_started', 'shutdown_completed']);
  });

  it('RF-S4: señal y la comprobación de BD termina bien después: no se llama a listen, código 0', async () => {
    const { harness, result } = await startUntil({ database: { query: 'pending' } }, 'query');

    harness.fakeProcess.signal('SIGINT');
    harness.fakeDatabase.pendingQuery.resolve();

    expect(await outcome(result)).toBe(0);
    expect(harness.calls).not.toContain('listen');
    expect(harness.created().server).toBe(0);
    expect(harness.events()).toEqual(['shutdown_started', 'shutdown_completed']);
    expect(harness.fakeDatabase.closeCalls()).toBe(1);
  });

  it('RF-S3: consulta rechazada con DatabaseUnavailableError tras la señal: sin startup_failed, código 0', async () => {
    const { harness, result } = await startUntil({ database: { query: 'pending' } }, 'query');

    harness.fakeProcess.signal('SIGTERM');
    harness.fakeDatabase.pendingQuery.reject(new DatabaseUnavailableError());

    expect(await outcome(result)).toBe(0);
    expect(harness.events()).not.toContain('startup_failed');
    expect(harness.events()).toEqual(['shutdown_started', 'shutdown_completed']);
    expect(harness.capture.records()[1]).toMatchObject({ exitCode: 0 });
  });

  it('RF-S4: el cierre espera a la comprobación pendiente antes de decidir el código', async () => {
    const { harness, result } = await startUntil({ database: { query: 'pending' } }, 'query');

    harness.fakeProcess.signal('SIGTERM');
    await vi.waitFor(() => expect(harness.fakeDatabase.closeCalls()).toBe(1));

    expect(await outcome(result)).toBe('pending');
    expect(harness.events()).toEqual(['shutdown_started']);
    harness.fakeDatabase.pendingQuery.reject(new Error('syntax error at or near "SELEC"'));
    expect(await outcome(result)).toBe(1);
  });

  it('RF-S4: tras abortar no se emite el evento startup', async () => {
    const { harness, result } = await startUntil({ database: { query: 'pending' } }, 'query');

    harness.fakeProcess.signal('SIGTERM');
    harness.fakeDatabase.pendingQuery.resolve();
    await outcome(result);

    expect(harness.events()).not.toContain('startup');
  });
});

describe('RF-S3: señal y fallo propio de la base de datos', () => {
  it('RF-S3: señal y fallo propio de la BD (no DatabaseUnavailableError): startup_failed, código 1', async () => {
    const { harness, result } = await startUntil({ database: { query: 'pending' } }, 'query');

    harness.fakeProcess.signal('SIGTERM');
    harness.fakeDatabase.pendingQuery.reject(new Error('syntax error at or near "SELEC"'));

    expect(await outcome(result)).toBe(1);
    const events = harness.events();
    expect(events).toHaveLength(3);
    expect(events).toEqual(expect.arrayContaining(['shutdown_started', 'startup_failed', 'shutdown_completed']));
    expect(events.at(-1)).toBe('shutdown_completed');
    expect(harness.capture.records().at(-1)).toMatchObject({ exitCode: 1 });
    expect(harness.calls).not.toContain('listen');
  });

  it('RF-S3: DatabaseUnavailableError sin señal previa es causa propia (startup_failed, código 1)', async () => {
    const harness = createHarness({ database: { queryError: new DatabaseUnavailableError() } });

    const code = await startServer(harness.overrides);

    expect(code).toBe(1);
    expect(harness.events()).toEqual(['startup_failed']);
  });
});

describe('RF-S4: señal entre listen y listening', () => {
  it('RF-S4: señal entre listen y listening (servidor falso): close, Pool cerrado, código 0', async () => {
    const { harness, result } = await startUntil({ listen: 'never' }, 'listen');

    harness.fakeProcess.signal('SIGTERM');

    expect(await outcome(result)).toBe(0);
    expect(harness.calls).toEqual(['query', 'listen', 'server_close', 'close']);
    expect(harness.events()).toEqual(['shutdown_started', 'shutdown_completed']);
  });

  it('RF-S4: señal entre listen y listening con servidor real: el puerto rechaza conexiones', async () => {
    const port = await getFreePort();
    const harness = createHarness({ env: validEnv({ PORT: String(port), HOST: '127.0.0.1' }) });
    let real: http.Server | undefined;
    const createServer = (): http.Server => {
      const server = http.createServer();
      const listen = server.listen.bind(server) as (...args: unknown[]) => http.Server;
      // La señal llega justo después de pedir `listen` y antes de que Node emita `listening`.
      server.listen = ((...args: unknown[]) => {
        const listened = listen(...args);
        harness.fakeProcess.signal('SIGTERM');
        return listened;
      }) as typeof server.listen;
      real = server;
      cleanups.push(() => {
        server.closeAllConnections();
        server.close();
      });
      return server;
    };

    const code = await outcome(startServer({ ...harness.overrides, createServer }));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(code).toBe(0);
    expect(real?.listening).toBe(false);
    expect(await connectionOutcome(port)).toBe('ECONNREFUSED');
    expect(harness.events()).toEqual(['shutdown_started', 'shutdown_completed']);
    expect(harness.fakeDatabase.closeCalls()).toBe(1);
  });

  it('RF-S4: un error de listen tras la señal sigue siendo causa propia (startup_failed, código 1)', async () => {
    const { harness, result } = await startUntil({ listen: 'never' }, 'listen');

    harness.fakeProcess.signal('SIGTERM');
    harness.fakeServer.emitter.emit('error', Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }));

    expect(await outcome(result)).toBe(1);
    expect(harness.events()).toEqual(
      expect.arrayContaining(['shutdown_started', 'startup_failed', 'shutdown_completed']),
    );
    expect(harness.events().at(-1)).toBe('shutdown_completed');
  });
});

describe('RF-S5: segunda señal durante el arranque', () => {
  it('RF-S5: segunda señal durante el aborto: salida inmediata con código 1 y sin más eventos', async () => {
    const { harness, result } = await startUntil({ database: { query: 'pending' } }, 'query');
    harness.fakeProcess.signal('SIGTERM');

    harness.fakeProcess.signal('SIGTERM');

    expect(await outcome(result)).toBe(1);
    expect(harness.events()).toEqual(['shutdown_started']);
    expect(harness.fakeProcess.listenerTotal()).toBe(0);
  });

  it('RF-S5: señal tras un fallo de arranque con el Pool sin cerrar: salida inmediata con código 1', async () => {
    const harness = createHarness({ database: { queryError: new Error('down'), close: 'hang' } });
    const result = startServer(harness.overrides);
    await vi.waitFor(() => expect(harness.events()).toEqual(['startup_failed']));

    harness.fakeProcess.signal('SIGINT');

    expect(await outcome(result)).toBe(1);
    expect(harness.events()).toEqual(['startup_failed']);
    expect(harness.fakeProcess.listenerTotal()).toBe(0);
  });

  it('RF-S4: tras abortar, startServer no llama a process.exit ni deja manejadores', async () => {
    const exit = vi.spyOn(process, 'exit');
    const before = ['SIGTERM', 'SIGINT'].map((name) => process.listenerCount(name));
    const { harness, result } = await startUntil({ listen: 'never' }, 'listen');

    harness.fakeProcess.signal('SIGTERM');
    await outcome(result);

    expect(exit).not.toHaveBeenCalled();
    expect(harness.fakeProcess.listenerTotal()).toBe(0);
    expect(['SIGTERM', 'SIGINT'].map((name) => process.listenerCount(name))).toEqual(before);
  });
});

/** Intenta una conexión TCP nueva y devuelve el código del error (o `connected`). */
function connectionOutcome(port: number): Promise<string> {
  return new Promise<string>((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve('connected');
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code ?? 'unknown');
    });
  });
}
