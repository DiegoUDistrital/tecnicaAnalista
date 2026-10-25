import type { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCaptureLogger } from '../helpers/capture-logger';
import { createClosedPortDatabase, startApiApp, type ApiApp } from '../helpers/api-app';
import { getTestDatabase } from '../helpers/test-database';
import {
  dropResidualChecks,
  listTemporaryChecks,
  TEMPORARY_CHECK_PREFIX,
  withTemporaryCheck,
} from '../helpers/temporary-check';

const SECRET_TITLE = 'titulo secreto prohibido';
const GENERIC_500 = { error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.', details: [] } };

const capture = createCaptureLogger();
let api: ApiApp;
let owner: Client;

beforeAll(async () => {
  api = await startApiApp({ capture });
  owner = await getTestDatabase().ownerClient();
  await dropResidualChecks(owner);
});

beforeEach(() => {
  capture.lines.length = 0;
});

afterAll(async () => {
  await dropResidualChecks(owner);
  await owner.end();
  await api.close();
});

describe('RF-C2 (ii): violación real de restricción', () => {
  it('RF-C2 (ii): un CHECK temporal violado da 500 genérico, 23514 en el log y sin el título secreto', async () => {
    const res = await withTemporaryCheck(owner, SECRET_TITLE, () =>
      request(api.app).post('/api/tasks').send({ title: SECRET_TITLE, description: 'detalle privado' }),
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual(GENERIC_500);
    expect(res.text).not.toContain(SECRET_TITLE);
    const records = capture.records();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'error',
      event: 'request_error',
      errorClass: 'DatabaseError',
      sqlstate: '23514',
    });
    expect(capture.output()).not.toContain(SECRET_TITLE);
    expect(capture.output()).not.toContain('detalle privado');
    expect(await listTemporaryChecks(owner)).toEqual([]);
  });

  it('RF-C2: la restricción temporal desaparece aunque el test falle', async () => {
    await expect(
      withTemporaryCheck(owner, SECRET_TITLE, async () => {
        expect(await listTemporaryChecks(owner)).toHaveLength(1);
        throw new Error('fallo simulado del test');
      }),
    ).rejects.toThrow('fallo simulado del test');

    expect(await listTemporaryChecks(owner)).toEqual([]);
  });

  it('RF-C2: la limpieza elimina las restricciones residuales con el prefijo', async () => {
    await owner.query(`ALTER TABLE tasks ADD CONSTRAINT "${TEMPORARY_CHECK_PREFIX}residual" CHECK (title <> 'zzz')`);
    expect(await listTemporaryChecks(owner)).toEqual([`${TEMPORARY_CHECK_PREFIX}residual`]);

    await dropResidualChecks(owner);

    expect(await listTemporaryChecks(owner)).toEqual([]);
  });

  it('RF-C2: el título prohibido solo admite caracteres seguros', async () => {
    await expect(withTemporaryCheck(owner, "x'; DROP TABLE tasks;--", () => Promise.resolve())).rejects.toThrow(
      'solo admite',
    );
    expect(await listTemporaryChecks(owner)).toEqual([]);
  });
});

describe('RF-C2 (i): base de datos inalcanzable en escritura', () => {
  it('RF-C2 (i): POST con el Pool a un puerto cerrado responde 500 genérico y el log no lleva datos', async () => {
    const downCapture = createCaptureLogger();
    const down = await startApiApp({
      capture: downCapture,
      database: await createClosedPortDatabase(downCapture.logger),
    });
    try {
      const res = await request(down.app).post('/api/tasks').send({ title: SECRET_TITLE });

      expect(res.status).toBe(500);
      expect(res.body).toEqual(GENERIC_500);
      const records = downCapture.records();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ event: 'request_error', errorClass: 'DatabaseUnavailableError' });
      expect(downCapture.output()).not.toContain(SECRET_TITLE);
    } finally {
      await down.close();
    }
  });
});
