import type { RequestHandler } from 'express';
import { closeConnectionAfterResponse } from '../http/input/body-reader';
import { collectHeader } from '../http/input/content-headers';
import { isBodyPresent } from '../http/input/request-input';
import type { RouteCatalog } from '../http/route-table';

/**
 * Valida el valor de `CORS_ORIGIN` y devuelve el mensaje fijo del fallo, o `undefined` si es válido. Debe ser UN origen
 * en su forma canónica (`esquema://host[:puerto]`, sin ruta, consulta, fragmento, credenciales ni barra final), y
 * canónica significa que no cambia al normalizarla con `URL` (host en minúsculas, sin el puerto por defecto). Así la
 * comparación posterior es una igualdad de cadenas exacta. Los mensajes nunca llevan el valor.
 */
export function checkCorsOrigin(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return 'CORS_ORIGIN: obligatoria';
  }
  try {
    const url = new URL(raw);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === raw) {
      return undefined;
    }
  } catch {
    // Texto que no es una URL: cae al mensaje común.
  }
  return 'CORS_ORIGIN: origen inválido';
}

/**
 * CORS escrito a mano para UN solo origen. Añade `Vary: Origin` a toda respuesta que pasa por aquí (la respuesta
 * depende de `Origin`, así que una caché no debe reutilizarla para otro origen) y `Access-Control-Allow-Origin` solo si
 * la petición trae exactamente UNA cabecera `Origin` idéntica al origen permitido. Nunca refleja otro origen, nunca
 * envía `*` ni `Allow-Credentials`. No decide nada: la petición sigue su camino (la protección es la API key).
 * `Origin` se cuenta sobre `rawHeaders` porque Node descarta las repetidas en `req.headers`.
 */
export function createCors(allowedOrigin: string): RequestHandler {
  return (req, res, next) => {
    res.vary('Origin');
    const origins = collectHeader(req.rawHeaders, 'origin');
    if (origins.length === 1 && origins[0] === allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    }
    next();
  };
}

/**
 * Responde el preflight de CORS: `OPTIONS` con exactamente un `Origin` igual al permitido,
 * `Access-Control-Request-Method` no vacío (su valor no se valida: decide el navegador) y una ruta del catálogo (el
 * `pathname` crudo y sin consulta coincide EXACTAMENTE con una ruta de la API). Contesta 204 sin cuerpo con los
 * métodos REALES de la ruta (los mismos que el `Allow` del 405) y sin pedir la key, porque el navegador no envía
 * `Authorization` en el preflight. Cualquier otra petición sigue su camino: un `OPTIONS` que no cumple todo es un
 * `OPTIONS` normal (401, 405 o 404). Si el preflight trae cuerpo no se lee y se pide cerrar la conexión. No se
 * registra nada: no es un fallo.
 * Debe ir después de `createCors` (que ya puso `Vary` y `Allow-Origin`) y del cupo general, y antes de la guarda.
 */
export function createPreflight(allowedOrigin: string, catalog: RouteCatalog): RequestHandler {
  return (req, res, next) => {
    const origins = collectHeader(req.rawHeaders, 'origin');
    const requestedMethod = req.headers['access-control-request-method'];
    const methods = req.method === 'OPTIONS' ? catalog.find(req.path) : undefined;
    if (methods === undefined || origins.length !== 1 || origins[0] !== allowedOrigin || !requestedMethod) {
      next();
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    if (isBodyPresent(req)) {
      closeConnectionAfterResponse(res);
    }
    res.status(204).end();
  };
}
