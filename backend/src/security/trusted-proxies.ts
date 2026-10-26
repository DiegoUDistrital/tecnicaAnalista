import { BlockList } from 'node:net';
import { canonicalIp } from './ip-address';

/** Lista de direcciones de las que se cree `X-Forwarded-For` (la conexión TCP debe venir de una de ellas). */
export interface TrustedProxies {
  /** `canonicalIp` debe ser una dirección YA canónica (la IPv4-mapeada llega convertida a IPv4). */
  contains(canonicalIp: string): boolean;
}

type Family = 'ipv4' | 'ipv6';
type Range = readonly [address: string, prefix: number];

/** Rangos de cada nombre: los mismos que usa `trust proxy` de Express, para poder explicarlos. */
const NAMED_RANGES: ReadonlyMap<string, readonly Range[]> = new Map([
  [
    'loopback',
    [
      ['127.0.0.0', 8],
      ['::1', 128],
    ],
  ],
  [
    'linklocal',
    [
      ['169.254.0.0', 16],
      ['fe80::', 10],
    ],
  ],
  [
    'uniquelocal',
    [
      ['10.0.0.0', 8],
      ['172.16.0.0', 12],
      ['192.168.0.0', 16],
      ['fc00::', 7],
    ],
  ],
]);

/** Prefijos mínimo y máximo de `IP/prefijo`: así una lista no puede confiar en medio Internet. */
const PREFIX_LIMITS: Readonly<Record<Family, { min: number; max: number }>> = {
  ipv4: { min: 8, max: 32 },
  ipv6: { min: 7, max: 128 },
};

/** Los prefijos son enteros decimales sin signo ni ceros sobrantes (la máscara larga `255.0.0.0` no cumple). */
const PREFIX = /^[1-9][0-9]*$/;

const NO_PROXIES: TrustedProxies = { contains: () => false };

function familyOf(canonical: string): Family {
  return canonical.includes(':') ? 'ipv6' : 'ipv4';
}

/** Añade una entrada (nombre, IP o IP/prefijo) a la lista; `false` si no es válida. */
function addEntry(list: BlockList, entry: string): boolean {
  const ranges = NAMED_RANGES.get(entry);
  if (ranges !== undefined) {
    for (const [address, prefix] of ranges) {
      list.addSubnet(address, prefix, familyOf(address));
    }
    return true;
  }
  const slash = entry.indexOf('/');
  const address = slash === -1 ? entry : entry.slice(0, slash);
  const canonical = canonicalIp(address);
  if (canonical === undefined) {
    return false;
  }
  const family = familyOf(canonical);
  if (slash === -1) {
    list.addAddress(canonical, family);
    return true;
  }
  const prefixText = entry.slice(slash + 1);
  const { min, max } = PREFIX_LIMITS[family];
  // Una IPv4-mapeada con prefijo es ambigua (¿el prefijo cuenta los 96 bits iniciales?): se rechaza.
  const isMappedWithPrefix = family === 'ipv4' && address.includes(':');
  if (isMappedWithPrefix || !PREFIX.test(prefixText) || Number(prefixText) < min || Number(prefixText) > max) {
    return false;
  }
  list.addSubnet(canonical, Number(prefixText), family);
  return true;
}

/**
 * Interpreta `TRUSTED_PROXIES`. Ausente equivale a `loopback`; `none` (en minúsculas y solo) es una lista vacía;
 * si no, es una lista separada por comas de `loopback`, `linklocal`, `uniquelocal`, IP literales o `IP/prefijo`
 * (IPv4 de /8 a /32, IPv6 de /7 a /128). Los espacios alrededor de cada entrada se recortan. Devuelve `undefined` si
 * algo no es válido (vacía, entradas vacías, mayúsculas distintas, `true`, `/0`, máscara larga, zona...): el
 * arranque lo rechaza en lugar de interpretar una intención de seguridad ambigua.
 */
export function parseTrustedProxies(raw: string | undefined): TrustedProxies | undefined {
  const text = raw ?? 'loopback';
  if (text === 'none') {
    return NO_PROXIES;
  }
  const list = new BlockList();
  for (const entry of text.split(',')) {
    if (!addEntry(list, entry.trim())) {
      return undefined;
    }
  }
  return { contains: (canonical) => list.check(canonical, familyOf(canonical)) };
}
