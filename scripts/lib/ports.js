import net from 'node:net';

const RETRY_MS = 100;

/**
 * Indica si un puerto está libre intentando escuchar en él y cerrando enseguida.
 * Solo EADDRINUSE significa «ocupado»; cualquier otro error (permiso, dirección ajena) se propaga.
 * @param {number} port
 * @param {string} [host]
 * @returns {Promise<boolean>}
 */
export function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (/** @type {NodeJS.ErrnoException} */ error) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

/**
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>} true si alguien acepta conexiones
 */
function canConnect(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Espera a que alguien escuche en el puerto. Falla al agotar el plazo, nombrando el proceso y el puerto.
 * @param {number} port
 * @param {string} host
 * @param {number} timeoutMs
 * @param {string} name nombre del proceso que debería escuchar (solo para el mensaje)
 * @returns {Promise<void>}
 */
export async function waitForPort(port, host, timeoutMs, name) {
  const deadline = Date.now() + timeoutMs;
  while (!(await canConnect(port, host))) {
    if (Date.now() >= deadline) {
      throw new Error(`Se agotó el plazo de ${timeoutMs} ms esperando a ${name} en el puerto ${port}`);
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
}
