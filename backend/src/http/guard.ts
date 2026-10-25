import type { Request, RequestHandler, Response } from 'express';
import { AppError } from '../errors/app-error';

/**
 * Envuelve un valor lanzado que no es `Error`. Express trata `next(undefined)`, `next(null)` o `next('route')` como
 * «sin error» o control de flujo; con este envoltorio siempre llega un `Error` al manejador central. Su mensaje es
 * fijo y nunca se registra ni se responde: el manejador central desenvuelve `value`.
 */
export class ThrownValue extends AppError {
  constructor(readonly value: unknown) {
    super('Valor no Error lanzado.');
  }
}

/**
 * Ejecuta un manejador de petición (síncrono o asíncrono) y entrega a `next` TODO lo lanzado como `Error`. Como
 * espera la promesa dentro de un `try/catch`, un rechazo nunca queda sin manejar.
 */
export function guard(handler: (req: Request, res: Response) => void | Promise<void>): RequestHandler {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (thrown) {
      next(thrown instanceof Error ? thrown : new ThrownValue(thrown));
    }
  };
}
