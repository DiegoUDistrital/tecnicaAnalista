import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createConnectionTracker } from '../../src/server/connection-tracker';
import type { ServerLike } from '../../src/server/server.types';

function fakeResponse(): ServerResponse {
  return Object.assign(new EventEmitter(), { shouldKeepAlive: true }) as unknown as ServerResponse;
}

function trackedServer(): { server: Pick<ServerLike, 'prependListener'>; emitter: EventEmitter } {
  const emitter = new EventEmitter();
  return { server: emitter as unknown as Pick<ServerLike, 'prependListener'>, emitter };
}

describe('RF-S4: seguimiento de respuestas en curso', () => {
  it('RF-S4: closeAfterResponses quita el keep-alive a las respuestas en curso y no a las ya terminadas', () => {
    const tracker = createConnectionTracker();
    const { server, emitter } = trackedServer();
    tracker.attach(server);
    const inflight = fakeResponse();
    const finished = fakeResponse();
    emitter.emit('request', {}, inflight);
    emitter.emit('request', {}, finished);
    finished.emit('close');

    tracker.closeAfterResponses();

    expect(inflight.shouldKeepAlive).toBe(false);
    expect(finished.shouldKeepAlive).toBe(true);
  });

  it('RF-S4: una petición que llega ya durante el cierre se marca al entrar', () => {
    const tracker = createConnectionTracker();
    const { server, emitter } = trackedServer();
    tracker.attach(server);
    tracker.closeAfterResponses();
    const late = fakeResponse();

    emitter.emit('request', {}, late);

    expect(late.shouldKeepAlive).toBe(false);
  });

  it('RF-S4: attach se registra con prependListener para marcar antes de que el manejador envíe cabeceras', () => {
    const prependListener = vi.fn();
    const server = { prependListener } as unknown as Pick<ServerLike, 'prependListener'>;

    createConnectionTracker().attach(server);

    expect(prependListener).toHaveBeenCalledWith('request', expect.any(Function));
  });
});
