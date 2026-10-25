import type { Timers } from './server.types';

/**
 * Ejecuta `operation` con un plazo de `ms` milisegundos. Devuelve `'completed'` si termina antes y
 * `'timeout'` si el plazo vence primero. Si la operación rechaza (o lanza) antes del plazo, rechaza con
 * el mismo error: decide el llamador. Si gana el plazo, un rechazo posterior de la operación queda
 * manejado porque `Promise.race` ya se suscribió. El temporizador se cancela siempre al terminar.
 */
export async function runWithin(
  operation: () => Promise<unknown>,
  ms: number,
  timers: Timers,
): Promise<'completed' | 'timeout'> {
  // El ejecutor de `new Promise` corre de forma síncrona: `cancel` siempre está asignado antes de usarse.
  let cancel!: () => void;
  const timeout = new Promise<'timeout'>((resolve) => {
    cancel = timers.setTimer(() => {
      resolve('timeout');
    }, ms);
  });
  try {
    return await Promise.race([operation().then(() => 'completed' as const), timeout]);
  } finally {
    cancel();
  }
}
