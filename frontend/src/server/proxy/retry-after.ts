import 'server-only';

const VALID_RETRY_AFTER = /^[1-9][0-9]{0,3}$/;
const MAX_RETRY_AFTER_SECONDS = 3600;
const SECONDS_LIMIT = 120;
const FALLBACK_MESSAGE = 'Demasiadas peticiones. Inténtalo de nuevo en unos instantes.';

/**
 * Traduce la cabecera `Retry-After` de un 429 (RF-F20). Solo vale un entero de 1 a 3600 sin signo, ceros ni espacios
 * (el valor llega tal cual); si no, no se reenvía la cabecera y el mensaje es el de reserva. Con menos de 120 segundos
 * se muestran segundos y desde 120 se redondea hacia arriba a minutos.
 */
export function describeRetryAfter(raw: string | null): { message: string; retryAfter: string | undefined } {
  if (raw === null || !VALID_RETRY_AFTER.test(raw) || Number(raw) > MAX_RETRY_AFTER_SECONDS) {
    return { message: FALLBACK_MESSAGE, retryAfter: undefined };
  }
  const seconds = Number(raw);
  const wait =
    seconds < SECONDS_LIMIT
      ? `${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`
      : `${Math.ceil(seconds / 60)} minutos`;
  return { message: `Demasiadas peticiones. Espera ${wait} e inténtalo de nuevo.`, retryAfter: raw };
}
