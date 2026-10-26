import type { NextFunction, Request, Response } from 'express';
import express, { type Express } from 'express';
import { DatabaseError } from 'pg';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseUnavailableError } from '../../src/errors/database-unavailable-error';
import { guard, ThrownValue } from '../../src/http/guard';
import { HttpError } from '../../src/http/http-error';
import { createCaptureLogger } from '../helpers/capture-logger';
import { listenOnLoopback } from '../helpers/loopback';
import { createTestApp } from '../helpers/test-app';

const GENERIC_500 = { error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.', details: [] } };
const SQL = 'SELECT secret_column FROM tasks WHERE id = $1';

/** Lanza cualquier valor, también los que no son Error: es lo que el test necesita probar. */
function raise(value: unknown): never {
  throw value;
}

function systemError(code: string): Error {
  return Object.assign(new Error('write failed'), { code });
}

function pgError(): DatabaseError {
  const error = new DatabaseError(`invalid input syntax for type uuid: "${SQL}"`, 10, 'error');
  error.code = '22P02';
  return error;
}

function routes(app: Express): void {
  app.get('/ok', (_req, res) => {
    res.json({ ok: true });
  });
  app.get(
    '/sql',
    guard(() => {
      throw new Error(`${SQL} failed`);
    }),
  );
  app.get(
    '/string',
    guard(() => raise('cadena secreta')),
  );
  app.get(
    '/undefined',
    guard(() => raise(undefined)),
  );
  app.get(
    '/null',
    guard(() => raise(null)),
  );
  app.get(
    '/object',
    guard(() => raise({ password: 'x' })),
  );
  app.get(
    '/route',
    guard(() => raise('route')),
  );
  app.get(
    '/reject',
    guard(async () => {
      await Promise.resolve();
      throw new Error('rechazo con SQL ' + SQL);
    }),
  );
  app.get(
    '/reject-undefined',
    guard(async () => {
      await Promise.resolve();
      raise(undefined);
    }),
  );
  app.get(
    '/sqlstate',
    guard(() => {
      throw pgError();
    }),
  );
  app.get(
    '/epipe',
    guard(() => {
      throw systemError('EPIPE');
    }),
  );
  app.get(
    '/econnreset',
    guard(() => {
      throw systemError('ECONNRESET');
    }),
  );
  app.get(
    '/unavailable',
    guard(() => {
      throw new DatabaseUnavailableError();
    }),
  );
  app.get(
    '/known500',
    guard(() => {
      throw new HttpError(500);
    }),
  );
  app.get(
    '/late',
    guard((_req, res) => {
      res.status(200);
      res.write('parcial');
      throw new Error('fallo tras cabeceras');
    }),
  );
  app.get(
    '/late-known',
    guard((_req, res) => {
      res.status(200);
      res.write('parcial');
      throw new HttpError(404);
    }),
  );
}

function build(): { app: Express; log: ReturnType<typeof createCaptureLogger> } {
  const log = createCaptureLogger();
  return { app: createTestApp({ capture: log, registerRoutes: routes }).app, log };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('RF-S10: manejador central', () => {
  it('RF-S10: un Error con SQL y traza da 500 genérico', async () => {
    const { app } = build();

    const res = await request(app).get('/sql');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.body).toEqual(GENERIC_500);
    expect(res.text).not.toContain('SELECT');
    expect(res.text).not.toContain('secret_column');
    expect(res.text).not.toContain('at ');
    expect(res.text).not.toMatch(/[A-Za-z]:[\\/]|\.ts|\.js|node_modules/);
  });

  it.each(['/string', '/undefined', '/null', '/object', '/route'])(
    'RF-S10: lo lanzado en %s (que no es Error) da 500 genérico, no 404',
    async (path) => {
      const { app } = build();

      const res = await request(app).get(path);

      expect(res.status).toBe(500);
      expect(res.body).toEqual(GENERIC_500);
      expect(res.text).not.toContain('secreta');
      expect(res.text).not.toContain('password');
    },
  );

  it.each(['/reject', '/reject-undefined'])(
    'RF-S10: una promesa rechazada en %s da 500 genérico y no dispara unhandledRejection',
    async (path) => {
      const { app } = build();
      const spy = vi.fn();
      process.on('unhandledRejection', spy);
      try {
        const res = await request(app).get(path);
        await new Promise((resolve) => setImmediate(resolve));

        expect(res.status).toBe(500);
        expect(res.body).toEqual(GENERIC_500);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', spy);
      }
    },
  );

  it('RF-S10: un error con SQLSTATE (22P02) da 500 genérico; el log lleva el SQLSTATE sin el message', async () => {
    const { app, log } = build();

    const res = await request(app).get('/sqlstate');

    expect(res.status).toBe(500);
    expect(res.body).toEqual(GENERIC_500);
    const [record] = log.records();
    expect(record).toMatchObject({ event: 'request_error', errorClass: 'DatabaseError', sqlstate: '22P02' });
    expect(record).not.toHaveProperty('message');
    expect(log.output()).not.toContain('secret_column');
  });

  it.each([
    ['/epipe', 'EPIPE'],
    ['/econnreset', 'ECONNRESET'],
  ])('RF-S10: %s no se confunde con un SQLSTATE (se registra como errorCode)', async (path, code) => {
    const { app, log } = build();

    await request(app).get(path);

    const [record] = log.records();
    expect(record).toMatchObject({ event: 'request_error', errorCode: code });
    expect(record).not.toHaveProperty('sqlstate');
  });

  it('RF-S10: DatabaseUnavailableError da 500 genérico', async () => {
    const { app } = build();

    const res = await request(app).get('/unavailable');

    expect(res.status).toBe(500);
    expect(res.body).toEqual(GENERIC_500);
    expect(res.text).not.toContain('Base de datos');
  });

  it('RF-S10: un error tras enviar cabeceras no escribe otra respuesta; se registra y se cierra', async () => {
    const { app, log } = build();
    const loopback = await listenOnLoopback(app);
    try {
      await expect(fetch(`http://127.0.0.1:${loopback.port}/late`).then((res) => res.text())).rejects.toThrow();

      const after = await fetch(`http://127.0.0.1:${loopback.port}/ok`);
      expect(after.status).toBe(200);
    } finally {
      await loopback.close();
    }

    const records = log.records().filter((record) => record['event'] === 'request_error');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ errorClass: 'Error' });
  });

  it('RF-S11: un 4xx conocido tras enviar cabeceras se registra igualmente (respuesta cortada)', async () => {
    const { app, log } = build();
    const loopback = await listenOnLoopback(app);
    try {
      await expect(fetch(`http://127.0.0.1:${loopback.port}/late-known`).then((res) => res.text())).rejects.toThrow();
    } finally {
      await loopback.close();
    }

    expect(log.records().filter((record) => record['event'] === 'request_error')).toHaveLength(1);
  });

  it('RF-S10: Express no escribe la traza en stderr', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app } = build();

    const res = await request(app).get('/sql');
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.status).toBe(500);
    expect(stderr).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('RF-S10: control: el manejador final de Express sí escribe la traza en stderr', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    // El manejador final de Express usa console.error, que escribe en stderr.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const plain = express();
    plain.get('/sql', () => {
      throw new Error(SQL);
    });

    await request(plain).get('/sql');
    // Express registra el error con setImmediate, después de responder.
    await new Promise((resolve) => setImmediate(resolve));

    expect(consoleError).toHaveBeenCalled();
  });
});

