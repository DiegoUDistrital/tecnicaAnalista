import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import type { QueryResult } from 'pg';
import type { Database } from '../../src/db/pool';
import type { ProcessLike, ServerDeps, ServerLike, Timers } from '../../src/server/server.types';
import { createCaptureLogger, type CaptureLogger } from './capture-logger';

export interface Deferred<T = void> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

/** Promesa que se resuelve o rechaza desde fuera. */
export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Puerto libre en 127.0.0.1: escucha en el puerto 0, lee el asignado y cierra. */
export async function getFreePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (address === null || typeof address === 'string') {
    throw new Error('No se pudo obtener un puerto libre.');
  }
  return address.port;
}

/** Contraseña centinela de la URL de pruebas: no debe aparecer nunca en la salida. */
export const SENTINEL_PASSWORD = 'sentinel-pw-7f3a9c';

/** Entorno mínimo válido (el resto toma sus valores por defecto); `overrides` lo modifica. */
export function validEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    DATABASE_URL: `postgresql://writer:${SENTINEL_PASSWORD}@127.0.0.1:5433/todo_app_test`,
    ...overrides,
  };
}

export interface FakeTimers extends Timers {
  /** Dispara los temporizadores pendientes que no se hayan cancelado. */
  fire(): void;
  /** Se cumple cuando hay al menos un temporizador armado (evita esperas por tiempo real). */
  armed(): Promise<void>;
  /** Plazos pedidos, en orden. */
  readonly delays: number[];
  /** Cuántos temporizadores se han cancelado. */
  cancelled(): number;
  /** Cuántos temporizadores siguen vivos (ni disparados ni cancelados). */
  active(): number;
}

interface TimerEntry {
  callback: () => void;
  state: 'active' | 'cancelled' | 'fired';
}

export function createFakeTimers(): FakeTimers {
  const entries: TimerEntry[] = [];
  const delays: number[] = [];
  let waiting: Deferred | undefined;
  return {
    delays,
    setTimer(callback, ms) {
      const entry: TimerEntry = { callback, state: 'active' };
      entries.push(entry);
      delays.push(ms);
      waiting?.resolve();
      return () => {
        if (entry.state === 'active') {
          entry.state = 'cancelled';
        }
      };
    },
    fire() {
      for (const entry of entries) {
        if (entry.state === 'active') {
          entry.state = 'fired';
          entry.callback();
        }
      }
    },
    armed() {
      if (entries.length > 0) {
        return Promise.resolve();
      }
      waiting = deferred();
      return waiting.promise;
    },
    cancelled: () => entries.filter((entry) => entry.state === 'cancelled').length,
    active: () => entries.filter((entry) => entry.state === 'active').length,
  };
}

export type ListenBehavior = 'listening' | 'never' | { error: NodeJS.ErrnoException };

export interface FakeServer {
  readonly server: ServerLike;
  readonly emitter: EventEmitter;
  /** Argumentos de cada llamada a `listen`. */
  readonly listenCalls: { port: unknown; host: unknown }[];
  /** Cuántas veces se llamó a `closeAllConnections`. */
  closeAllCalls(): number;
  /** Con `close: 'manual'`, termina el cierre pendiente del servidor (llama al callback de `close`). */
  releaseClose(): void;
}

/** Servidor falso: `listen` responde con `listening`, con `error` o no responde (el test emite a mano). */
export function createFakeServer(
  behavior: ListenBehavior,
  calls: string[] = [],
  close: 'resolve' | 'hang' | 'manual' = 'resolve',
): FakeServer {
  const emitter = new EventEmitter();
  const listenCalls: { port: unknown; host: unknown }[] = [];
  let closeAllCalls = 0;
  let pendingClose: (() => void) | undefined;
  const server = Object.assign(emitter, {
    listen(port: unknown, host: unknown) {
      calls.push('listen');
      listenCalls.push({ port, host });
      if (behavior === 'listening') {
        queueMicrotask(() => emitter.emit('listening'));
      } else if (behavior !== 'never') {
        queueMicrotask(() => emitter.emit('error', behavior.error));
      }
      return server;
    },
    close(callback?: () => void) {
      calls.push('server_close');
      if (close === 'resolve') {
        queueMicrotask(() => callback?.());
      } else if (close === 'manual') {
        pendingClose = callback;
      }
      return server;
    },
    closeAllConnections() {
      closeAllCalls += 1;
    },
  });
  return {
    server: server as unknown as ServerLike,
    emitter,
    listenCalls,
    closeAllCalls: () => closeAllCalls,
    releaseClose: () => pendingClose?.(),
  };
}

