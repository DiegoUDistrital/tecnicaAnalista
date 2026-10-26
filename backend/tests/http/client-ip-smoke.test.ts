import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { clientKey, connectionAddress } from '../../src/security/client-key';
import { testProxies } from '../helpers/security';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';

/** App mínima que devuelve lo que el generador de clave ve de la conexión. */
function probeApp(): express.Express {
  const app = express();
  app.get('/probe', (req, res) => {
    res.json({
      remote: req.socket.remoteAddress ?? null,
      canonical: connectionAddress(req.socket) ?? null,
      trusted: testProxies('loopback').contains(connectionAddress(req.socket) ?? ''),
      key: clientKey(req, testProxies('loopback')),
    });
  });
  return app;
}

let loopback: LoopbackServer | undefined;

afterEach(async () => {
  await loopback?.close();
  loopback = undefined;
});

describe('RF-G11: humo de la dirección de la conexión en este equipo', () => {
  it('RF-G11: la conexión de Supertest se normaliza a una dirección que loopback cubre', async () => {
    const response = await request(probeApp()).get('/probe').set('X-Forwarded-For', '203.0.113.7');
    const { remote, canonical, trusted, key } = response.body as Record<string, string | boolean | null>;
    expect(['127.0.0.1', '::1', '::ffff:127.0.0.1']).toContain(remote);
    expect(['127.0.0.1', '::1']).toContain(canonical);
    expect(trusted).toBe(true);
    expect(key).toBe('203.0.113.7');
  });

  it('RF-G11: la conexión de listenOnLoopback es 127.0.0.1 o ::ffff:127.0.0.1, cubierta por loopback', async () => {
    loopback = await listenOnLoopback(probeApp());
    const response = await fetch(`http://127.0.0.1:${loopback.port}/probe`, {
      headers: { 'X-Forwarded-For': '203.0.113.7, 198.51.100.1' },
    });
    const body = (await response.json()) as Record<string, string | boolean | null>;
    expect(['127.0.0.1', '::ffff:127.0.0.1']).toContain(body['remote']);
    expect(body['canonical']).toBe('127.0.0.1');
    expect(body['trusted']).toBe(true);
    expect(body['key']).toBe('198.51.100.1');
  });
});
