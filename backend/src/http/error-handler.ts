import type { ErrorRequestHandler } from 'express';
import type { Logger } from '../logging/logger';
import { ThrownValue } from './guard';
import { HttpError } from './http-error';

const INTERNAL_BODY = new HttpError(500).toBody();

/**
 * Manejador central de errores. Error conocido (`HttpError`) → su sobre; cualquier otro valor → 500 genérico.
 * Registra `request_error` solo en los 5xx, o siempre si la respuesta ya había empezado (en ese caso cierra la
 * conexión sin escribir una segunda respuesta). NO delega en `next(error)`: el manejador final de Express escribe la
 * traza en stderr y se saltaría la política del logger.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  // Express identifica un manejador de errores por sus cuatro parámetros: `_next` debe declararse aunque no se use.
  return (error: unknown, _req, res, _next) => {
    const thrown = error instanceof ThrownValue ? error.value : error;
    const known = thrown instanceof HttpError;
    const status = known ? thrown.status : 500;
    if (res.headersSent) {
      logger.error('request_error', { thrown });
      res.destroy();
      return;
    }
    if (status >= 500) {
      logger.error('request_error', { thrown });
    }
    res.status(status).json(known ? thrown.toBody() : INTERNAL_BODY);
  };
}
