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
