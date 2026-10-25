import type { Request, Response } from 'express';
import { HttpError } from '../http-error';
import { RequestAbortedError } from './request-aborted-error';

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
 * para cerrarla y rechaza con 413. No descomprime nada y no mira el tipo de contenido. Si el cliente se va antes de
 * terminar (`error` o `close` sin `end`) rechaza con {@link RequestAbortedError}. El 400 de «menos bytes de los
 * declarados» NO sale de aquí: cuando el cliente solo cierra su lado de escritura, Node lo detecta antes
 * (`clientError`, ver `server/client-error.ts`) y cuando este lector se entera la conexión ya está destruida.
 */
export function readBody(req: Request, res: Response): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const stopListening = (): void => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onAbort);
      req.off('close', onAbort);
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        stopListening();
        req.pause();
        closeConnectionAfterResponse(res);
        reject(new HttpError(413));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      stopListening();
      resolve(Buffer.concat(chunks, size));
    };
    const onAbort = (): void => {
      stopListening();
      reject(new RequestAbortedError());
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onAbort);
    req.on('close', onAbort);
  });
}
