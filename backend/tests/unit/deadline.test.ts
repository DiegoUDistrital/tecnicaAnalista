import { describe, expect, it, vi } from 'vitest';
import { runWithin } from '../../src/server/deadline';
import type { Timers } from '../../src/server/server.types';
import { createFakeTimers, deferred } from '../helpers/server-fakes';

/** Temporizadores que exponen la función de cancelación como espía y permiten vencer el plazo a mano. */
function spiedTimers(): { timers: Timers; cancel: ReturnType<typeof vi.fn>; expire(): void; ms(): number | undefined } {
  const cancel = vi.fn();
  let expire = (): void => undefined;
  let requested: number | undefined;
  return {
    cancel,
    timers: {
      setTimer(callback, ms) {
        expire = callback;
        requested = ms;
        return cancel;
      },
    },
    expire: () => {
      expire();
    },
    ms: () => requested,
  };
}

describe('RF-S5: runWithin', () => {
  it('RF-S5: runWithin devuelve completed si la operación termina antes y cancela el temporizador', async () => {
    const spied = spiedTimers();

    const result = await runWithin(() => Promise.resolve(), 1500, spied.timers);

    expect(result).toBe('completed');
    expect(spied.ms()).toBe(1500);
    expect(spied.cancel).toHaveBeenCalledTimes(1);
  });

  it('RF-S5: runWithin con temporizadores falsos deja cero temporizadores vivos al completar', async () => {
    const timers = createFakeTimers();

    await runWithin(() => Promise.resolve(), 10, timers);

    expect(timers.delays).toEqual([10]);
    expect(timers.cancelled()).toBe(1);
    expect(timers.active()).toBe(0);
  });

  it('RF-S5: runWithin devuelve timeout si vence el plazo y un rechazo posterior no queda sin manejar', async () => {
    const spied = spiedTimers();
    const operation = deferred<void>();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const pending = runWithin(() => operation.promise, 50, spied.timers);
      spied.expire();
      const result = await pending;
      operation.reject(new Error('late failure'));
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(result).toBe('timeout');
      expect(spied.cancel).toHaveBeenCalledTimes(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('RF-S5: runWithin propaga el rechazo de la operación si ocurre antes del plazo', async () => {
    const spied = spiedTimers();
    const failure = new Error('close failed');

    await expect(runWithin(() => Promise.reject(failure), 50, spied.timers)).rejects.toBe(failure);

    expect(spied.cancel).toHaveBeenCalledTimes(1);
  });

  it('RF-S5: runWithin propaga una excepción síncrona de la operación y cancela el temporizador', async () => {
    const spied = spiedTimers();
    const failure = new Error('sync failure');

    await expect(
      runWithin(
        () => {
          throw failure;
        },
        50,
        spied.timers,
      ),
    ).rejects.toBe(failure);

    expect(spied.cancel).toHaveBeenCalledTimes(1);
  });
});
