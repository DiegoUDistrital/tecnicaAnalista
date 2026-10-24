import { DatabaseError } from 'pg';

// Además de toda la clase 08 (conexión) y 57 (intervención del operador): 28P01 (contraseña rechazada)
// y 53300 (demasiadas conexiones).
const UNAVAILABLE_SQLSTATES = new Set(['28P01', '53300']);
const UNAVAILABLE_SQLSTATE_CLASSES = ['08', '57'];

const SYSTEM_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
]);

// Textos propios de pg / pg-pool (versión instalada). Esos errores no son DatabaseError ni llevan `code`.
const DRIVER_MESSAGES = new Set([
  'timeout exceeded when trying to connect',
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
  'Client has encountered a connection error and is not queryable',
  'Client was closed and is not queryable',
]);

/**
 * Decide si un error del driver significa «base de datos no disponible». Los errores de SQL de una consulta
 * (restricciones, sintaxis, permisos…) NO lo son. Solo se compara el mensaje si el error no es un
 * `DatabaseError`: un DatabaseError con texto parecido, pero SQLSTATE de consulta, no se confunde.
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (error instanceof DatabaseError) {
    return (
      typeof code === 'string' &&
      (UNAVAILABLE_SQLSTATES.has(code) ||
        UNAVAILABLE_SQLSTATE_CLASSES.some((sqlstateClass) => code.startsWith(sqlstateClass)))
    );
  }
  return (typeof code === 'string' && SYSTEM_CODES.has(code)) || DRIVER_MESSAGES.has(error.message);
}
