import { createLogger, type Logger } from '../../src/logging/logger';

/** Instante fijo del reloj inyectado en los tests. */
export const FIXED_TIME = new Date('2026-01-02T03:04:05.678Z');

export interface CaptureLogger {
  readonly logger: Logger;
  /** Líneas tal como las recibió el destino (con su salto de línea final). */
  readonly lines: string[];
  /** Cada línea interpretada como JSON. */
  records(): Record<string, unknown>[];
  /** Toda la salida concatenada: sirve para comprobar que un valor no aparece «en ningún punto». */
  output(): string;
}

/** Logger de pruebas: escribe en memoria y usa un reloj fijo. */
export function createCaptureLogger(now: () => Date = () => FIXED_TIME): CaptureLogger {
  const lines: string[] = [];
  return {
    logger: createLogger((line) => lines.push(line), now),
    lines,
    records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    output: () => lines.join(''),
  };
}
