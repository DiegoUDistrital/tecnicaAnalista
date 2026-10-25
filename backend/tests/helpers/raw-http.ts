import net from 'node:net';

export interface RawResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface RawResult {
  /** Todo lo que el servidor escribió en el socket. */
  readonly text: string;
  /** `true` si el servidor cerró la conexión; `false` si fue el cliente (condición `until` o plazo de seguridad). */
  readonly closedByServer: boolean;
  readonly responses: RawResponse[];
}

export interface RawOptions {
  /** Si devuelve `true` sobre lo recibido, el cliente destruye el socket y termina. Por defecto espera al cierre. */
  until?: (text: string) => boolean;
  /** Plazo de seguridad: solo evita que un test cuelgue si el servidor no cierra cuando debería. */
  safetyMs?: number;
}

/** Interpreta las respuestas con `Content-Length` (las únicas que emite la API) que haya en el texto recibido. */
export function parseResponses(text: string): RawResponse[] {
  const responses: RawResponse[] = [];
  let rest = text;
  while (rest.startsWith('HTTP/1.1 ')) {
    const headEnd = rest.indexOf('\r\n\r\n');
    if (headEnd === -1) break;
    const [statusLine = '', ...headerLines] = rest.slice(0, headEnd).split('\r\n');
    const headers: Record<string, string> = {};
    for (const line of headerLines) {
      const colon = line.indexOf(':');
      headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
    }
    const length = Number(headers['content-length'] ?? 0);
    const bodyStart = headEnd + 4;
    if (rest.length < bodyStart + length) break;
    responses.push({
      status: Number(statusLine.split(' ')[1]),
      headers,
      body: rest.slice(bodyStart, bodyStart + length),
    });
    rest = rest.slice(bodyStart + length);
  }
  return responses;
}

/** `true` cuando el texto ya contiene una respuesta completa. */
export function hasCompleteResponse(text: string): boolean {
  return parseResponses(text).length > 0;
}

/**
 * Petición con socket crudo: escribe las partes tal cual (bytes exactos, sin normalizar cabeceras) y devuelve lo que
 * respondió el servidor. Tolera `EPIPE` y `ECONNRESET` (el servidor puede cerrar mientras el cliente aún envía).
 * Espera al evento `close`, no a un tiempo; el plazo de seguridad solo corta un test que de otro modo colgaría.
 */
export function rawRequest(
  port: number,
  parts: readonly (string | Buffer)[],
  options: RawOptions = {},
): Promise<RawResult> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const received: Buffer[] = [];
    let closedByServer = false;
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      const text = Buffer.concat(received).toString('latin1');
      resolve({ text, closedByServer, responses: parseResponses(text) });
    };
    const watchdog = setTimeout(() => {
      socket.destroy();
      finish();
    }, options.safetyMs ?? 3000);

    socket.on('error', () => undefined);
    socket.on('data', (chunk: Buffer) => {
      received.push(chunk);
      if (options.until?.(Buffer.concat(received).toString('latin1')) === true) {
        socket.destroy();
        finish();
      }
    });
    socket.on('close', () => {
      closedByServer = !settled;
      finish();
    });
    socket.on('connect', () => {
      for (const part of parts) {
        socket.write(part);
      }
    });
  });
}
