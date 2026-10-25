import { describe, expect, it, vi } from 'vitest';
import { startServer } from '../../src/server/start-server';
import { DatabaseUnavailableError } from '../../src/errors/database-unavailable-error';
import { createHarness, type Harness } from '../helpers/server-fakes';

const LISTEN_FAILURE = { error: Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }) };

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

/** Arranca con el cierre del Pool colgado y dispara el plazo a mano cuando ya está armado. */
async function startWithHungClose(harness: Harness): Promise<number> {
  const running = startServer(harness.overrides);
  await harness.timers.armed();
  harness.timers.fire();
  return running;
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

/** Espera al evento `startup`: el servicio ya está en funcionamiento. */
async function waitForStartup(harness: Harness): Promise<void> {
  await vi.waitFor(() => expect(harness.events()).toContain('startup'));
}

describe('RF-S13: códigos de salida del cierre en funcionamiento', () => {
  it('RF-S13 fila 6: señal en funcionamiento', async () => {
    const harness = createHarness();
    const running = startServer(harness.overrides);
    await waitForStartup(harness);

    harness.fakeProcess.signal('SIGTERM');
    const code = await running;

    expectOutcome(harness, code, { events: ['startup', 'shutdown_started', 'shutdown_completed'], code: 0 });
    expect(harness.capture.records()[2]).toMatchObject({ exitCode: 0 });
  });

  it('RF-S13 fila 7a: plazo excedido con el servidor colgado', async () => {
    const harness = createHarness({ serverClose: 'hang' });
    const running = startServer(harness.overrides);
    await waitForStartup(harness);

    harness.fakeProcess.signal('SIGTERM');
    harness.timers.fire();
    const code = await running;

    expectOutcome(harness, code, { events: ['startup', 'shutdown_started', 'shutdown_timeout'], code: 1 });
    expect(harness.fakeServer.closeAllCalls()).toBe(1);
  });

  it('RF-S13 fila 7b: plazo excedido con el Pool colgado', async () => {
    const harness = createHarness({ database: { close: 'hang' } });
    const running = startServer(harness.overrides);
    await waitForStartup(harness);

    harness.fakeProcess.signal('SIGINT');
    harness.timers.fire();
    const code = await running;

    expectOutcome(harness, code, { events: ['startup', 'shutdown_started', 'shutdown_timeout'], code: 1 });
    expect(harness.fakeServer.closeAllCalls()).toBe(1);
  });

  it('RF-S13 fila 8: señal con un cierre en curso', async () => {
    const harness = createHarness({ serverClose: 'hang' });
    const running = startServer(harness.overrides);
    await waitForStartup(harness);
    harness.fakeProcess.signal('SIGTERM');

    harness.fakeProcess.signal('SIGTERM');
    const code = await running;

    expectOutcome(harness, code, { events: ['startup', 'shutdown_started'], code: 1 });
  });
});

/** Arranca y espera a que el arranque haya llegado a la llamada pedida del registro común. */
async function startUntil(harness: Harness, call: 'query' | 'listen'): Promise<{ running: Promise<number> }> {
  const running = startServer(harness.overrides);
  await vi.waitFor(() => expect(harness.calls).toContain(call));
  return { running };
}

describe('RF-S13: códigos de salida del aborto del arranque', () => {
  it('RF-S13 fila 4a: señal antes de escuchar', async () => {
    const harness = createHarness({ database: { query: 'pending' } });
    const { running } = await startUntil(harness, 'query');

    harness.fakeProcess.signal('SIGTERM');
    harness.fakeDatabase.pendingQuery.resolve();
    const code = await running;

    expectOutcome(harness, code, { events: ['shutdown_started', 'shutdown_completed'], code: 0 });
    expect(harness.capture.records()).toMatchObject([{ signal: 'SIGTERM' }, { exitCode: 0 }]);
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

describe('RF-S13: códigos de salida de excepciones y rechazos', () => {
  const FATAL = [
    { suffix: 'a', name: 'uncaughtException', event: 'uncaught_exception' },
    { suffix: 'b', name: 'unhandledRejection', event: 'unhandled_rejection' },
  ] as const;

  for (const { suffix, name, event } of FATAL) {
    it(`RF-S13 fila 9${suffix}: ${name} en funcionamiento`, async () => {
      const harness = createHarness();
      const running = startServer(harness.overrides);
      await waitForStartup(harness);

      harness.fakeProcess.fatal(name, new Error('boom'));
      const code = await running;

      expectOutcome(harness, code, {
        events: ['startup', event, 'shutdown_started', 'shutdown_completed'],
        code: 1,
      });
      expect(harness.capture.records()[3]).toMatchObject({ exitCode: 1 });
    });

    it(`RF-S13 fila 10${suffix}: ${name} en el arranque`, async () => {
      const harness = createHarness({ database: { query: 'pending' } });
      const { running } = await startUntil(harness, 'query');

      harness.fakeProcess.fatal(name, new Error('boom'));
      harness.fakeDatabase.pendingQuery.resolve();
      const code = await running;

      expectOutcome(harness, code, { events: [event, 'shutdown_started', 'shutdown_completed'], code: 1 });
      expect(harness.capture.records()[2]).toMatchObject({ exitCode: 1 });
      expect(harness.fakeDatabase.closeCalls()).toBe(1);
    });

    it(`RF-S13 fila 11${suffix}: ${name} durante un cierre iniciado por señal`, async () => {
      const harness = createHarness({ serverClose: 'manual' });
      const running = startServer(harness.overrides);
      await waitForStartup(harness);
      harness.fakeProcess.signal('SIGTERM');
      await vi.waitFor(() => expect(harness.calls).toContain('server_close'));

      harness.fakeProcess.fatal(name, new Error('boom'));
      harness.fakeServer.releaseClose();
      const code = await running;

      expectOutcome(harness, code, {
        events: ['startup', 'shutdown_started', event, 'shutdown_completed'],
        code: 1,
      });
      expect(harness.capture.records()[3]).toMatchObject({ exitCode: 1 });
    });
  }
});

interface TableRow {
  row: number;
  options: Parameters<typeof createHarness>[0];
  /** Lleva el escenario hasta el final y devuelve la promesa del código. */
  run(harness: Harness): Promise<{ code: number }>;
  events: string[];
  code: number;
}

/** Arranca y espera a que el servicio esté en funcionamiento. Devuelve un objeto: un `async` aplanaría la promesa. */
async function runUntilStartup(harness: Harness): Promise<{ running: Promise<number> }> {
  const running = startServer(harness.overrides);
  await waitForStartup(harness);
  return { running };
}

const TABLE: TableRow[] = [
  {
    row: 1,
    options: { env: { DATABASE_URL: undefined } },
    run: async (harness) => ({ code: await startServer(harness.overrides) }),
    events: ['startup_failed'],
    code: 1,
  },
  {
    row: 2,
    options: { database: { queryError: new Error('down') } },
    run: async (harness) => ({ code: await startServer(harness.overrides) }),
    events: ['startup_failed'],
    code: 1,
  },
  {
    row: 3,
    options: { listen: LISTEN_FAILURE },
    run: async (harness) => ({ code: await startServer(harness.overrides) }),
    events: ['startup_failed'],
    code: 1,
  },
  {
    row: 4,
    options: { database: { query: 'pending' } },
    run: async (harness) => {
      const { running } = await startUntil(harness, 'query');
      harness.fakeProcess.signal('SIGTERM');
      harness.fakeDatabase.pendingQuery.resolve();
      return { code: await running };
    },
    events: ['shutdown_started', 'shutdown_completed'],
    code: 0,
  },
  {
    row: 5,
    options: { database: { query: 'pending' } },
    run: async (harness) => {
      const { running } = await startUntil(harness, 'query');
      harness.fakeProcess.signal('SIGTERM');
      harness.fakeDatabase.pendingQuery.reject(new Error('syntax error'));
      return { code: await running };
    },
    // Cronológicamente `shutdown_started` va primero (ver la nota de la fila 5 de este archivo).
    events: ['shutdown_started', 'startup_failed', 'shutdown_completed'],
    code: 1,
  },
  {
    row: 6,
    options: {},
    run: async (harness) => {
      const { running } = await runUntilStartup(harness);
      harness.fakeProcess.signal('SIGINT');
      return { code: await running };
    },
    events: ['startup', 'shutdown_started', 'shutdown_completed'],
    code: 0,
  },
  {
    row: 7,
    options: { database: { close: 'hang' } },
    run: async (harness) => {
      const { running } = await runUntilStartup(harness);
      harness.fakeProcess.signal('SIGTERM');
      harness.timers.fire();
      return { code: await running };
    },
    events: ['startup', 'shutdown_started', 'shutdown_timeout'],
    code: 1,
  },
  {
    row: 8,
    options: { serverClose: 'hang' },
    run: async (harness) => {
      const { running } = await runUntilStartup(harness);
      harness.fakeProcess.signal('SIGTERM');
      harness.fakeProcess.signal('SIGINT');
      return { code: await running };
    },
    events: ['startup', 'shutdown_started'],
    code: 1,
  },
  {
    row: 9,
    options: {},
    run: async (harness) => {
      const { running } = await runUntilStartup(harness);
      harness.fakeProcess.fatal('uncaughtException', new Error('boom'));
      return { code: await running };
    },
    events: ['startup', 'uncaught_exception', 'shutdown_started', 'shutdown_completed'],
    code: 1,
  },
  {
    row: 10,
    options: { listen: 'never' },
    run: async (harness) => {
      const { running } = await startUntil(harness, 'listen');
      harness.fakeProcess.fatal('unhandledRejection', new Error('boom'));
      return { code: await running };
    },
    events: ['unhandled_rejection', 'shutdown_started', 'shutdown_completed'],
    code: 1,
  },
  {
    row: 11,
    options: { serverClose: 'manual' },
    run: async (harness) => {
      const { running } = await runUntilStartup(harness);
      harness.fakeProcess.signal('SIGTERM');
      await vi.waitFor(() => expect(harness.calls).toContain('server_close'));
      harness.fakeProcess.fatal('unhandledRejection', new Error('boom'));
      harness.fakeServer.releaseClose();
      return { code: await running };
    },
    events: ['startup', 'shutdown_started', 'unhandled_rejection', 'shutdown_completed'],
    code: 1,
  },
];

describe('RF-S13: tabla completa', () => {
  it('RF-S13: la tabla recorre las once filas sin repetir ni omitir ninguna', () => {
    expect(TABLE.map((entry) => entry.row)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it.each(TABLE)('RF-S13: cada una de las once filas de la tabla tiene su test (fila $row)', async (entry) => {
    const harness = createHarness(entry.options);

    const { code } = await entry.run(harness);

    expect(code).toBe(entry.code);
    expect(harness.events()).toEqual(entry.events);
    expect(harness.fakeProcess.listenerTotal()).toBe(0);
  });
});

describe('RF-S5: lo que termina o falla después de que el servicio ya haya terminado', () => {
  it('RF-S5: un cierre del servidor que termina tras una segunda señal no emite shutdown_completed', async () => {
    const harness = createHarness({ serverClose: 'manual' });
    const running = startServer(harness.overrides);
    await waitForStartup(harness);
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
