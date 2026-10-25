import { describe, expect, it } from 'vitest';
import { createCaptureLogger } from '../helpers/capture-logger';
import { getTestDatabase } from '../helpers/test-database';

describe('RF-D18: error real de PostgreSQL (test 6)', () => {
  it('RF-D18: un UUID inválido no aparece en la salida y el SQLSTATE 22P02 sí', async () => {
    const secret = 'valor-sensible-real-9c1d';
    const capture = createCaptureLogger();
    const client = await getTestDatabase().ownerClient();
    let thrown: unknown;
    try {
      await client.query('select $1::uuid', [secret]);
    } catch (error) {
      thrown = error;
    } finally {
      await client.end();
    }

    // Se comprueba que PostgreSQL sí incluyó el valor en su message: sin eso la prueba no demostraría nada.
    expect((thrown as Error).message).toContain(secret);

    capture.logger.error('query_failed', { thrown });

    expect(capture.output()).not.toContain(secret);
    expect(capture.records()[0]).toMatchObject({ errorClass: 'DatabaseError', sqlstate: '22P02' });
    expect('message' in (capture.records()[0] ?? {})).toBe(false);
  });
});
