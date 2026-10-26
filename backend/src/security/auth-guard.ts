import type { RequestHandler } from 'express';
import { HttpError } from '../http/http-error';
import { closeConnectionAfterResponse } from '../http/input/body-reader';
import { isBodyPresent } from '../http/input/request-input';
import { createKeyChecker, readBearerKey } from './api-key';

/**
 * Guarda de la API key (etapa 0 de la tubería, antes de cualquier 404, 405 o lectura del cuerpo). Deja pasar solo la
 * petición con UNA `Authorization: Bearer <key>` correcta; cualquier otra cosa recibe el mismo 401 genérico, sea cual
 * sea la causa (ausente, mal formada, repetida o equivocada), para no dar pistas.
 *
 * El 401 se entrega como `HttpError` al manejador central, igual que `Allow` en el 405: una sola forma de dar formato
 * a los errores. `WWW-Authenticate: Bearer` lo exige el RFC 7235. Si la petición trae cuerpo no se lee (no hay que
 * gastar recursos con quien no está autorizado), así que se pide cerrar la conexión: los bytes que sigan llegando no
 * quedan confundidos con una petición nueva. Un 401 no se registra: no es un fallo del servicio (RF-G18).
 */
export function createAuthGuard(apiKey: string): RequestHandler {
  const matches = createKeyChecker(apiKey);
  return (req, res, next) => {
    const candidate = readBearerKey(req.rawHeaders);
    if (candidate !== undefined && matches(candidate)) {
      next();
      return;
    }
    res.set('WWW-Authenticate', 'Bearer');
    if (isBodyPresent(req)) {
      closeConnectionAfterResponse(res);
    }
    next(new HttpError(401));
  };
}