export interface FakeDatabaseOptions {
  /** Si se indica, `query` rechaza con este error. */
  queryError?: Error;
  /** Con `'pending'`, `query` no termina hasta que el test llama a `pendingQuery.resolve()` o `.reject()`. */
  query?: 'pending';
  /** Comportamiento de `close`: termina, rechaza, no termina nunca o lo decide el test (`closeControl`). */
  close?: 'resolve' | 'reject' | 'hang' | 'manual';
  /** Registro compartido del orden de las llamadas. */
  calls?: string[];
}

export interface FakeDatabase {
  readonly database: Database;
  readonly queries: string[];
  /** Control de la consulta en modo `'pending'` (si no, se resuelve sola). */
  readonly pendingQuery: Deferred;
  closeCalls(): number;
  /** Control de `close` en modo `'manual'`: el test lo resuelve o lo rechaza cuando quiere. */
  readonly closeControl: Deferred;
}

export function createFakeDatabase(options: FakeDatabaseOptions = {}): FakeDatabase {
  const calls = options.calls ?? [];
  const queries: string[] = [];
  let closeCalls = 0;
  const pendingQuery = deferred();
  const closeControl = deferred();
  const database = {
    query(text: string): Promise<QueryResult> {
      calls.push('query');
      queries.push(text);
      if (options.query === 'pending') {
        return pendingQuery.promise.then(() => ({}) as QueryResult);
      }
      return options.queryError !== undefined ? Promise.reject(options.queryError) : Promise.resolve({} as QueryResult);
    },
    close(): Promise<void> {
      calls.push('close');
      closeCalls += 1;
      if (options.close === 'hang') {
        return new Promise<void>(() => undefined);
      }
      if (options.close === 'manual') {
        return closeControl.promise;
      }
      return options.close === 'reject' ? Promise.reject(new Error('close failed')) : Promise.resolve();
    },
  };
  return { database, queries, pendingQuery, closeControl, closeCalls: () => closeCalls };
}

export interface FakeProcess {
  readonly process: ProcessLike;
  /** Total de manejadores registrados, de cualquier evento. */
  listenerTotal(): number;
  /** Emite una señal en el proceso falso. */
  signal(name: 'SIGTERM' | 'SIGINT'): void;
  /** Emite una excepción o un rechazo no capturados SOLO en el proceso falso (nunca en el real). */
  fatal(name: 'uncaughtException' | 'unhandledRejection', thrown: unknown): void;
}

export function createFakeProcess(): FakeProcess {
  const emitter = new EventEmitter();
  return {
    process: emitter as unknown as ProcessLike,
    listenerTotal: () => emitter.eventNames().reduce((sum, name) => sum + emitter.listenerCount(name), 0),
    signal: (name) => {
      emitter.emit(name);
    },
    fatal: (name, thrown) => {
      emitter.emit(name, thrown);
    },
  };
}

export interface HarnessOptions {
  env?: Record<string, string | undefined>;
  listen?: ListenBehavior;
  database?: FakeDatabaseOptions;
  /** Comportamiento de `server.close`: avisa al terminar, no termina nunca o lo termina el test (`releaseClose`). */
  serverClose?: 'resolve' | 'hang' | 'manual';
}

export interface Harness {
  readonly overrides: Partial<ServerDeps>;
  readonly capture: CaptureLogger;
  readonly timers: FakeTimers;
  readonly fakeProcess: FakeProcess;
  readonly fakeDatabase: FakeDatabase;
  readonly fakeServer: FakeServer;
  /** Orden de las llamadas `query`, `listen`, `server_close` y `close` (la del Pool). */
  readonly calls: string[];
  /** Cuántas veces se pidió crear el Pool y el servidor. */
  created(): { database: number; server: number };
  /** Nombres de los eventos registrados, en orden. */
  events(): unknown[];
}

/** Arma todas las dependencias falsas del arranque con un registro común del orden de llamadas. */
export function createHarness(options: HarnessOptions = {}): Harness {
  const calls: string[] = [];
  const capture = createCaptureLogger();
  const timers = createFakeTimers();
  const fakeProcess = createFakeProcess();
  const fakeDatabase = createFakeDatabase({ ...options.database, calls });
  const fakeServer = createFakeServer(options.listen ?? 'listening', calls, options.serverClose);
  const created = { database: 0, server: 0 };
  return {
    overrides: {
      env: options.env ?? validEnv(),
      logger: capture.logger,
      createDatabase: () => {
        created.database += 1;
        return fakeDatabase.database;
      },
      createServer: () => {
        created.server += 1;
        return fakeServer.server;
      },
      process: fakeProcess.process,
      timers,
    },
    capture,
    timers,
    fakeProcess,
    fakeDatabase,
    fakeServer,
    calls,
    created: () => ({ ...created }),
    events: () => capture.records().map((record) => record.event),
  };
}
