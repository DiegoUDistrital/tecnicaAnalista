import { isIPv6 } from 'node:net';

const IPV4_OCTET = '(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])';
/** Cuatro octetos decimales de 0 a 255 sin ceros a la izquierda (no se depende de lo que `net.isIP` acepte). */
const IPV4 = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);

const IPV6_GROUPS = 8;
const MAPPED_PREFIX_GROUPS = 5;
const MAPPED_MARKER = 0xffff;

/** Quita la zona (`%eth0`) de la dirección que da el sistema operativo para la conexión. */
export function stripZone(address: string): string {
  const zoneStart = address.indexOf('%');
  return zoneStart === -1 ? address : address.slice(0, zoneStart);
}

/** Los dos grupos de 16 bits que forman una IPv4 (`a.b.c.d` -> `[a*256+b, c*256+d]`). */
function ipv4ToGroups(ipv4: string): number[] {
  const [a = 0, b = 0, c = 0, d = 0] = ipv4.split('.').map(Number);
  return [a * 256 + b, c * 256 + d];
}

/** Los 8 grupos de 16 bits de una IPv6 de sintaxis ya válida y sin zona (con cola IPv4 estricta o sin ella). */
function expandGroups(text: string): number[] {
  let body = text;
  const lastColon = text.lastIndexOf(':');
  const last = text.slice(lastColon + 1);
  if (last.includes('.')) {
    const tail = ipv4ToGroups(last).map((group) => group.toString(16));
    body = `${text.slice(0, lastColon + 1)}${tail.join(':')}`;
  }
  const halves = body.split('::');
  const toNumbers = (part: string): number[] =>
    part === '' ? [] : part.split(':').map((group) => parseInt(group, 16));
  const head = toNumbers(halves[0] ?? '');
  const rest = toNumbers(halves[1] ?? '');
  const zeros = halves.length === 2 ? IPV6_GROUPS - head.length - rest.length : 0;
  return [...head, ...new Array<number>(zeros).fill(0), ...rest];
}

/** Los 8 grupos de una IPv6 literal válida y sin zona, o `undefined` si el texto no lo es. */
function ipv6ToGroups(text: string): number[] | undefined {
  if (text.includes('%') || !isIPv6(text)) {
    return undefined;
  }
  const last = text.slice(text.lastIndexOf(':') + 1);
  return last.includes('.') && !IPV4.test(last) ? undefined : expandGroups(text);
}

/** Forma abreviada de 8 grupos: la racha de ceros más larga (de 2 o más, la primera si empatan) se escribe `::`. */
function formatIpv6(groups: readonly number[]): string {
  let bestStart = -1;
  let bestLength = 1;
  for (let start = 0; start < groups.length;) {
    if (groups[start] !== 0) {
      start += 1;
      continue;
    }
    let end = start;
    while (end < groups.length && groups[end] === 0) {
      end += 1;
    }
    if (end - start > bestLength) {
      bestStart = start;
      bestLength = end - start;
    }
    start = end;
  }
  const hex = groups.map((group) => group.toString(16));
  if (bestStart === -1) {
    return hex.join(':');
  }
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`;
}

/**
 * Dirección canónica de un texto: IPv4 sin ceros a la izquierda, IPv6 abreviada y en minúsculas, y la IPv4-mapeada
 * (`::ffff:203.0.113.7`) convertida a IPv4. Devuelve `undefined` si el texto no es una IP literal tal cual (zona,
 * puerto, corchetes, espacios, ceros a la izquierda, vacío o texto largo): ahí `net.isIP` no basta.
 */
export function canonicalIp(text: string): string | undefined {
  if (IPV4.test(text)) {
    return text;
  }
  const groups = ipv6ToGroups(text);
  if (groups === undefined) {
    return undefined;
  }
  const isMapped =
    groups.slice(0, MAPPED_PREFIX_GROUPS).every((group) => group === 0) &&
    groups[MAPPED_PREFIX_GROUPS] === MAPPED_MARKER;
  if (isMapped) {
    const [high = 0, low = 0] = groups.slice(MAPPED_PREFIX_GROUPS + 1);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }
  return formatIpv6(groups);
}

/** Los cuatro primeros grupos (el /64) de una IPv6 YA canónica, separados por `:`. */
export function ipv6Prefix64(canonical: string): string {
  return expandGroups(canonical)
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':');
}
