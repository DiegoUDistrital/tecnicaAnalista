import 'server-only';
import { ConfigError } from '../config/config-error';
import type { FrontendConfig } from '../config/frontend-config';
import type { Logger } from '../logging/logger';
import { forward, type BackendMethod, type FetchLike } from './backend-client';
import { checkBodyHeaders } from './body-headers';
import { readBody } from './body-reader';
import { parseJsonBody } from './json-body';
import { checkOrigin } from './origin-guard';
import { parseTaskId } from './request-path';
import { parseEmptyQuery, parseListQuery, type ListFilter } from './request-query';
import { mapResult } from './response-mapper';
import { methodNotAllowed, ownError } from './responses';

export type RouteKind = 'collection' | 'item';
/** Parámetros de la ruta: la ruta con id los entrega como promesa; la de la colección, vacíos. */
export type RouteContext = { params: Promise<{ id?: string }> };
export type RouteHandler = (request: Request, context?: RouteContext) => Promise<Response>;

export interface HandlerDeps {
  /** Entrega la configuración; lanza `ConfigError` si es inválida (plan B: las rutas responden 500). */
  getConfig: () => FrontendConfig;
  logger: Logger;
  /** `fetch` hacia Express; en los tests es un simulado. */
  fetchImpl?: FetchLike;
}

interface RouteSpec {
  /** Métodos que atiende la ruta, en el orden de la cabecera `Allow`. */
  allowed: readonly BackendMethod[];
  /** Plantilla fija para los registros: nunca la URL real. */
  template: '/api/tasks' | '/api/tasks/:id';
}

const ROUTES: Record<RouteKind, RouteSpec> = {
  collection: { allowed: ['GET', 'POST'], template: '/api/tasks' },
  item: { allowed: ['PUT', 'DELETE'], template: '/api/tasks/:id' },
};

/** Causa de rechazo según el fallo de lectura: una conexión cortada (`aborted`) es un cuerpo no válido (400). */
const READ_FAILURE = { too_large: 'too_large', timeout: 'timeout', aborted: 'invalid_body' } as const;

const BODY_METHODS = new Set<string>(['POST', 'PUT']);

function isSupported(allowed: readonly BackendMethod[], method: string): method is BackendMethod {
  return (allowed as readonly string[]).includes(method);
}

/** Pasos 5 a 8 de la validación (solo `POST` y `PUT`): devuelve el cuerpo re-serializado o la respuesta de rechazo. */
async function readJsonBody(request: Request): Promise<{ text: string } | { rejection: Response }> {
  const headerResult = checkBodyHeaders(request.headers);
  if (headerResult !== 'ok') {
    return { rejection: ownError(headerResult) };
  }
  const read = await readBody(request.body);
  if (read.status !== 'ok') {
    return { rejection: ownError(READ_FAILURE[read.status]) };
  }
  const text = parseJsonBody(read.bytes);
  return text === undefined ? { rejection: ownError('invalid_body') } : { text };
}

/**
 * Crea el manejador de una ruta. Todos los métodos (incluidos `PATCH`, `HEAD` y `OPTIONS`) usan este mismo manejador:
 * los no soportados reciben un 405 propio, sin leer la configuración ni tocar Express. Para los soportados, las
 * comprobaciones van en orden fijo y cada una termina con su respuesta; el cuerpo solo se lee tras los pasos 1 a 6.
 * Cualquier error inesperado se registra (sin datos) y responde 500 genérico.
 */
export function createRouteHandler(kind: RouteKind, deps: HandlerDeps): RouteHandler {
  const { allowed, template } = ROUTES[kind];
  const allowHeader = allowed.join(', ');

  return async (request, context) => {
    const { method } = request;
    try {
      if (!isSupported(allowed, method)) {
        return methodNotAllowed(allowHeader, method);
      }
      const config = deps.getConfig();
      if (checkOrigin({ method, headers: request.headers, allowedHosts: config.allowedHosts }) === 'forbidden') {
        return ownError('forbidden');
      }
      let id: string | undefined;
      if (kind === 'item') {
        const params = await context?.params;
        id = parseTaskId(request.url, params?.id ?? '');
        if (id === undefined) {
          return ownError('invalid_id');
        }
      }
      const { search } = new URL(request.url);
      let filter: ListFilter | undefined;
      if (kind === 'collection' && method === 'GET') {
        const query = parseListQuery(search);
        if (query === undefined) {
          return ownError('invalid_query');
        }
        filter = query.filter;
      } else if (!parseEmptyQuery(search)) {
        return ownError('invalid_query');
      }
      let bodyText: string | undefined;
      if (BODY_METHODS.has(method)) {
        const body = await readJsonBody(request);
        if ('rejection' in body) {
          return body.rejection;
        }
        bodyText = body.text;
      }
      const result = await forward({
        config,
        method,
        id,
        filter,
        bodyText,
        browserSignal: request.signal,
        fetchImpl: deps.fetchImpl,
      });
      if (result.kind === 'unreachable') {
        deps.logger.error('route_failed', { method, route: template, error: result.error });
      }
      return mapResult(result, method);
    } catch (error) {
      if (!(error instanceof ConfigError)) {
        deps.logger.error('route_failed', { method, route: template, error });
      }
      return ownError('internal');
    }
  };
}
