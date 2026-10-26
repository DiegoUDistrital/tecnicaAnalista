import type { RequestHandler } from 'express';
import { HttpError } from '../http/http-error';
import { closeConnectionAfterResponse } from '../http/input/body-reader';
import { isBodyPresent } from '../http/input/request-input';
import { createKeyChecker, readBearerKey } from './api-key';
import { clientKey } from './client-key';
import { rejectTooMany } from './rate-limit-response';
import type { TrustedProxies } from './trusted-proxies';
import { createWindowCounter } from './window-counter';

export interface AuthFailureSettings {
  /** Direcciones de las que se cree `X-Forwarded-For` (para saber qué IP real falló). */
  readonly trusted: TrustedProxies;
  /** Duración de la ventana fija de fallos, en milisegundos. */
  readonly windowMs: number;
  /** Fallos permitidos por IP y ventana: al llegar a esta cifra la IP queda bloqueada hasta que termine la ventana. */
  readonly maxFailures: number;
}

/**
 * Guarda de la API key (etapa 0 de la tubería, antes de cualquier 404, 405 o lectura del cuerpo). Deja pasar solo la
 * petición con UNA `Authorization: Bearer <key>` correcta; cualquier otra cosa recibe el mismo 401 genérico, sea cual
 * sea la causa (ausente, mal formada, repetida o equivocada), para no dar pistas.
 *
 * Además bloquea la IP que acumula fallos: con `maxFailures` fallos en la ventana, TODA petición de esa IP (también con
 * la key buena) recibe 429 hasta que la ventana termina; si pudiera entrar con la key buena, quien adivina seguiría
 * probando con éxito posible. El contador es propio y se incrementa SOLO aquí, en el instante de emitir un 401: la
 * lectura del contador, la comparación de la key y la suma se hacen en el mismo cuerpo síncrono (sin `await`), así que
 * con peticiones simultáneas la cifra es exacta. Una petición con key válida nunca suma, acabe como acabe, y un 429 no
 * suma. No usa temporizadores (ver `createWindowCounter`).
 *
 * El 401 se entrega como `HttpError` al manejador central, igual que `Allow` en el 405: una sola forma de dar formato
 * a los errores. `WWW-Authenticate: Bearer` lo exige el RFC 7235. Si la petición trae cuerpo no se lee (no hay que
 * gastar recursos con quien no está autorizado), así que se pide cerrar la conexión: los bytes que sigan llegando no
 * quedan confundidos con una petición nueva. Un 401 no se registra: no es un fallo del servicio (RF-G18).
 */
export function createAuthGuard(apiKey: string, failures: AuthFailureSettings): RequestHandler {
  const matches = createKeyChecker(apiKey);
  const counter = createWindowCounter(failures.windowMs);
  return (req, res, next) => {
    const key = clientKey(req, failures.trusted);
    const now = Date.now();
    const current = counter.peek(key, now);
    if (current.count >= failures.maxFailures) {
      rejectTooMany(req, res, next, current.resetAt);
      return;
    }
    const candidate = readBearerKey(req.rawHeaders);
    if (candidate !== undefined && matches(candidate)) {
      next();
      return;
    }
    counter.hit(key, now);
    res.set('WWW-Authenticate', 'Bearer');
    if (isBodyPresent(req)) {
      closeConnectionAfterResponse(res);
    }
    next(new HttpError(401));
  };
}
