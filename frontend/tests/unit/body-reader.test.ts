import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readBody } from '../../src/server/proxy/body-reader';

const encoder = new TextEncoder();

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

describe('readBody', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('RF-F19: un cuerpo de 10240 bytes se lee y uno de 10241 da too_large aunque Content-Length mintiera', async () => {
    const ok = await readBody(streamOf(new Uint8Array(10240).fill(97)));
    expect(ok.status).toBe('ok');
    expect(ok.status === 'ok' && ok.bytes.length).toBe(10240);
    const split = await readBody(streamOf(new Uint8Array(5000), new Uint8Array(5000), new Uint8Array(241)));
    expect(split).toEqual({ status: 'too_large' });
  });

  it('RF-F19: la lectura se corta al superar el tope sin cargar el resto', async () => {
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(4096));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    expect(await readBody(stream)).toEqual({ status: 'too_large' });
    expect(pulls).toBe(3);
    expect(cancelled).toBe(true);
  });

  it('RF-F19: un flujo que nunca termina da timeout al avanzar 5 s y cancela el lector', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const pending = readBody(stream);
    await vi.advanceTimersByTimeAsync(4999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ status: 'timeout' });
    expect(cancelled).toBe(true);
  });

  it('RF-F19: un flujo que se corta con error da aborted', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{'));
        controller.error(new Error('reset'));
      },
    });
    expect(await readBody(stream)).toEqual({ status: 'aborted' });
  });

  it('RF-F19: sin cuerpo da 0 bytes', async () => {
    expect(await readBody(null)).toEqual({ status: 'ok', bytes: new Uint8Array() });
    expect(await readBody(streamOf())).toEqual({ status: 'ok', bytes: new Uint8Array() });
  });

  it('RF-F19: el temporizador se limpia siempre', async () => {
    await readBody(streamOf(encoder.encode('{}')));
    expect(vi.getTimerCount()).toBe(0);
    await readBody(streamOf(new Uint8Array(20000)));
    expect(vi.getTimerCount()).toBe(0);
    await readBody(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('x'));
        },
      }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
