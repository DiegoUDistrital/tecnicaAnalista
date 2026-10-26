import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/pool';
import { startServer } from '../../src/server/start-server';
import { createCaptureLogger } from '../helpers/capture-logger';
import { TEST_API_KEY } from '../helpers/security';
import { createHarness, validEnv } from '../helpers/server-fakes';
import { createTestApp } from '../helpers/test-app';

// Valores centinela inventados: no son secretos. Ninguno debe aparecer en los logs.
const WRONG_KEY_SENTINEL = 'Centinela-Clave-Erronea_0123456789-abcdefghijk';
const INVALID_API_KEY_SENTINEL = 'centinela-api-key-invalida-Zq9';

/** Base de datos que siempre falla. El mensaje lleva la key válida a propósito: el logger no debe registrarlo. */
function failingDatabase(): Database {
  return {
    query: () => Promise.reject(new Error(`fallo tras usar la key ${TEST_API_KEY}`)),
    close: () => Promise.resolve(),
  };
}

describe('RF-G18: la key y la cabecera Authorization nunca llegan a los logs', () => {
  it(
    'RF-G18: una petición con key válida que provoca un 500 y una con key errónea de valor centinela dejan ' +
      'los logs sin el centinela, sin la key válida y sin la palabra authorization',
    async () => {
      const capture = createCaptureLogger();
      const { app } = createTestApp({ capture, database: failingDatabase() });

      const failed = await request(app).get('/api/tasks').set('Authorization', `Bearer ${TEST_API_KEY}`);
      expect(failed.status).toBe(500);
      const linesAfterServerError = capture.lines.length;
      expect(linesAfterServerError).toBe(1);

      const denied = await request(app).get('/api/tasks').set('Authorization', `Bearer ${WRONG_KEY_SENTINEL}`);
      expect(denied.status).toBe(401);
      expect(capture.lines).toHaveLength(linesAfterServerError);

      const output = capture.output();
      expect(output).not.toContain(WRONG_KEY_SENTINEL);
      expect(output).not.toContain(TEST_API_KEY);
      expect(output.toLowerCase()).not.toContain('authorization');
    },
  );

  it('RF-G18: una API_KEY inválida centinela no aparece en startup_failed', async () => {
    const harness = createHarness({ env: validEnv({ API_KEY: INVALID_API_KEY_SENTINEL }) });

    const code = await startServer(harness.overrides);

    expect(code).toBe(1);
    expect(harness.events()).toEqual(['startup_failed']);
    expect(harness.capture.output()).toContain('API_KEY: formato inválido');
    expect(harness.capture.output()).not.toContain(INVALID_API_KEY_SENTINEL);
  });
});
