import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../src/db/pool';
import { health } from '../../src/http/health';
import { registerRoute } from '../../src/http/route-table';
import type { Logger } from '../../src/logging/logger';
import { startServer } from '../../src/server/start-server';
import {
  createHarness,
  deferred,
  getFreePort,
  type Harness,
  type HarnessOptions,
  validEnv,
} from '../helpers/server-fakes';
import { buildTestApp } from '../helpers/test-app';

const PROCESS_EVENTS = ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection'] as const;

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
  vi.restoreAllMocks();
});

interface Reply {
  status: number;
  connection: string | undefined;
  body: string;
  socket: net.Socket | null;
}

/** GET con un agente concreto. Su rechazo se consume aparte: así no queda sin manejar si el test falla antes. */
function get(port: number, path: string, agent: http.Agent): Promise<Reply> {
  const reply = new Promise<Reply>((resolve, reject) => {
    let socket: net.Socket | null = null;
    const request = http.get({ host: '127.0.0.1', port, path, agent }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          connection: res.headers.connection,
          body: Buffer.concat(chunks).toString(),
          socket,
        });
      });
      res.on('error', reject);
    });
    request.on('socket', (assigned) => {
      socket = assigned;
    });
    request.on('error', reject);
  });
  reply.catch(() => undefined);
  return reply;
}

function keepAliveAgent(): http.Agent {
  const agent = new http.Agent({ keepAlive: true });
  cleanups.push(() => {
    agent.destroy();
    return Promise.resolve();
  });
  return agent;
}

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

/** `true` si la promesa sigue sin resolverse tras una breve espera real. */
async function isPending(promise: Promise<unknown>): Promise<boolean> {
  const marker = Symbol('pending');
  const outcome = await Promise.race([promise, new Promise((resolve) => setTimeout(resolve, 40, marker))]);
  return outcome === marker;
}

function closeHttp(server: http.Server): () => Promise<void> {
  return () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => {
        resolve();
      });
    });
}

interface Running {
  readonly harness: Harness;
  readonly port: number;
  readonly result: Promise<number>;
  /** Se cumple cuando la petición `/hold` ya está dentro del manejador. */
  readonly entered: Promise<void>;
  /** Libera las peticiones `/hold` retenidas. */
  release(): void;
}

/**
 * Arranca `startServer` con un servidor `http` REAL en loopback y un puerto libre, con Pool y proceso falsos.
 * `GET /hold` retiene la petición hasta `release()` y después responde con el manejador de `/health`.
 */
async function startReal(options: HarnessOptions = {}): Promise<Running> {
  const port = await getFreePort();
  const harness = createHarness({ ...options, env: validEnv({ PORT: String(port), HOST: '127.0.0.1' }) });
  const entered = deferred();
  const gate = deferred();
  const createServer = (logger: Logger, database: Database): http.Server => {
    const app = buildTestApp({
      logger,
      database,
      registerRoutes: (target) => {
        registerRoute(target, '/hold', {
          GET: async (req, res) => {
            entered.resolve();
            await gate.promise;
            res.once('finish', () => harness.calls.push('response_sent'));
            health(req, res);
          },
        });
      },
    });
    const server = http.createServer(app);
    cleanups.push(closeHttp(server));
    return server;
  };
  cleanups.push(() => {
    gate.resolve();
    return Promise.resolve();
  });
  const result = startServer({ ...harness.overrides, createServer });
  await vi.waitFor(() => expect(harness.events()).toContain('startup'));
  return { harness, port, result, entered: entered.promise, release: () => gate.resolve() };
}

/** Arranca con servidor, Pool y proceso falsos; espera al evento `startup`. */
async function startFake(options: HarnessOptions = {}): Promise<{ harness: Harness; result: Promise<number> }> {
  const harness = createHarness(options);
  const result = startServer(harness.overrides);
  await vi.waitFor(() => expect(harness.events()).toContain('startup'));
  return { harness, result };
}

