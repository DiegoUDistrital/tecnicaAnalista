import type { RequestHandler } from 'express';
import helmet from 'helmet';

/**
 * Cabeceras de seguridad estándar de `helmet` con sus valores por defecto (CSP, `X-Content-Type-Options: nosniff`,
 * `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Resource-Policy`, HSTS, etc.). Se registra antes de `/health`
 * para que alcance a TODA respuesta de la aplicación.
 */
export function createSecurityHeaders(): RequestHandler {
  return helmet();
}

/**
 * Pone `Cache-Control: no-store` para que ninguna caché (del navegador o intermedia) guarde los datos de la API. Se
 * registra después de `/health` (que no es una ruta de la API) y antes de la guarda, así que también cubre el 401.
 */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};
