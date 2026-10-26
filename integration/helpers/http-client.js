import http from 'node:http';

/**
 * Petición HTTP real desde 127.0.0.1. El llamador pone TODAS las cabeceras (Node solo añade `Host` y `Connection`).
 * @param {{ port: number, method: string, path: string, headers?: Record<string, string>, body?: string }} options
 * @returns {Promise<{ status: number }>}
 */
export function sendRequest({ port, method, path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const finalHeaders =
      body === undefined ? headers : { ...headers, 'Content-Length': String(Buffer.byteLength(body)) };
    const request = http.request({ host: '127.0.0.1', port, method, path, headers: finalHeaders }, (response) => {
      response.resume();
      response.once('end', () => resolve({ status: response.statusCode ?? 0 }));
    });
    request.setTimeout(15000, () => request.destroy(new Error(`Sin respuesta en 15 s: ${method} ${path}`)));
    request.once('error', reject);
    request.end(body);
  });
}
