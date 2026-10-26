import http from 'node:http';

/**
 * @typedef {import('./assert-no-ip-headers.js').RecordedRequest} RecordedRequest
 */

const STUB_TASK_ID = '3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b';
const TASK_PATH = /^\/api\/tasks\/[^/?]+$/;

/**
 * @param {string} method
 * @param {string} url
 * @returns {{ status: number, body?: unknown }}
 */
function answer(method, url) {
  const path = url.split('?')[0] ?? '';
  const task = {
    id: STUB_TASK_ID,
    title: 'Stub task',
    description: '',
    completed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  if (path === '/api/tasks' && method === 'GET') return { status: 200, body: [] };
  if (path === '/api/tasks' && method === 'POST') return { status: 201, body: task };
  if (TASK_PATH.test(path) && method === 'PUT') return { status: 200, body: task };
  if (TASK_PATH.test(path) && method === 'DELETE') return { status: 204 };
  return { status: 404, body: { error: { code: 'NOT_FOUND' } } };
}

/**
 * Express sustituto: escucha donde estaría Express, responde lo justo para completar las cuatro operaciones y
 * REGISTRA lo que recibe (método, URL, cabeceras, cabeceras en bruto y dirección de la conexión). No valida la key.
 * @param {{ port: number, host?: string }} options el puerto 0 elige uno libre (se devuelve en `port`)
 * @returns {Promise<{ requests: RecordedRequest[], port: number, close: () => Promise<void> }>}
 */
export function startStubExpress({ port, host = '127.0.0.1' }) {
  /** @type {RecordedRequest[]} */
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method ?? '',
      url: req.url ?? '',
      headers: { ...req.headers },
      rawHeaders: [...req.rawHeaders],
      remoteAddress: req.socket.remoteAddress,
    });
    req.resume();
    req.once('end', () => {
      const { status, body } = answer(req.method ?? '', req.url ?? '');
      if (body === undefined) {
        res.writeHead(status).end();
      } else {
        res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const { port: boundPort } = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolve({
        requests,
        port: boundPort,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
