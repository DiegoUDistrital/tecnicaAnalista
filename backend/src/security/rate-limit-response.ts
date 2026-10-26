import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../http/http-error';
import { closeConnectionAfterResponse } from '../http/input/body-reader';
import { isBodyPresent } from '../http/input/request-input';

/** Segundos enteros que debe esperar el cliente: lo que falta para que termine la ventana, redondeado hacia arriba. */
export function retryAfterSeconds(resetAtMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
}

/**
 * Rechaza una petición por exceso de cupo: fija `Retry-After` y entrega el 429 al manejador central, igual que `Allow`
 * en el 405 (una sola forma de dar formato a los errores). No se leen las cabeceras de cupo de la librería: solo
 * `Retry-After`. Si la petición trae cuerpo no se lee (no hay que gastar recursos con quien ya superó su cupo), así que
 * se pide cerrar la conexión. Un 429 no se registra: no es un fallo del servicio.
 */
export function rejectTooMany(req: Request, res: Response, next: NextFunction, resetAtMs: number): void {
  res.set('Retry-After', String(retryAfterSeconds(resetAtMs, Date.now())));
  if (isBodyPresent(req)) {
    closeConnectionAfterResponse(res);
  }
  next(new HttpError(429));
}
