import type { RequestHandler } from 'express';
import { MemoryStore, rateLimit, type AugmentedRequest, type Options, type RateLimitInfo } from 'express-rate-limit';
import { clientKey } from './client-key';
import { rejectTooMany } from './rate-limit-response';
import type { TrustedProxies } from './trusted-proxies';

export interface RateLimitSettings {
  /** Duración de la ventana fija, en milisegundos. */
  readonly windowMs: number;
  /** Cupo general: peticiones por clave y ventana a toda ruta no exenta. */
  readonly max: number;
  /** Cupo de `POST`: peticiones `POST` autenticadas por clave y ventana. */
  readonly postMax: number;
}

export interface RateLimiters {
  /** Cupo general (se registra antes de la guarda de la key). */
  readonly general: RequestHandler;
  /** Cupo de `POST` (se registra después de la guarda de la key). */
  readonly post: RequestHandler;
  /** Libera los almacenes (sus temporizadores); se puede llamar más de una vez. */
  readonly shutdown: () => void;
}

/**
 * Un limitador con `express-rate-limit`: ventana fija por clave, almacén propio en memoria, clave de cupo calculada por
 * `clientKey` (IP real) y NINGUNA cabecera de cupo (solo `Retry-After`, que fija `rejectTooMany`). `validate: false`
 * evita que la librería escriba en la consola (`console.error`) cuando ve `X-Forwarded-For` o `Forwarded`: nuestro
 * generador de clave ya cubre lo que esas comprobaciones vigilan.
 */
function createLimiter(
  store: MemoryStore,
  settings: { windowMs: number; limit: number },
  trusted: TrustedProxies,
  skip: Options['skip'],
): RequestHandler {
  return rateLimit({
    windowMs: settings.windowMs,
    limit: settings.limit,
    standardHeaders: false,
    legacyHeaders: false,
    validate: false,
    store,
    keyGenerator: (req) => clientKey(req, trusted),
    skip,
    handler: (req, res, next) => {
      // `rateLimit` no figura en los tipos de `Request`; el almacén en memoria siempre informa de `resetTime`.
      const { resetTime } = (req as AugmentedRequest)['rateLimit'] as RateLimitInfo;
      rejectTooMany(req, res, next, (resetTime as Date).getTime());
    },
  });
}

/**
 * Cupo general y cupo de `POST`, cada uno con su `MemoryStore` creado aquí (nada de estado global: cada aplicación
 * tiene sus contadores). El de `POST` ignora el resto de métodos.
 */
export function createRateLimiters(settings: RateLimitSettings, trusted: TrustedProxies): RateLimiters {
  const generalStore = new MemoryStore();
  const postStore = new MemoryStore();
  return {
    general: createLimiter(generalStore, { windowMs: settings.windowMs, limit: settings.max }, trusted, () => false),
    post: createLimiter(
      postStore,
      { windowMs: settings.windowMs, limit: settings.postMax },
      trusted,
      (req) => req.method !== 'POST',
    ),
    shutdown: () => {
      generalStore.shutdown();
      postStore.shutdown();
    },
  };
}