describe('RF-S10: guard', () => {
  it.each([undefined, null, 0, '', false, 'route', 'router'])(
    'RF-S10: guard envuelve en ThrownValue lo lanzado que no es Error (%s) y llama a next con él',
    async (value) => {
      const next = vi.fn();
      const handler = guard(() => raise(value));

      await handler({} as Request, {} as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
      const received: unknown = next.mock.calls[0]?.[0];
      expect(received).toBeInstanceOf(ThrownValue);
      expect((received as ThrownValue).value).toBe(value);
    },
  );

  it('RF-S10: guard entrega un Error tal cual y no llama a next si todo va bien', async () => {
    const failure = new Error('x');
    const next = vi.fn();

    await guard(() => {
      throw failure;
    })({} as Request, {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith(failure);

    next.mockClear();
    await guard(() => undefined)({} as Request, {} as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('RF-S11: evento request_error', () => {
  it('RF-S11: request_error se emite una vez por cada 5xx, con errorClass y sin el texto del message', async () => {
    const { app, log } = build();

    await request(app).get('/sql');

    const records = log.records();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ level: 'error', event: 'request_error', errorClass: 'Error' });
    expect(records[0]).not.toHaveProperty('message');
    expect(log.output()).not.toContain('secret_column');
  });

  it('RF-S11: para un valor que no es Error solo se registra thrownType', async () => {
    const { app, log } = build();

    await request(app).get('/string');
    await request(app).get('/undefined');

    const records = log.records();
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ event: 'request_error', thrownType: 'string' });
    expect(records[1]).toMatchObject({ event: 'request_error', thrownType: 'undefined' });
    for (const record of records) {
      expect(record).not.toHaveProperty('errorClass');
      expect(record).not.toHaveProperty('message');
    }
    expect(log.output()).not.toContain('secreta');
  });

  it('RF-S11: un HttpError 500 conocido se registra como 5xx', async () => {
    const { app, log } = build();

    const res = await request(app).get('/known500');

    expect(res.status).toBe(500);
    expect(log.records()).toHaveLength(1);
  });
});
