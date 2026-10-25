import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import type { Logger } from '../../src/logging/logger';
import { startServer } from '../../src/server/start-server';
import { createCaptureLogger } from '../helpers/capture-logger';
import { createHarness, getFreePort, SENTINEL_PASSWORD, validEnv } from '../helpers/server-fakes';

const PROCESS_EVENTS = ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection'] as const;

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
  vi.restoreAllMocks();
});

function closeHttp(server: http.Server): () => Promise<void> {
  return () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => {
        resolve();
      });
    });
}

function nextMacrotask(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

describe('RF-S1: configuración inválida y excepciones al crear', () => {
  it('RF-S1: configuración inválida: sin Pool ni escucha, startup_failed y variables sin valores', async () => {
    const harness = createHarness({
      env: validEnv({
        DATABASE_URL: 'secret-bad-url-value',
        PORT: 'secret-bad-port-value',
        SHUTDOWN_TIMEOUT_MS: 'secret-bad-timeout-value',
      }),
    });

    const code = await startServer(harness.overrides);

    expect(code).toBe(1);
    expect(harness.created()).toEqual({ database: 0, server: 0 });
    expect(harness.calls).toEqual([]);
    const [record, ...rest] = harness.capture.records();
    expect(rest).toEqual([]);
    expect(record).toMatchObject({ level: 'error', event: 'startup_failed', errorClass: 'ConfigError' });
    expect(record?.message).toBe(
      [
        'DATABASE_URL: formato inválido',
        'PORT: entero inválido o fuera de rango',
        'SHUTDOWN_TIMEOUT_MS: entero inválido o fuera de rango',
      ].join('; '),
    );
    expect(harness.capture.output()).not.toContain('secret-bad');
  });

  it('RF-S1: createDatabase que lanza síncronamente da startup_failed y código 1, sin Pool que cerrar', async () => {
    const harness = createHarness();
    const overrides = {
      ...harness.overrides,
      createDatabase: () => {
        throw new Error('boom');
      },
    };

    const code = await startServer(overrides);

    expect(code).toBe(1);
    expect(harness.events()).toEqual(['startup_failed']);
    expect(harness.created().server).toBe(0);
    expect(harness.fakeDatabase.closeCalls()).toBe(0);
  });

  it('RF-S1: createServer que lanza síncronamente da startup_failed, cierra el Pool y código 1', async () => {
    const harness = createHarness();
    const overrides = {
      ...harness.overrides,
      createServer: () => {
        throw new Error('boom');
      },
    };

    const code = await startServer(overrides);

    expect(code).toBe(1);
    expect(harness.events()).toEqual(['startup_failed']);
    expect(harness.fakeDatabase.closeCalls()).toBe(1);
    expect(harness.calls).toEqual(['query', 'close']);
  });

  it('RF-S1: startServer no llama a process.exit ni deja manejadores en el proceso real ni en el falso', async () => {
    const exit = vi.spyOn(process, 'exit');
    const before = PROCESS_EVENTS.map((name) => process.listenerCount(name));
    const failing = createHarness({ database: { queryError: new Error('down') } });
    const invalid = createHarness({ env: validEnv({ PORT: '0' }) });
    const working = createHarness();

    await startServer(failing.overrides);
    await startServer(invalid.overrides);
    void startServer(working.overrides);
    await vi.waitFor(() => expect(working.events()).toContain('startup'));

    expect(exit).not.toHaveBeenCalled();
    expect(PROCESS_EVENTS.map((name) => process.listenerCount(name))).toEqual(before);
    expect(failing.fakeProcess.listenerTotal()).toBe(0);
    expect(invalid.fakeProcess.listenerTotal()).toBe(0);
    expect(working.fakeProcess.listenerTotal()).toBe(0);
  });
});

describe('RF-S2: fallo al escuchar', () => {
  it('RF-S2: puerto ocupado (servidor real que ya escucha): startup_failed, Pool cerrado, código 1', async () => {
    const occupant = http.createServer();
    await new Promise<void>((resolve) => occupant.listen(0, '127.0.0.1', resolve));
    cleanups.push(closeHttp(occupant));
    const { port } = occupant.address() as AddressInfo;
    const harness = createHarness({ env: validEnv({ PORT: String(port), HOST: '127.0.0.1' }) });
    const real = { ...harness.overrides, createServer: () => http.createServer() };

    const code = await startServer(real);

    expect(code).toBe(1);
    expect(harness.events()).toEqual(['startup_failed']);
    expect(harness.capture.records()[0]).toMatchObject({ errorClass: 'Error', errorCode: 'EADDRINUSE' });
    expect(harness.fakeDatabase.closeCalls()).toBe(1);
  });

  it('RF-S2: listen que falla con EACCES (servidor falso): startup_failed, Pool cerrado, código 1', async () => {
    const error = Object.assign(new Error('listen EACCES'), { code: 'EACCES' });
    const harness = createHarness({ listen: { error } });

    const code = await startServer(harness.overrides);

    expect(code).toBe(1);
    expect(harness.events()).toEqual(['startup_failed']);
    expect(harness.capture.records()[0]).toMatchObject({ errorCode: 'EACCES' });
    expect(harness.fakeDatabase.closeCalls()).toBe(1);
  });

  it('RF-S2: HOST y PORT de la configuración son los argumentos de listen', async () => {
    const harness = createHarness({ env: validEnv({ PORT: '4321', HOST: '::1' }), listen: 'never' });

    void startServer(harness.overrides);
    await vi.waitFor(() => expect(harness.fakeServer.listenCalls).toHaveLength(1));

    expect(harness.fakeServer.listenCalls[0]).toEqual({ port: 4321, host: '::1' });
  });
});

describe('RF-S3: comprobación de la base de datos', () => {
  it('RF-S3: el Pool se comprueba con una consulta trivial ANTES de llamar a listen', async () => {
    const harness = createHarness();

    void startServer(harness.overrides);
    await vi.waitFor(() => expect(harness.events()).toContain('startup'));

    expect(harness.calls).toEqual(['query', 'listen']);
    expect(harness.fakeDatabase.queries).toEqual(['SELECT 1']);
  });

  it('RF-S3: Pool simulado que falla: startup_failed, Pool cerrado, código 1', async () => {
    const harness = createHarness({ database: { queryError: new Error('connection refused') } });

    const code = await startServer(harness.overrides);

    expect(code).toBe(1);
    expect(harness.events()).toEqual(['startup_failed']);
    expect(harness.calls).toEqual(['query', 'close']);
    expect(harness.created().server).toBe(0);
  });

  it('RF-S3: el mensaje del error de la consulta con la contraseña centinela no llega a la salida', async () => {
    const leaking = new Error(`failed for postgresql://writer:${SENTINEL_PASSWORD}@127.0.0.1:5433/db`);
    const harness = createHarness({ database: { queryError: leaking } });

    await startServer(harness.overrides);

    expect(harness.capture.output()).not.toContain(SENTINEL_PASSWORD);
  });

  it('RF-S3: Pool real contra puerto cerrado con contraseña centinela: código 1 y no sale en la salida', async () => {
    const closedPort = await getFreePort();
    const capture = createCaptureLogger();
    const createServer = vi.fn();
    const env = validEnv({
      DATABASE_URL: `postgresql://writer:${SENTINEL_PASSWORD}@127.0.0.1:${closedPort}/todo_app_test`,
      DB_POOL_CONNECTION_TIMEOUT_MS: '100',
    });

    const code = await startServer({ env, logger: capture.logger, createServer });

    expect(code).toBe(1);
    expect(createServer).not.toHaveBeenCalled();
    expect(capture.records()[0]).toMatchObject({ event: 'startup_failed', errorClass: 'DatabaseUnavailableError' });
    expect(capture.output()).not.toContain(SENTINEL_PASSWORD);
  });
});

describe('RF-S5: cierre del Pool tras un fallo', () => {
  it('RF-S5: el cierre del Pool tras un fallo usa SHUTDOWN_TIMEOUT_MS y cancela el temporizador', async () => {
    const harness = createHarness({
      env: validEnv({ SHUTDOWN_TIMEOUT_MS: '2500' }),
      database: { queryError: new Error('down') },
    });

    await startServer(harness.overrides);

    expect(harness.timers.delays).toEqual([2500]);
    expect(harness.timers.active()).toBe(0);
  });

  it('RF-S5: si el cierre del Pool rechaza, se registra uncaught_exception y el código sigue siendo 1', async () => {
    const harness = createHarness({ database: { queryError: new Error('down'), close: 'reject' } });

    const code = await startServer(harness.overrides);

    expect(code).toBe(1);
    expect(harness.events()).toEqual(['startup_failed', 'uncaught_exception']);
  });
});

describe('RF-S11: evento startup', () => {
  it('RF-S11: startup se emite con host y port solo tras el evento listening', async () => {
    const harness = createHarness({ env: validEnv({ PORT: '4321', HOST: '127.0.0.1' }), listen: 'never' });

    const running = startServer(harness.overrides);
    await vi.waitFor(() => expect(harness.fakeServer.listenCalls).toHaveLength(1));
    await nextMacrotask();
    expect(harness.events()).toEqual([]);

    harness.fakeServer.emitter.emit('listening');
    await vi.waitFor(() => expect(harness.events()).toEqual(['startup']));

    expect(harness.capture.records()[0]).toMatchObject({ level: 'info', host: '127.0.0.1', port: 4321 });
    let settled = false;
    void running.then(() => {
      settled = true;
    });
    await nextMacrotask();
    expect(settled).toBe(false);
  });

  it('RF-S11: arranque real en un puerto libre: startup, /health responde y la promesa sigue pendiente', async () => {
    const port = await getFreePort();
    const harness = createHarness({ env: validEnv({ PORT: String(port), HOST: '127.0.0.1' }) });
    const real = {
      ...harness.overrides,
      createServer: (logger: Logger) => {
        const server = http.createServer(createApp({ logger }));
        cleanups.push(closeHttp(server));
        return server;
      },
    };

    let settled = false;
    void startServer(real).then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(harness.events()).toEqual(['startup']));
    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
    expect(harness.capture.records()[0]).toMatchObject({ host: '127.0.0.1', port });
    expect(settled).toBe(false);
  });
});
