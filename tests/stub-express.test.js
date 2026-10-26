import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { isPortFree } from '../scripts/lib/ports.js';
import { startStubExpress } from '../scripts/testing/stub-express.js';

/** @type {Array<{ close: () => Promise<void> }>} */
const started = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((stub) => stub.close()));
});

async function start() {
  const stub = await startStubExpress({ port: 0 });
  started.push(stub);
  return stub;
}

/**
 * @param {number} port
 * @param {string} method
 * @param {string} path
 * @param {Record<string, string>} [headers]
 * @param {string} [body]
 * @returns {Promise<{ status: number, body: string, contentType: string | undefined }>}
 */
function call(port, method, path, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method, path, headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (text += chunk));
      response.on('end', () =>
        resolve({ status: response.statusCode ?? 0, body: text, contentType: response.headers['content-type'] }),
      );
    });
    request.on('error', reject);
    request.end(body);
  });
}

const ID = '3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b';

describe('startStubExpress', () => {
  it('RF-I2: el sustituto registra método, URL, cabeceras (minúsculas), rawHeaders y la dirección', async () => {
    const stub = await start();
    await call(stub.port, 'GET', '/api/tasks?x=1', { 'X-Probe': 'Valor-Raro' });
    expect(stub.requests).toHaveLength(1);
    const [seen] = stub.requests;
    expect(seen?.method).toBe('GET');
    expect(seen?.url).toBe('/api/tasks?x=1');
    expect(seen?.headers['x-probe']).toBe('Valor-Raro');
    expect(seen?.rawHeaders).toContain('X-Probe');
    expect(seen?.remoteAddress).toBe('127.0.0.1');
  });

  it('RF-I2: responde 200 [] a GET, 201 a POST, 200 a PUT, 204 sin cuerpo a DELETE y 404 al resto', async () => {
    const stub = await start();
    const get = await call(stub.port, 'GET', '/api/tasks');
    expect(get.status).toBe(200);
    expect(JSON.parse(get.body)).toEqual([]);
    expect(get.contentType).toMatch(/application\/json/);

    const post = await call(stub.port, 'POST', '/api/tasks', {}, '{"title":"a"}');
    expect(post.status).toBe(201);
    expect(Object.keys(JSON.parse(post.body))).toEqual(['id', 'title', 'description', 'completed', 'createdAt']);

    const put = await call(stub.port, 'PUT', `/api/tasks/${ID}`, {}, '{"completed":true}');
    expect(put.status).toBe(200);
    expect(JSON.parse(put.body).id).toBe(ID);

    const del = await call(stub.port, 'DELETE', `/api/tasks/${ID}`);
    expect(del.status).toBe(204);
    expect(del.body).toBe('');

    const others = [
      ['GET', '/health'],
      ['PATCH', '/api/tasks'],
      ['GET', `/api/tasks/${ID}`],
      ['PUT', '/api/tasks'],
      ['DELETE', '/api/tasks/'],
    ];
    for (const [method, path] of others) {
      expect((await call(stub.port, String(method), String(path))).status).toBe(404);
    }
    expect(stub.requests).toHaveLength(4 + others.length);
  });

  it('RF-I2: rawHeaders conserva dos líneas X-Forwarded-For si llegan dos', async () => {
    const stub = await start();
    const socket = net.connect(stub.port, '127.0.0.1');
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write(
      'GET /api/tasks HTTP/1.1\r\nHost: x\r\nX-Forwarded-For: 1.1.1.1\r\nX-Forwarded-For: 2.2.2.2\r\n' +
        'Connection: close\r\n\r\n',
    );
    socket.resume();
    await new Promise((resolve) => socket.once('close', resolve));
    const raw = stub.requests[0]?.rawHeaders ?? [];
    expect(raw.filter((entry) => entry.toLowerCase() === 'x-forwarded-for')).toHaveLength(2);
  });

  it('RNF-I3: close() libera el puerto', async () => {
    const stub = await startStubExpress({ port: 0 });
    expect(await isPortFree(stub.port)).toBe(false);
    await stub.close();
    expect(await isPortFree(stub.port)).toBe(true);
  });
});
