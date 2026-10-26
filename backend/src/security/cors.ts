import type { RequestHandler } from 'express';
import { collectHeader } from '../http/input/content-headers';

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
