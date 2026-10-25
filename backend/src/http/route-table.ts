import type { Express, Request, RequestHandler, Response } from 'express';
import { guard } from './guard';
import { HttpError } from './http-error';

/** Manejadores de una ruta indexados por método HTTP en mayúsculas (`GET`, `POST`...). */
export type MethodHandlers = Readonly<Record<string, (req: Request, res: Response) => void | Promise<void>>>;

/**
 * Despacha por método desde una tabla. Un método ausente responde 405 con `Allow` generado de las claves de la tabla
 * (en su orden); `Object.hasOwn` evita que un método con nombre de propiedad heredada (`constructor`, `toString`)
 * pase por la tabla. Los manejadores quedan protegidos por `guard`: nadie tiene que acordarse de hacerlo.
 */
export function methodTable(handlers: MethodHandlers): RequestHandler {
  const allow = Object.keys(handlers).join(', ');
  return (req, res, next) => {
    const handler = Object.hasOwn(handlers, req.method) ? handlers[req.method] : undefined;
    if (handler === undefined) {
      res.set('Allow', allow);
      next(new HttpError(405));
      return;
    }
    return guard(handler)(req, res, next);
  };
}

/**
 * Registra una ruta con `app.route(path).all(...)`: `all` coincide con TODOS los métodos (incluidos HEAD, OPTIONS y
 * los que Express no conoce), así que Express no responde nada por su cuenta y la tabla decide siempre.
 */
export function registerRoute(app: Express, path: string, handlers: MethodHandlers): void {
  app.route(path).all(methodTable(handlers));
}
