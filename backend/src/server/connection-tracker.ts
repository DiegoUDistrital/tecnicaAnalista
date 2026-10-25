import type { ServerResponse } from 'node:http';
import type { ServerLike } from './server.types';

/**
 * Sigue las respuestas en curso para poder cerrar el servidor sin cortarlas. `server.close()` solo deja de aceptar
 * conexiones nuevas y cierra las ociosas: una petición en curso, al terminar, dejaría su conexión abierta en
 * keep-alive. Si se le quita el keep-alive (`shouldKeepAlive = false`), Node envía `Connection: close` y cierra el
 * socket al terminar la respuesta.
 */
export interface ConnectionTracker {
  /** Empieza a seguir las respuestas del servidor. */
  attach(server: Pick<ServerLike, 'prependListener'>): void;
  /** Quita el keep-alive a las respuestas en curso y a las que lleguen después. */
  closeAfterResponses(): void;
}

export function createConnectionTracker(): ConnectionTracker {
  const inFlight = new Set<ServerResponse>();
  let closing = false;
  return {
    attach(server) {
      // Al principio de los oyentes: así la marca llega antes de que el manejador envíe las cabeceras.
      server.prependListener('request', (_req, res) => {
        if (closing) {
          res.shouldKeepAlive = false;
          return;
        }
        inFlight.add(res);
        res.once('close', () => {
          inFlight.delete(res);
        });
      });
    },
    closeAfterResponses() {
      closing = true;
      for (const res of inFlight) {
        res.shouldKeepAlive = false;
      }
      inFlight.clear();
    },
  };
}
