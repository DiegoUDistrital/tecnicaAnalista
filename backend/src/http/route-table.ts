import type { Express, Request, RequestHandler, Response } from 'express';
import { guard } from './guard';
import { HttpError } from './http-error';

/** Manejadores de una ruta indexados por método HTTP en mayúsculas (`GET`, `POST`...). */
export type MethodHandlers = Readonly<Record<string, (req: Request, res: Response) => void | Promise<void>>>;

/** Los métodos de una ruta como texto, en el orden de la tabla: es el valor de `Allow` y el de `Allow-Methods`. */
function allowedMethods(handlers: MethodHandlers): string {
  return Object.keys(handlers).join(', ');
}

/**
 * Catálogo de las rutas de la API: guarda el patrón y la lista de métodos de cada una, la MISMA que genera `Allow`.
 * Lo consulta el preflight de CORS para responder con los métodos reales de la ruta sin una segunda lista. Solo
 * entran las rutas registradas con el catálogo; `/health` y las rutas de prueba quedan fuera.
 */
export interface RouteCatalog {
  /** Los métodos (`GET, POST`) de la ruta cuyo patrón coincide EXACTAMENTE con `pathname`, o `undefined`. */
  find(pathname: string): string | undefined;
  /** Alta de una ruta: la hace `registerRoute`, nadie más. */
  add(path: string | RegExp, methods: string): void;
}

export function createRouteCatalog(): RouteCatalog {
  const entries: { path: string | RegExp; methods: string }[] = [];
  return {
    add: (path, methods) => {
      entries.push({ path, methods });
    },
    find: (pathname) =>
      entries.find(({ path }) => (typeof path === 'string' ? path === pathname : path.test(pathname)))?.methods,
  };
}

/**
 * Despacha por método desde una tabla. Un método ausente responde 405 con `Allow` generado de las claves de la tabla
 * (en su orden); `Object.hasOwn` evita que un método con nombre de propiedad heredada (`constructor`, `toString`)
 * pase por la tabla. Los manejadores quedan protegidos por `guard`: nadie tiene que acordarse de hacerlo.
 */
export function methodTable(handlers: MethodHandlers): RequestHandler {
  const allow = allowedMethods(handlers);
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
 * `path` puede ser una expresión regular: sin grupos de captura Express no decodifica nada al enrutar (una ruta con
 * `:id` lo decodifica y, si el porcentaje está mal formado, falla antes de decidir el método).
 * Con `catalog` la ruta (patrón y métodos) queda en el catálogo que consulta el preflight de CORS.
 */
export function registerRoute(
  app: Express,
  path: string | RegExp,
  handlers: MethodHandlers,
  catalog?: RouteCatalog,
): void {
  catalog?.add(path, allowedMethods(handlers));
  app.route(path).all(methodTable(handlers));
}
