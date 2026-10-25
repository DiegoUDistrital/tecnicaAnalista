import type { Request, Response } from 'express';
import { HttpError } from '../http-error';

/** Tamaño máximo del cuerpo de una petición a `/api/*`, en bytes, sea cual sea su tipo. */
export const MAX_BODY_BYTES = 10240;

/**
 * Pide que el servidor cierre la conexión al terminar la respuesta (Node lo hace al ver `Connection: close`).
 * Se usa cuando se deja de leer un cuerpo que sigue llegando: la conexión no queda en un estado confuso.
 */
export function closeConnectionAfterResponse(res: Response): void {
  res.setHeader('Connection', 'close');
}

/**
 * Lee el cuerpo completo con un límite propio de {@link MAX_BODY_BYTES}. Al superarlo deja de leer, marca la conexión
 * para cerrarla y rechaza con 413. No descomprime nada y no mira el tipo de contenido.
 */
export function readBody(req: Request, res: Response): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.off('data', onData);
        req.off('end', onEnd);
        req.pause();
        closeConnectionAfterResponse(res);
        reject(new HttpError(413));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      req.off('data', onData);
      resolve(Buffer.concat(chunks, size));
    };
    req.on('data', onData);
    req.once('end', onEnd);
  });
}
