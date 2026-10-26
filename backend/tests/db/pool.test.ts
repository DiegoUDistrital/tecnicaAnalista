import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { createPool } from '../../src/db/pool';
import { DatabaseUnavailableError } from '../../src/errors/database-unavailable-error';
import { createCaptureLogger } from '../helpers/capture-logger';

const SETTINGS = { max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 };

function writerUrl(): string {
  const url = process.env['TEST_DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('Falta TEST_DATABASE_URL en el entorno: copie .env.example a .env en la raíz.');
  }
  return url;
}

function urlWith(change: (url: URL) => void): string {
  const url = new URL(writerUrl());
  change(url);
  return url.toString();
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Termina, desde otra sesión del mismo rol, las sesiones de writer cuya consulta empieza por `prefix`. */
async function terminateSessions(prefix: string): Promise<number> {
  const admin = new Client({ connectionString: writerUrl() });
  await admin.connect();
  try {
    const result = await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
       where usename = current_user and datname = current_database() and pid <> pg_backend_pid()
         and query like $1`,
      [`${prefix}%`],
    );
    return result.rowCount ?? 0;
  } finally {
    await admin.end();
  }
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Se esperaba un rechazo y la promesa se resolvió.');
}

describe('RF-D3: Pool contra PostgreSQL real', () => {
  it('RF-D3: la sesión del Pool es el rol writer', async () => {
    const { logger } = createCaptureLogger();
    const pool = createPool({ connectionString: writerUrl(), ...SETTINGS }, logger);
    try {
      const result = await pool.query('select current_user as who');
      expect(result.rows).toEqual([{ who: 'writer' }]);
    } finally {
      await pool.close();
    }
  });
});

describe('RF-D4: fallos de conexión como DatabaseUnavailableError', () => {
  it('RF-D4 (i): un cliente inactivo cuya sesión se termina se registra y el proceso no cae', async () => {
    const capture = createCaptureLogger();
    const pool = createPool({ connectionString: writerUrl(), ...SETTINGS }, capture.logger);
    try {
      await pool.query('select 1 as idle_probe');
      expect(await terminateSessions('select 1 as idle_probe')).toBe(1);
      await sleep(300);
      const events = capture.records().filter((record) => record['event'] === 'pool_client_error');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ level: 'error', errorClass: 'DatabaseError', sqlstate: '57P01' });
      // El Pool sigue siendo utilizable: abre otra conexión.
      expect((await pool.query('select 2 as n')).rows).toEqual([{ n: 2 }]);
    } finally {
      await pool.close();
    }
  });

  it('RF-D4 (ii): con el Pool lleno y plazo de 100 ms, la segunda operación falla rápido', async () => {
    const { logger } = createCaptureLogger();
    const pool = createPool(
      { connectionString: writerUrl(), max: 1, idleTimeoutMillis: 30000, connectionTimeoutMillis: 100 },
      logger,
    );
    try {
      const long = pool.query('select pg_sleep(1.5)');
      await sleep(200);
      const started = Date.now();
      const error = await rejection(pool.query('select 1'));
      expect(error).toBeInstanceOf(DatabaseUnavailableError);
      expect(Date.now() - started).toBeLessThan(2000);
      await long;
    } finally {
      await pool.close();
    }
  });

  it('RF-D4 (iii): puerto cerrado: mismo error y su message no contiene URL ni host', async () => {
    const { logger } = createCaptureLogger();
    const url = urlWith((u) => {
      u.port = '1';
    });
    const pool = createPool({ connectionString: url, ...SETTINGS }, logger);
    try {
      const error = await rejection(pool.query('select 1'));
      expect(error).toBeInstanceOf(DatabaseUnavailableError);
      const message = (error as Error).message;
      expect(message).toBe('Base de datos no disponible.');
      expect(message).not.toContain(new URL(url).hostname);
      expect(message).not.toContain('postgres');
    } finally {
      await pool.close();
    }
  });

  it('RF-D4 (iv): contraseña incorrecta (28P01): mismo error', async () => {
    const { logger } = createCaptureLogger();
    const url = urlWith((u) => {
      u.password = 'contrasena-incorrecta';
    });
    const pool = createPool({ connectionString: url, ...SETTINGS }, logger);
    try {
      expect(await rejection(pool.query('select 1'))).toBeInstanceOf(DatabaseUnavailableError);
    } finally {
      await pool.close();
    }
  });

  it('RF-D4 (v-bis): una operación en curso cuya sesión se termina: mismo error', async () => {
    const { logger } = createCaptureLogger();
    const pool = createPool({ connectionString: writerUrl(), ...SETTINGS }, logger);
    try {
      const inFlight = rejection(pool.query('select pg_sleep(5) as inflight_probe'));
      await sleep(300);
      expect(await terminateSessions('select pg_sleep(5) as inflight_probe')).toBe(1);
      expect(await inFlight).toBeInstanceOf(DatabaseUnavailableError);
    } finally {
      await pool.close();
    }
  });

  it('RF-D4: un error de consulta de SQL llega intacto, sin envolver', async () => {
    const { logger } = createCaptureLogger();
    const pool = createPool({ connectionString: writerUrl(), ...SETTINGS }, logger);
    try {
      const error = await rejection(pool.query('select $1::uuid', ['no-es-un-uuid']));
      expect(error).not.toBeInstanceOf(DatabaseUnavailableError);
      expect((error as { code?: string }).code).toBe('22P02');
    } finally {
      await pool.close();
    }
  });
});

describe('RF-D5: cierre ordenado', () => {
  it('RF-D5: con una consulta en curso, close() queda pendiente hasta que termina', async () => {
    const { logger } = createCaptureLogger();
    const pool = createPool({ connectionString: writerUrl(), ...SETTINGS }, logger);
    const started = Date.now();
    const running = pool.query('select pg_sleep(1) as slept');
    await sleep(100);
    let closed = false;
    const closing = pool.close().then(() => {
      closed = true;
    });
    await sleep(300);
    expect(closed).toBe(false);
    await running;
    await closing;
    expect(closed).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it('RF-D5: llamar a close() dos veces, también a la vez, no falla', async () => {
    const { logger } = createCaptureLogger();
    const pool = createPool({ connectionString: writerUrl(), ...SETTINGS }, logger);
    await pool.query('select 1');
    await expect(Promise.all([pool.close(), pool.close()])).resolves.toBeDefined();
    await expect(pool.close()).resolves.toBeUndefined();
  });

  it('RF-D5: una operación posterior al cierre se rechaza y no reabre el Pool', async () => {
    const { logger } = createCaptureLogger();
    const pool = createPool({ connectionString: writerUrl(), ...SETTINGS }, logger);
    await pool.close();
    expect(await rejection(pool.query('select 1'))).toBeInstanceOf(DatabaseUnavailableError);
    await expect(pool.close()).resolves.toBeUndefined();
  });
});
