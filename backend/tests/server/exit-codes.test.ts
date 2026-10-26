import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseUnavailableError } from '../../src/errors/database-unavailable-error';
import { startServer } from '../../src/server/start-server';
import { createHarness, getFreePort, type Harness, type HarnessOptions, validEnv } from '../helpers/server-fakes';

const LISTEN_FAILURE = { error: Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }) };
const SECRET = 'secret-value-4d2e8b';
type FatalEvent = 'uncaughtException' | 'unhandledRejection';
const EVENT_NAMES: Record<FatalEvent, string> = {
  uncaughtException: 'uncaught_exception',
  unhandledRejection: 'unhandled_rejection',
};

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  vi.restoreAllMocks();
});

/** Cada fila comprueba el código, la lista de eventos y que no queda ningún manejador en el proceso falso. */
function expectOutcome(harness: Harness, code: number, expected: { events: string[]; code: number }): void {
  expect(code).toBe(expected.code);
  expect(harness.events()).toEqual(expected.events);
  expect(harness.fakeProcess.listenerTotal()).toBe(0);
}

/** Cede el turno varias veces: da tiempo a que se procese todo lo que ya estaba pendiente. */
async function flushTurns(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** Espera real máxima: si el código aún no aborta, el test falla por aserción y no por tiempo agotado. */
const GRACE_MS = 300;

/** Código de salida, o `'pending'` si la promesa no termina en `GRACE_MS`. */
async function outcome(result: Promise<number>): Promise<number | 'pending'> {
  return Promise.race([result, new Promise<'pending'>((resolve) => setTimeout(resolve, GRACE_MS, 'pending'))]);
}

/** Arranca con el cierre del Pool colgado y dispara el plazo a mano cuando ya está armado. */
async function startWithHungClose(harness: Harness): Promise<number> {
  const running = startServer(harness.overrides);
  await harness.timers.armed();
  harness.timers.fire();
  return running;
}

/** Espera al evento `startup`: el servicio ya está en funcionamiento. */
async function waitForStartup(harness: Harness): Promise<void> {
  await vi.waitFor(() => expect(harness.events()).toContain('startup'));
}

/** Arranca y espera al evento `startup`. Devuelve un objeto: un `async` aplanaría la promesa. */
async function startRunning(harness: Harness): Promise<{ running: Promise<number> }> {
  const running = startServer(harness.overrides);
  await waitForStartup(harness);
  return { running };
}

/** Arranca y espera a que el arranque haya llegado a la llamada pedida del registro común. */
async function startUntil(harness: Harness, call: 'query' | 'listen'): Promise<{ running: Promise<number> }> {
  const running = startServer(harness.overrides);
  await vi.waitFor(() => expect(harness.calls).toContain(call));
  return { running };
}

/** Igual que `startUntil`, pero crea el arnés a partir de sus opciones. */
async function startAborting(
  options: HarnessOptions,
  call: 'query' | 'listen',
): Promise<{ harness: Harness; result: Promise<number> }> {
  const harness = createHarness(options);
  const { running } = await startUntil(harness, call);
  return { harness, result: running };
}

describe('RF-S13: códigos de salida del arranque', () => {
  it('RF-S13 fila 1: configuración inválida', async () => {
    const harness = createHarness({ env: { DATABASE_URL: undefined } });

    const code = await startServer(harness.overrides);

    expectOutcome(harness, code, { events: ['startup_failed'], code: 1 });
  });

  it('RF-S13 fila 2: BD no disponible', async () => {
    const harness = createHarness({ database: { queryError: new Error('down') } });

    const code = await startServer(harness.overrides);

    expectOutcome(harness, code, { events: ['startup_failed'], code: 1 });
    expect(harness.fakeDatabase.closeCalls()).toBe(1);
  });

  it('RF-S13 fila 2b: BD no disponible con el cierre del Pool colgado', async () => {
    const harness = createHarness({ database: { queryError: new Error('down'), close: 'hang' } });

    const code = await startWithHungClose(harness);

    expectOutcome(harness, code, { events: ['startup_failed', 'shutdown_timeout'], code: 1 });
    expect(harness.capture.records()[1]).toMatchObject({ level: 'error', timeoutMs: 10000 });
  });

  it('RF-S13 fila 3: fallo al escuchar', async () => {
    const harness = createHarness({ listen: LISTEN_FAILURE });

    const code = await startServer(harness.overrides);

    expectOutcome(harness, code, { events: ['startup_failed'], code: 1 });
    expect(harness.fakeDatabase.closeCalls()).toBe(1);
  });

  it('RF-S13 fila 3b: fallo al escuchar con el cierre del Pool colgado', async () => {
    const harness = createHarness({ listen: LISTEN_FAILURE, database: { close: 'hang' } });

    const code = await startWithHungClose(harness);

    expectOutcome(harness, code, { events: ['startup_failed', 'shutdown_timeout'], code: 1 });
    expect(harness.capture.records()[1]).toMatchObject({ timeoutMs: 10000 });
  });
});

describe('RF-S13: códigos de salida del cierre en funcionamiento', () => {
  it('RF-S13 fila 6: señal en funcionamiento', async () => {
    const harness = createHarness();
    const { running } = await startRunning(harness);

    harness.fakeProcess.signal('SIGTERM');
    const code = await running;

    expectOutcome(harness, code, { events: ['startup', 'shutdown_started', 'shutdown_completed'], code: 0 });
    expect(harness.capture.records()[2]).toMatchObject({ exitCode: 0 });
  });

  it('RF-S13 fila 7a: plazo excedido con el servidor colgado', async () => {
    const harness = createHarness({ serverClose: 'hang' });
    const { running } = await startRunning(harness);

    harness.fakeProcess.signal('SIGTERM');
    harness.timers.fire();
    const code = await running;

    expectOutcome(harness, code, { events: ['startup', 'shutdown_started', 'shutdown_timeout'], code: 1 });
    expect(harness.fakeServer.closeAllCalls()).toBe(1);
  });

  it('RF-S13 fila 7b: plazo excedido con el Pool colgado', async () => {
    const harness = createHarness({ database: { close: 'hang' } });
    const { running } = await startRunning(harness);

    harness.fakeProcess.signal('SIGINT');
    harness.timers.fire();
    const code = await running;

    expectOutcome(harness, code, { events: ['startup', 'shutdown_started', 'shutdown_timeout'], code: 1 });
    expect(harness.fakeServer.closeAllCalls()).toBe(1);
  });

  it('RF-S13 fila 8: señal con un cierre en curso', async () => {
    const harness = createHarness({ serverClose: 'hang' });
    const { running } = await startRunning(harness);
    harness.fakeProcess.signal('SIGTERM');

    harness.fakeProcess.signal('SIGTERM');
    const code = await running;

    expectOutcome(harness, code, { events: ['startup', 'shutdown_started'], code: 1 });
  });
});

describe('RF-S13: códigos de salida del aborto del arranque', () => {
  it('RF-S13 fila 4a: señal antes de escuchar', async () => {
    const harness = createHarness({ database: { query: 'pending' } });
    const { running } = await startUntil(harness, 'query');

    harness.fakeProcess.signal('SIGTERM');
    harness.fakeDatabase.pendingQuery.resolve();
    const code = await running;

    expectOutcome(harness, code, { events: ['shutdown_started', 'shutdown_completed'], code: 0 });
    expect(harness.capture.records()).toMatchObject([{ signal: 'SIGTERM' }, { exitCode: 0 }]);
    expect(harness.calls).not.toContain('listen');
    expect(harness.created().server).toBe(0);
    expect(harness.fakeDatabase.closeCalls()).toBe(1);
  });

  it('RF-S13 fila 4b: consulta rechazada tras la señal', async () => {
    const harness = createHarness({ database: { query: 'pending' } });
    const { running } = await startUntil(harness, 'query');

    harness.fakeProcess.signal('SIGINT');
    harness.fakeDatabase.pendingQuery.reject(new DatabaseUnavailableError());
    const code = await running;

    expectOutcome(harness, code, { events: ['shutdown_started', 'shutdown_completed'], code: 0 });
    expect(harness.capture.records()).toMatchObject([{ signal: 'SIGINT' }, { exitCode: 0 }]);
  });

  it('RF-S13 fila 4c: señal entre listen y listening', async () => {
    const harness = createHarness({ listen: 'never' });
    const { running } = await startUntil(harness, 'listen');

    harness.fakeProcess.signal('SIGTERM');
    const code = await running;

    expectOutcome(harness, code, { events: ['shutdown_started', 'shutdown_completed'], code: 0 });
    expect(harness.capture.records()).toMatchObject([{ signal: 'SIGTERM' }, { exitCode: 0 }]);
  });

  it('RF-S13 fila 5: señal y fallo propio de la BD', async () => {
    const harness = createHarness({ database: { query: 'pending' } });
    const { running } = await startUntil(harness, 'query');

    harness.fakeProcess.signal('SIGTERM');
    harness.fakeDatabase.pendingQuery.reject(new Error('syntax error'));
    const code = await running;

    // El orden cronológico es shutdown_started y después startup_failed; se comprueba el conjunto y el último.
    expect(code).toBe(1);
    expect([...harness.events()].sort()).toEqual(['shutdown_completed', 'shutdown_started', 'startup_failed']);
    expect(harness.events().at(-1)).toBe('shutdown_completed');
    expect(harness.capture.records().at(-1)).toMatchObject({ exitCode: 1 });
    expect(harness.fakeProcess.listenerTotal()).toBe(0);
  });
});

describe('RF-S13: excepciones y rechazos (RF-S6)', () => {
  it.each<FatalEvent>(['uncaughtException', 'unhandledRejection'])(
    'RF-S6, RF-S13 fila 9: %s en funcionamiento registra el evento (RF-D18), cierra con el plazo y da 1',
    async (name) => {
      const harness = createHarness();
      const { running } = await startRunning(harness);

      harness.fakeProcess.fatal(name, new Error(`fallo con ${SECRET}`));
      const code = await running;

      expect(code).toBe(1);
      expect(harness.events()).toEqual(['startup', EVENT_NAMES[name], 'shutdown_started', 'shutdown_completed']);
      const [, fatal, started, completed] = harness.capture.records();
      expect(fatal).toMatchObject({ level: 'error', errorClass: 'Error' });
      expect(fatal).not.toHaveProperty('message');
      expect(started).not.toHaveProperty('signal');
      expect(completed).toMatchObject({ level: 'info', exitCode: 1 });
      expect(harness.capture.output()).not.toContain(SECRET);
      expect(harness.timers.delays).toEqual([10000]);
      expect(harness.calls).toEqual(['query', 'listen', 'server_close', 'close']);
    },
  );

  it('RF-S6: el cierre iniciado por el fallo respeta el plazo y el código es 1', async () => {
    const harness = createHarness({ database: { close: 'hang' } });
    const { running } = await startRunning(harness);

    harness.fakeProcess.fatal('uncaughtException', new Error('boom'));
    await harness.timers.armed();
    harness.timers.fire();
    const code = await running;

    expect(code).toBe(1);
    expect(harness.events()).toEqual(['startup', 'uncaught_exception', 'shutdown_started', 'shutdown_timeout']);
    expect(harness.fakeServer.closeAllCalls()).toBe(1);
  });

  it.each<FatalEvent>(['uncaughtException', 'unhandledRejection'])(
    'RF-S6, RF-S13 fila 10: %s durante el arranque con la comprobación pendiente equivale al aborto con código 1',
    async (name) => {
      const harness = createHarness({ database: { query: 'pending' } });
      const { running } = await startUntil(harness, 'query');

      harness.fakeProcess.fatal(name, new Error('boom'));
      harness.fakeDatabase.pendingQuery.resolve();
      const code = await running;

      expect(code).toBe(1);
      expect(harness.events()).toEqual([EVENT_NAMES[name], 'shutdown_started', 'shutdown_completed']);
      expect(harness.capture.records()[2]).toMatchObject({ exitCode: 1 });
      expect(harness.created().server).toBe(0);
      expect(harness.fakeDatabase.closeCalls()).toBe(1);
      expect(harness.fakeProcess.listenerTotal()).toBe(0);
    },
  );

  it.each<FatalEvent>(['uncaughtException', 'unhandledRejection'])(
    'RF-S6, RF-S13 fila 10: %s durante el arranque con listen pendiente cierra el servidor y el Pool con código 1',
    async (name) => {
      const harness = createHarness({ listen: 'never' });
      const { running } = await startUntil(harness, 'listen');

      harness.fakeProcess.fatal(name, new Error('boom'));
      const code = await running;

      expect(code).toBe(1);
      expect(harness.events()).toEqual([EVENT_NAMES[name], 'shutdown_started', 'shutdown_completed']);
      expect(harness.calls).toEqual(['query', 'listen', 'server_close', 'close']);
      expect(harness.timers.delays).toEqual([10000]);
    },
  );

  it('RF-S6: un rechazo imprevisto dentro del propio arranque lo recoge el manejador y da código 1', async () => {
    const harness = createHarness({ database: { query: 'pending' } });
    const { running } = await startUntil(harness, 'query');
    const settled = vi.fn();

    // startServer no rechaza nunca: si lo hiciera, `settled` recibiría el error y no el código.
    running.then(settled, settled);
    harness.fakeProcess.fatal('unhandledRejection', new TypeError('imprevisto'));
    harness.fakeDatabase.pendingQuery.resolve();
    await flushTurns();

    expect(settled).toHaveBeenCalledExactlyOnceWith(1);
    expect(harness.events()).toEqual(['unhandled_rejection', 'shutdown_started', 'shutdown_completed']);
  });

  it.each<FatalEvent>(['uncaughtException', 'unhandledRejection'])(
    'RF-S6, RF-S13 fila 11: %s durante un cierre se registra, el cierre continúa, no es segunda señal y el código es 1',
    async (name) => {
      const harness = createHarness({ serverClose: 'manual' });
      const { running } = await startRunning(harness);
      const settled = vi.fn();
      running.then(settled, settled);
      harness.fakeProcess.signal('SIGTERM');
      await vi.waitFor(() => expect(harness.calls).toContain('server_close'));

      harness.fakeProcess.fatal(name, new Error('boom'));
      await flushTurns();

      // Una segunda señal habría terminado ya el cierre con código 1 y sin `shutdown_completed`.
      expect(settled).not.toHaveBeenCalled();
      expect(harness.events()).toEqual(['startup', 'shutdown_started', EVENT_NAMES[name]]);
      expect(harness.fakeDatabase.closeCalls()).toBe(0);

      harness.fakeServer.releaseClose();
      const code = await running;

      expect(code).toBe(1);
      expect(harness.events()).toEqual(['startup', 'shutdown_started', EVENT_NAMES[name], 'shutdown_completed']);
      expect(harness.capture.records()[3]).toMatchObject({ exitCode: 1 });
      expect(harness.fakeProcess.listenerTotal()).toBe(0);
    },
  );

  it('RF-S6: durante el cierre por un fallo de arranque se registra y el código sigue siendo 1', async () => {
    const harness = createHarness({ database: { queryError: new Error('down'), close: 'hang' } });
    const running = startServer(harness.overrides);
    await harness.timers.armed();

    harness.fakeProcess.fatal('uncaughtException', new Error('boom'));
    harness.timers.fire();
    const code = await running;

    expect(code).toBe(1);
    expect(harness.events()).toEqual(['startup_failed', 'uncaught_exception', 'shutdown_timeout']);
  });

  it.each([
    { label: 'una cadena con un secreto', value: `token ${SECRET}`, type: 'string' },
    { label: 'undefined', value: undefined, type: 'undefined' },
    { label: 'un objeto con un secreto', value: { password: SECRET }, type: 'object' },
    { label: 'null', value: null, type: 'object' },
  ])('RF-S6: un valor que no es Error ($label) solo registra su tipo', async ({ value, type }) => {
    const harness = createHarness();
    const { running } = await startRunning(harness);

    harness.fakeProcess.fatal('unhandledRejection', value);
    const code = await running;

    expect(code).toBe(1);
    expect(harness.capture.records()[1]).toEqual({
      level: 'error',
      event: 'unhandled_rejection',
      time: expect.any(String) as string,
      thrownType: type,
    });
    expect(harness.capture.output()).not.toContain(SECRET);
  });

  it('RF-S6: una excepción emitida tras terminar ya no se registra', async () => {
    const harness = createHarness({ env: { DATABASE_URL: undefined } });
    await startServer(harness.overrides);

    harness.fakeProcess.fatal('uncaughtException', new Error('tarde'));

    expect(harness.events()).toEqual(['startup_failed']);
  });
});

describe('RF-S4: señal durante la comprobación de la base de datos', () => {
  it('RF-S4: los manejadores de señal se registran al principio, antes de cualquier espera', () => {
    const harness = createHarness({ database: { query: 'pending' } });

    const result = startServer(harness.overrides);

    // Dos señales y dos manejadores de excepciones y rechazos.
    expect(harness.fakeProcess.listenerTotal()).toBe(4);
    harness.fakeProcess.signal('SIGTERM');
    harness.fakeDatabase.pendingQuery.resolve();
    return result;
  });

  it('RF-S4: señal con la comprobación de BD pendiente: sin listen, Pool cerrado, código 0', async () => {
    const { harness, result } = await startAborting({ database: { query: 'pending' } }, 'query');

    harness.fakeProcess.signal('SIGTERM');
    await vi.waitFor(() => expect(harness.fakeDatabase.closeCalls()).toBe(1));
    harness.fakeDatabase.pendingQuery.reject(new DatabaseUnavailableError());

    expect(await outcome(result)).toBe(0);
    expect(harness.calls).toEqual(['query', 'close']);
    expect(harness.created().server).toBe(0);
    expect(harness.events()).toEqual(['shutdown_started', 'shutdown_completed']);
  });

  it('RF-S4: el cierre espera a la comprobación pendiente antes de decidir el código', async () => {
    const { harness, result } = await startAborting({ database: { query: 'pending' } }, 'query');

    harness.fakeProcess.signal('SIGTERM');
    await vi.waitFor(() => expect(harness.fakeDatabase.closeCalls()).toBe(1));

    expect(await outcome(result)).toBe('pending');
    expect(harness.events()).toEqual(['shutdown_started']);
    harness.fakeDatabase.pendingQuery.reject(new Error('syntax error at or near "SELEC"'));
    expect(await outcome(result)).toBe(1);
  });

  it('RF-S3: DatabaseUnavailableError sin señal previa es causa propia (startup_failed, código 1)', async () => {
    const harness = createHarness({ database: { queryError: new DatabaseUnavailableError() } });

    const code = await startServer(harness.overrides);

    expect(code).toBe(1);
    expect(harness.events()).toEqual(['startup_failed']);
  });
});

describe('RF-S4: señal entre listen y listening', () => {
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
    const { harness, result } = await startAborting({ listen: 'never' }, 'listen');

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
    const { harness, result } = await startAborting({ database: { query: 'pending' } }, 'query');
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
});

describe('RF-S5: lo que termina o falla después de que el servicio ya haya terminado', () => {
  it('RF-S5: un cierre del servidor que termina tras una segunda señal no emite shutdown_completed', async () => {
    const harness = createHarness({ serverClose: 'manual' });
    const { running } = await startRunning(harness);
    harness.fakeProcess.signal('SIGTERM');
    await vi.waitFor(() => expect(harness.calls).toContain('server_close'));
    harness.fakeProcess.signal('SIGTERM');
    const code = await running;

    harness.fakeServer.releaseClose();
    await flushTurns();

    expectOutcome(harness, code, { events: ['startup', 'shutdown_started'], code: 1 });
  });

  it('RF-S5: un cierre del Pool tras un fallo de arranque que acaba tras otra señal no cambia nada', async () => {
    const harness = createHarness({ database: { queryError: new Error('down'), close: 'manual' } });
    const running = startServer(harness.overrides);
    await vi.waitFor(() => expect(harness.calls).toContain('close'));
    harness.fakeProcess.signal('SIGINT');
    const code = await running;

    harness.fakeDatabase.closeControl.resolve();
    await flushTurns();

    expectOutcome(harness, code, { events: ['startup_failed'], code: 1 });
  });

  it('RF-S5: un cierre del Pool que falla tras una segunda señal solo se registra', async () => {
    const harness = createHarness({ database: { queryError: new Error('down'), close: 'manual' } });
    const running = startServer(harness.overrides);
    await vi.waitFor(() => expect(harness.calls).toContain('close'));
    harness.fakeProcess.signal('SIGINT');
    const code = await running;

    harness.fakeDatabase.closeControl.reject(new Error('close failed'));
    await flushTurns();

    expect(code).toBe(1);
    expect(harness.events()).toEqual(['startup_failed', 'uncaught_exception']);
    expect(harness.fakeProcess.listenerTotal()).toBe(0);
  });

  it('RF-S2: un error de listen que llega después de terminar se ignora', async () => {
    const harness = createHarness({ listen: 'never' });
    const { running } = await startUntil(harness, 'listen');
    harness.fakeProcess.signal('SIGTERM');
    const code = await running;

    harness.fakeServer.emitter.emit('error', Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }));
    await flushTurns();

    expectOutcome(harness, code, { events: ['shutdown_started', 'shutdown_completed'], code: 0 });
  });

  it('RF-S4: un listening que llega después de abortar no cambia a funcionamiento ni registra startup', async () => {
    const harness = createHarness({ listen: 'never', serverClose: 'manual' });
    const { running } = await startUntil(harness, 'listen');
    harness.fakeProcess.signal('SIGTERM');
    await vi.waitFor(() => expect(harness.calls).toContain('server_close'));

    harness.fakeServer.emitter.emit('listening');
    await flushTurns();
    harness.fakeServer.releaseClose();
    const code = await running;

    expectOutcome(harness, code, { events: ['shutdown_started', 'shutdown_completed'], code: 0 });
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
