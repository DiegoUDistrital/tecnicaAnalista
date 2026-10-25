import { describe, expect, it } from 'vitest';
import { startServer } from '../../src/server/start-server';
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
