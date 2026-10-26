import { canonicalIp, ipv6Prefix64, stripZone } from './ip-address';
import type { TrustedProxies } from './trusted-proxies';

/** Lo mínimo que se lee de una petición (así el módulo es puro y fácil de probar). */
export interface ClientRequest {
  readonly socket: { readonly remoteAddress: string | undefined };
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/** Clave fija cuando el socket ya no tiene dirección (destruido) o no se puede normalizar. */
const UNKNOWN_KEY = 'unknown';

/** Más de esto en `X-Forwarded-For` se trata como basura: acota el trabajo por petición. */
const MAX_FORWARDED_LENGTH = 512;

/** Dirección canónica de la conexión TCP (sin zona, abreviada, IPv4-mapeada convertida), o `undefined`. */
export function connectionAddress(socket: ClientRequest['socket']): string | undefined {
  const address = socket.remoteAddress;
  return address === undefined ? undefined : canonicalIp(stripZone(address));
}

/** Clave de cupo de una IP canónica: la IPv4 entera o el /64 de la IPv6. */
function keyOf(canonical: string): string {
  return canonical.includes(':') ? `v6/64:${ipv6Prefix64(canonical)}` : canonical;
}

/**
 * IP del cliente según `X-Forwarded-For` y la lista de confianza. Solo se lee la cabecera si la conexión es de
 * confianza; se recorre de derecha a izquierda saltando las direcciones de confianza y decide la primera que no lo
 * es. Si esa entrada es basura, o todas son de confianza, vale la dirección de la conexión (el lado estricto: un
 * cupo compartido). Nunca se usan `Forwarded`, `X-Real-IP` ni la parte izquierda de la cabecera.
 */
function clientAddress(connection: string, forwarded: string | undefined, trusted: TrustedProxies): string {
  if (forwarded === undefined || forwarded.length > MAX_FORWARDED_LENGTH || !trusted.contains(connection)) {
    return connection;
  }
  const entries = forwarded.split(',');
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const address = canonicalIp((entries[index] ?? '').trim());
    if (address === undefined) {
      return connection;
    }
    if (!trusted.contains(address)) {
      return address;
    }
  }
  return connection;
}

/**
 * Clave de cupo del cliente de una petición: IPv4 completa, IPv6 agrupada por /64 (`v6/64:<4 grupos>`) o `unknown`.
 * Es la fuente de verdad de la IP: no se usa `req.ip` ni `trust proxy` de Express.
 */
export function clientKey(request: ClientRequest, trusted: TrustedProxies): string {
  const connection = connectionAddress(request.socket);
  if (connection === undefined) {
    return UNKNOWN_KEY;
  }
  const header = request.headers['x-forwarded-for'];
  const forwarded = Array.isArray(header) ? header.join(', ') : header;
  return keyOf(clientAddress(connection, forwarded, trusted));
}
