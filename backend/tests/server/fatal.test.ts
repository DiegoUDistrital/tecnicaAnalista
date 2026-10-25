import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { guard } from '../../src/http/guard';
import { startServer } from '../../src/server/start-server';
import { createCaptureLogger } from '../helpers/capture-logger';
import { listenOnLoopback } from '../helpers/loopback';
import { createHarness, type Harness } from '../helpers/server-fakes';
import { createTestApp } from '../helpers/test-app';

const SECRET = 'secret-value-4d2e8b';
type FatalEvent = 'uncaughtException' | 'unhandledRejection';
const EVENT_NAMES: Record<FatalEvent, string> = {
  uncaughtException: 'uncaught_exception',
  unhandledRejection: 'unhandled_rejection',
};

afterEach(() => {
  vi.restoreAllMocks();
});

/** Arranca y espera al evento `startup`: el servicio ya está en funcionamiento. */
async function startRunning(harness: Harness): Promise<{ running: Promise<number> }> {
  const running = startServer(harness.overrides);
  await vi.waitFor(() => expect(harness.events()).toContain('startup'));
  return { running };
}

/** Arranca y espera a que el arranque haya llegado a la llamada pedida del registro común. */
async function startUntil(harness: Harness, call: 'query' | 'listen'): Promise<{ running: Promise<number> }> {
  const running = startServer(harness.overrides);
  await vi.waitFor(() => expect(harness.calls).toContain(call));
  return { running };
}

/** Lanza cualquier valor, también los que no son Error: es lo que el test necesita probar. */
function raise(value: unknown): never {
  throw value;
}

/** Cede el turno varias veces: da tiempo a que se procese todo lo que ya estaba pendiente. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe('RF-S6: excepción o rechazo en funcionamiento', () => {
  it.each<FatalEvent>(['uncaughtException', 'unhandledRejection'])(
    'RF-S6: %s en funcionamiento registra el evento con la política de RF-D18, cierra con el plazo y el código es 1',
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
});

describe('RF-S6: excepción o rechazo durante el arranque', () => {
  it.each<FatalEvent>(['uncaughtException', 'unhandledRejection'])(
    'RF-S6: %s durante el arranque con la comprobación pendiente equivale al aborto con código 1',
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
    'RF-S6: %s durante el arranque con listen pendiente cierra el servidor y el Pool con código 1',
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
    await flush();

    expect(settled).toHaveBeenCalledExactlyOnceWith(1);
    expect(harness.events()).toEqual(['unhandled_rejection', 'shutdown_started', 'shutdown_completed']);
  });
});

describe('RF-S6: excepción o rechazo durante un cierre en curso', () => {
  it.each<FatalEvent>(['uncaughtException', 'unhandledRejection'])(
    'RF-S6: %s durante un cierre se registra, el cierre continúa, no es segunda señal y el código pasa de 0 a 1',
    async (name) => {
      const harness = createHarness({ serverClose: 'manual' });
      const { running } = await startRunning(harness);
      const settled = vi.fn();
      running.then(settled, settled);
      harness.fakeProcess.signal('SIGTERM');
      await vi.waitFor(() => expect(harness.calls).toContain('server_close'));

      harness.fakeProcess.fatal(name, new Error('boom'));
      await flush();

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
});

describe('RF-S6: política de registro de lo lanzado', () => {
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

  it('RF-S6: un secreto en el message de un error que no es propio no aparece en la salida', async () => {
    const harness = createHarness();
    const { running } = await startRunning(harness);
    const error = new Error(`connect failed password=${SECRET}`);

    harness.fakeProcess.fatal('uncaughtException', error);
    await running;

    expect(harness.capture.output()).not.toContain(SECRET);
  });
});

describe('RF-S6: manejadores del proceso', () => {
  it('RF-S6: los manejadores de excepciones y rechazos se retiran al terminar, sin llamar a exit', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const harness = createHarness();
    const { running } = await startRunning(harness);
    // Dos señales y dos manejadores de fallos.
    expect(harness.fakeProcess.listenerTotal()).toBe(4);

    harness.fakeProcess.fatal('uncaughtException', new Error('boom'));
    await running;

    expect(harness.fakeProcess.listenerTotal()).toBe(0);
    expect(exit).not.toHaveBeenCalled();
  });

  it('RF-S6: una excepción emitida tras terminar ya no se registra', async () => {
    const harness = createHarness({ env: { DATABASE_URL: undefined } });
    await startServer(harness.overrides);

    harness.fakeProcess.fatal('uncaughtException', new Error('tarde'));

    expect(harness.events()).toEqual(['startup_failed']);
  });
});

describe('RF-S6: las promesas rechazadas dentro de una petición no llegan a unhandledRejection', () => {
  it('RF-S6: los rechazos de los manejadores de petición dan 500 y no llegan a unhandledRejection', async () => {
    const capture = createCaptureLogger();
    const { app } = createTestApp({
      capture,
      registerRoutes: (target) => {
        target.get(
          '/guarded',
          guard(async () => {
            await Promise.resolve();
            throw new Error('rechazo guardado');
          }),
        );
        target.get('/raw', async () => {
          await Promise.resolve();
          throw new Error('rechazo de Express');
        });
        target.get(
          '/undefined',
          guard(() => raise(undefined)),
        );
      },
    });
    const loopback = await listenOnLoopback(app);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      for (const path of ['/guarded', '/raw', '/undefined']) {
        const response = await request(`http://127.0.0.1:${loopback.port}`).get(path);
        expect(response.status).toBe(500);
      }
      await flush();
    } finally {
      process.off('unhandledRejection', unhandled);
      await loopback.close();
    }

    expect(unhandled).not.toHaveBeenCalled();
    expect(capture.records().map((record) => record.event)).toEqual([
      'request_error',
      'request_error',
      'request_error',
    ]);
  });
});

describe('RF-S11: eventos de excepción', () => {
  it('RF-S11: uncaught_exception y unhandled_rejection se emiten una vez cada uno', async () => {
    const first = createHarness();
    const second = createHarness();
    const { running: firstRunning } = await startRunning(first);
    const { running: secondRunning } = await startRunning(second);

    first.fakeProcess.fatal('uncaughtException', new Error('a'));
    second.fakeProcess.fatal('unhandledRejection', new Error('b'));
    await Promise.all([firstRunning, secondRunning]);

    const count = (harness: Harness, event: string): number => harness.events().filter((name) => name === event).length;
    expect(count(first, 'uncaught_exception')).toBe(1);
    expect(count(first, 'unhandled_rejection')).toBe(0);
    expect(count(second, 'unhandled_rejection')).toBe(1);
    expect(count(second, 'uncaught_exception')).toBe(0);
  });
});
