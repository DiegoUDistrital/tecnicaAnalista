import 'server-only';

export interface OriginCheckInput {
  method: string;
  headers: Headers;
  /** Hosts permitidos (ya en minúsculas), o `undefined` si no se valida el `Host`. */
  allowedHosts?: readonly string[];
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE']);

function hostOf(origin: string): string | undefined {
  try {
    return new URL(origin).host;
  } catch {
    return undefined;
  }
}

/**
 * Defensa de origen (RF-F30). Con `ALLOWED_HOSTS` definida, el `Host` debe estar en la lista (cualquier método).
 * En las escrituras se rechaza `Sec-Fetch-Site: cross-site` y un `Origin` que no sea exactamente el `Host` de la
 * propia petición (`null`, repetido o ilegible incluidos). Sin `Origin` pasa: es un cliente que no es un navegador.
 */
export function checkOrigin({ method, headers, allowedHosts }: OriginCheckInput): 'ok' | 'forbidden' {
  const host = headers.get('host')?.toLowerCase();
  if (allowedHosts !== undefined && (host === undefined || !allowedHosts.includes(host))) {
    return 'forbidden';
  }
  if (!WRITE_METHODS.has(method)) {
    return 'ok';
  }
  if (headers.get('sec-fetch-site') === 'cross-site') {
    return 'forbidden';
  }
  const origin = headers.get('origin');
  if (origin === null) {
    return 'ok';
  }
  return host !== undefined && hostOf(origin) === host ? 'ok' : 'forbidden';
}
