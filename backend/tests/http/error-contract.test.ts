import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { guard } from '../../src/http/guard';
import { HttpError } from '../../src/http/http-error';
import { createCaptureLogger } from '../helpers/capture-logger';
import { createTestApp } from '../helpers/test-app';

const JSON_UTF8 = 'application/json; charset=utf-8';

function routesThrowing(app: Express): void {
  const known: Record<string, HttpError> = {
    '/e400': new HttpError(400, [{ field: 'title', message: 'Es obligatorio.' }]),
    '/e404': new HttpError(404),
    '/e405': new HttpError(405),
    '/e413': new HttpError(413),
    '/e415': new HttpError(415),
    '/e500': new HttpError(500),
  };
  for (const [path, error] of Object.entries(known)) {
    app.get(
      path,
      guard(() => {
        throw error;
      }),
    );
  }
}

function build(): { app: Express; log: ReturnType<typeof createCaptureLogger> } {
  const log = createCaptureLogger();
  return { app: createTestApp({ capture: log, registerRoutes: routesThrowing }).app, log };
}

const EXPECTED = [
  { path: '/e400', status: 400, code: 'VALIDATION_ERROR', message: 'Datos inválidos.' },
  { path: '/e404', status: 404, code: 'NOT_FOUND', message: 'Recurso no encontrado.' },
  { path: '/e405', status: 405, code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido.' },
  {
    path: '/e413',
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
    message: 'El cuerpo de la petición supera el tamaño máximo.',
  },
  { path: '/e415', status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Tipo de contenido no admitido.' },
  { path: '/e500', status: 500, code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' },
] as const;

describe('RF-S7: contrato de errores', () => {
  it.each(EXPECTED)(
    'RF-S7: el error conocido $status devuelve el estado, el sobre completo y JSON con charset',
    async (row) => {
      const { app } = build();

      const res = await request(app).get(row.path);

      expect(res.status).toBe(row.status);
      expect(res.headers['content-type']).toBe(JSON_UTF8);
      const details = row.status === 400 ? [{ field: 'title', message: 'Es obligatorio.' }] : [];
      expect(res.body).toEqual({ error: { code: row.code, message: row.message, details } });
    },
  );

  it('RF-S8: el 500 no lleva X-Powered-By y es JSON con charset', async () => {
    const { app } = build();

    const res = await request(app).get('/e500');

    expect(res.status).toBe(500);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-type']).toBe(JSON_UTF8);
  });

  it('RF-S11: un error conocido 4xx no escribe ninguna línea en el log', async () => {
    const { app, log } = build();

    for (const path of ['/e400', '/e404', '/e405', '/e413', '/e415']) {
      await request(app).get(path);
    }

    expect(log.lines).toEqual([]);
  });
});
