import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { isPortFree, waitForPort } from '../scripts/lib/ports.js';
import { rejectionOf } from './helpers/rejection.js';

/** @type {net.Server[]} */
const servers = [];

/**
 * @param {number} port
 * @returns {Promise<net.Server>}
 */
function listen(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    servers.push(server);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

/**
 * @param {net.Server} server
 * @returns {number}
 */
function portOf(server) {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('sin dirección');
  return address.port;
}

/**
 * @param {net.Server} server
 * @returns {Promise<void>}
 */
function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** @returns {Promise<number>} un puerto que acaba de quedar libre */
async function freePort() {
  const server = await listen(0);
  const port = portOf(server);
  await close(server);
  return port;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => (server.listening ? close(server) : undefined)));
});

describe('isPortFree', () => {
  it('RF-I6: un puerto ocupado no está libre y uno libre sí', async () => {
    const server = await listen(0);
    const port = portOf(server);
    expect(await isPortFree(port, '127.0.0.1')).toBe(false);
    await close(server);
    expect(await isPortFree(port, '127.0.0.1')).toBe(true);
  });

  it('RF-I6: una dirección que no es de esta máquina es un error y no se confunde con ocupado', async () => {
    await expect(isPortFree(3999, '203.0.113.1')).rejects.toThrow();
  });
});

describe('waitForPort', () => {
  it('RF-I6: waitForPort espera a que alguien escuche y falla con el plazo', async () => {
    const port = await freePort();
    const waiting = waitForPort(port, '127.0.0.1', 5000, 'backend');
    setTimeout(() => void listen(port), 250);
    await expect(waiting).resolves.toBeUndefined();

    const idlePort = await freePort();
    await expect(waitForPort(idlePort, '127.0.0.1', 300, 'backend')).rejects.toThrow(/plazo/);
  });

  it('RNF-I3: el error de plazo nombra el proceso y no incluye entorno', async () => {
    const port = await freePort();
    process.env.SENTINEL_SECRET = 'sentinel-value-123';
    try {
      const error = await rejectionOf(waitForPort(port, '127.0.0.1', 200, 'frontend'));
      expect(error.message).toContain('frontend');
      expect(error.message).toContain(String(port));
      expect(error.message).not.toContain('sentinel-value-123');
      expect(error.message).not.toContain(process.env.PATH ?? 'no-path');
    } finally {
      delete process.env.SENTINEL_SECRET;
    }
  });
});