describe('RF-S4: cierre ordenado con servidor real', () => {
  it('RF-S4: SIGTERM con petición en curso: 200 con Connection: close, Pool cerrado DESPUÉS, código 0', async () => {
    const running = await startReal();
    const inflight = get(running.port, '/hold', keepAliveAgent());
    await running.entered;

    running.harness.fakeProcess.signal('SIGTERM');

    expect(await isPending(running.result)).toBe(true);
    expect(running.harness.fakeDatabase.closeCalls()).toBe(0);
    running.release();
    const reply = await inflight;
    expect(reply.status).toBe(200);
    expect(reply.connection).toBe('close');
    expect(await running.result).toBe(0);
    expect(running.harness.calls).toEqual(['query', 'response_sent', 'close']);
    await vi.waitFor(() => expect(reply.socket?.destroyed).toBe(true));
  });

  it('RF-S4: SIGINT inicia el mismo cierre', async () => {
    const running = await startReal();

    running.harness.fakeProcess.signal('SIGINT');

    expect(await running.result).toBe(0);
    expect(running.harness.events()).toEqual(['startup', 'shutdown_started', 'shutdown_completed']);
    expect(running.harness.capture.records()[1]).toMatchObject({ signal: 'SIGINT' });
    expect(running.harness.fakeDatabase.closeCalls()).toBe(1);
  });

  it('RF-S4: una conexión nueva se rechaza tras la señal (ECONNREFUSED)', async () => {
    const running = await startReal();
    const inflight = get(running.port, '/hold', keepAliveAgent());
    await running.entered;
    expect(await connectionOutcome(running.port)).toBe('connected');

    running.harness.fakeProcess.signal('SIGTERM');

    expect(await connectionOutcome(running.port)).toBe('ECONNREFUSED');
    running.release();
    await inflight;
    expect(await running.result).toBe(0);
  });

  it('RF-S4: una conexión keep-alive ociosa se cierra y el cierre no espera al plazo', async () => {
    const running = await startReal();
    const reply = await get(running.port, '/health', keepAliveAgent());
    expect(reply.connection).toBe('keep-alive');
    expect(reply.socket?.destroyed).toBe(false);

    running.harness.fakeProcess.signal('SIGTERM');

    expect(await running.result).toBe(0);
    await vi.waitFor(() => expect(reply.socket?.destroyed).toBe(true));
    expect(running.harness.events()).toEqual(['startup', 'shutdown_started', 'shutdown_completed']);
    expect(running.harness.timers.active()).toBe(0);
  });

  it('RF-S12: durante el cierre una petición /health en curso responde 200 {"status":"ok"} y cierra', async () => {
    const running = await startReal();
    const inflight = get(running.port, '/hold', keepAliveAgent());
    await running.entered;
    running.harness.fakeProcess.signal('SIGTERM');

    running.release();
    const reply = await inflight;

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({ status: 'ok' });
    expect(reply.connection).toBe('close');
    await vi.waitFor(() => expect(reply.socket?.destroyed).toBe(true));
    expect(await running.result).toBe(0);
  });

  it('RF-S5: plazo excedido con el servidor colgado: shutdown_timeout, conexiones cortadas, código 1', async () => {
    const running = await startReal();
    const inflight = get(running.port, '/hold', keepAliveAgent());
    await running.entered;
    running.harness.fakeProcess.signal('SIGTERM');
    expect(await isPending(running.result)).toBe(true);

    running.harness.timers.fire();

    expect(await running.result).toBe(1);
    await expect(inflight).rejects.toThrow();
    expect(running.harness.events()).toEqual(['startup', 'shutdown_started', 'shutdown_timeout']);
    expect(running.harness.capture.records()[2]).toMatchObject({ level: 'error', timeoutMs: 10000 });
    expect(await connectionOutcome(running.port)).toBe('ECONNREFUSED');
  });

  it('RF-S5: dos señales seguidas con una petición en curso: un único cierre y código 1 inmediato', async () => {
    const running = await startReal();
    const inflight = get(running.port, '/hold', keepAliveAgent());
    await running.entered;

    running.harness.fakeProcess.signal('SIGTERM');
    running.harness.fakeProcess.signal('SIGINT');

    expect(await running.result).toBe(1);
    expect(running.harness.events()).toEqual(['startup', 'shutdown_started']);
    expect(running.harness.fakeDatabase.closeCalls()).toBe(0);
    running.release();
    await inflight;
  });
});

