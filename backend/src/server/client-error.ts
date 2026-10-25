import type { Duplex } from 'node:stream';
import { HttpError } from '../http/http-error';
import { buildDetails } from '../validation/details';
import type { ServerLike } from './server.types';

/**
 * Código con el que el analizador HTTP de Node (llhttp) avisa de que la conexión terminó con el cuerpo incompleto:
 * el cliente declaró más bytes de los que envió (`Content-Length`) o cortó un `chunked` a mitad, y cerró su lado de
 * escritura. Observado en Node 26 con un socket crudo: Node emite `clientError` con este código ANTES de que el
 * lector de cuerpo de la aplicación vea nada, y por defecto contesta él un `400 Bad Request` sin JSON.
 */
const INCOMPLETE_BODY_CODE = 'HPE_INVALID_EOF_STATE';

/** Respuesta del contrato de errores para el desajuste de longitud (RF-C24): 400 `body`, y cierra la conexión. */
const LENGTH_MISMATCH_RESPONSE = (() => {
  const body = JSON.stringify(new HttpError(400, buildDetails({ body: 'lengthMismatch' })).toBody());
  return [
    'HTTP/1.1 400 Bad Request',
    'Content-Type: application/json; charset=utf-8',
    'Connection: close',
    `Content-Length: ${Buffer.byteLength(body)}`,
    '',
    body,
  ].join('\r\n');
})();

/** Estados que Node usa por defecto en los demás errores de cliente. */
const DEFAULT_STATUS_LINES: Readonly<Record<string, string>> = {
  HPE_HEADER_OVERFLOW: '431 Request Header Fields Too Large',
  ERR_HTTP_REQUEST_TIMEOUT: '408 Request Timeout',
};

function defaultResponse(error: NodeJS.ErrnoException): string {
  const statusLine = DEFAULT_STATUS_LINES[error.code ?? ''] ?? '400 Bad Request';
  return `HTTP/1.1 ${statusLine}\r\nConnection: close\r\n\r\n`;
}

/** `true` si se puede escribir y no se ha enviado ni un byte por esta conexión (no hay otra respuesta a medias). */
function isUntouched(socket: Duplex): boolean {
  // `clientError` siempre entrega un `net.Socket`, que tiene `bytesWritten`; `Duplex` es solo el tipo de Node.
  return socket.writable && (socket as Duplex & { bytesWritten: number }).bytesWritten === 0;
}

/**
 * Manejador de `clientError`. Al registrar uno, Node deja de aplicar su comportamiento por defecto, así que aquí se
 * reproduce para todos los errores salvo el cuerpo incompleto, que recibe el sobre JSON del contrato (RF-C24).
 *
 * - Cuerpo incompleto con la conexión escribible y sin bytes enviados: 400 `body` con `Connection: close` y cierre.
 * - Cualquier otro error: la misma respuesta que daría Node (400, 431 o 408 sin cuerpo, con `Connection: close`).
 * - Conexión ya no escribible, o con una respuesta ya enviada: solo se destruye el socket, sin escribir ni lanzar.
 *
 * No registra nada: es un fallo del cliente (no un 5xx) y la política de logs (lista cerrada de eventos) no tiene un
 * evento para él. Si el cliente se fue del todo (abortó), la escritura no llega a nadie y no hay efecto.
 */
function handleClientError(error: NodeJS.ErrnoException, socket: Duplex): void {
  if (!isUntouched(socket)) {
    socket.destroy();
    return;
  }
  socket.end(error.code === INCOMPLETE_BODY_CODE ? LENGTH_MISMATCH_RESPONSE : defaultResponse(error));
}

/** Registra el manejador de `clientError` en el servidor (lo usan `startServer` y los tests de la entrada). */
export function attachClientErrorHandler(server: Pick<ServerLike, 'on'>): void {
  server.on('clientError', handleClientError);
}