describe('RF-S4: cierre ordenado con servidor falso', () => {
  it('RF-S4: primero se cierra el servidor y después el Pool', async () => {
    const { harness, result } = await startFake();

    harness.fakeProcess.signal('SIGTERM');

    expect(await result).toBe(0);
    expect(harness.calls).toEqual(['query', 'listen', 'server_close', 'close']);
  });

  it('RF-S4: dos señales seguidas inician un único cierre (los eventos no se duplican)', async () => {
    const { harness, result } = await startFake({ serverClose: 'hang' });

    harness.fakeProcess.signal('SIGTERM');
    harness.fakeProcess.signal('SIGTERM');
    harness.fakeProcess.signal('SIGINT');

    expect(await result).toBe(1);
    expect(harness.events().filter((event) => event === 'shutdown_started')).toHaveLength(1);
    expect(harness.calls.filter((call) => call === 'server_close')).toHaveLength(1);
  });

  it('RF-S4: los manejadores de señal se retiran al terminar y startServer no llama a process.exit', async () => {
    const exit = vi.spyOn(process, 'exit');
    const realBefore = PROCESS_EVENTS.map((name) => process.listenerCount(name));
    const { harness, result } = await startFake();
    // Dos señales y, desde la T7, los manejadores de excepciones y rechazos.
    expect(harness.fakeProcess.listenerTotal()).toBe(4);

    harness.fakeProcess.signal('SIGINT');
    await result;

    expect(harness.fakeProcess.listenerTotal()).toBe(0);
    expect(exit).not.toHaveBeenCalled();
    expect(PROCESS_EVENTS.map((name) => process.listenerCount(name))).toEqual(realBefore);
  });

  it('RF-S5: plazo excedido con el cierre del Pool colgado: shutdown_timeout y código 1', async () => {
    const { harness, result } = await startFake({ database: { close: 'hang' } });

    harness.fakeProcess.signal('SIGTERM');
    harness.timers.fire();

    expect(await result).toBe(1);
    expect(harness.events()).toEqual(['startup', 'shutdown_started', 'shutdown_timeout']);
    expect(harness.capture.records()[2]).toMatchObject({ level: 'error', timeoutMs: 10000 });
    expect(harness.fakeServer.closeAllCalls()).toBe(1);
  });

  it('RF-S5: segunda señal con el cierre en curso: termina de inmediato con código 1 y sin más eventos', async () => {
    const { harness, result } = await startFake({ serverClose: 'hang' });
    harness.fakeProcess.signal('SIGTERM');

    harness.fakeProcess.signal('SIGINT');

    expect(await result).toBe(1);
    expect(harness.events()).toEqual(['startup', 'shutdown_started']);
    expect(harness.timers.delays).toEqual([10000]);
    expect(harness.fakeProcess.listenerTotal()).toBe(0);
  });
});

describe('RF-S11: eventos del cierre', () => {
  it('RF-S11: shutdown_started lleva la señal y shutdown_completed lleva exitCode', async () => {
    const { harness, result } = await startFake();

    harness.fakeProcess.signal('SIGTERM');
    await result;

    const [startup, started, completed] = harness.capture.records();
    expect(startup).toMatchObject({ level: 'info', event: 'startup' });
    expect(started).toMatchObject({ level: 'info', event: 'shutdown_started', signal: 'SIGTERM' });
    expect(completed).toMatchObject({ level: 'info', event: 'shutdown_completed', exitCode: 0 });
  });

  it('RF-S11: un cierre del Pool que rechaza se registra como uncaught_exception y el código es 1', async () => {
    const { harness, result } = await startFake({ database: { close: 'reject' } });

    harness.fakeProcess.signal('SIGTERM');

    expect(await result).toBe(1);
    expect(harness.events()).toEqual(['startup', 'shutdown_started', 'uncaught_exception', 'shutdown_completed']);
    expect(harness.capture.records()[3]).toMatchObject({ exitCode: 1 });
  });
});
