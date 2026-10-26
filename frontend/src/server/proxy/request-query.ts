import 'server-only';

export type ListFilter = 'completed' | 'pending';

type Pair = readonly [name: string, value: string];

/** `+` es un espacio y se decodifica UNA sola vez; `undefined` si hay un porcentaje mal formado. */
function decode(text: string): string | undefined {
  try {
    return decodeURIComponent(text.replaceAll('+', ' '));
  } catch {
    return undefined;
  }
}

/**
 * Consulta cruda normalizada (la misma regla que la 003): se parte por `&`, se descartan los segmentos vacíos y cada
 * uno se parte por el PRIMER `=`. `undefined` si algún nombre o valor tiene un porcentaje mal formado.
 */
function normalizeRawQuery(search: string): Pair[] | undefined {
  const pairs: Pair[] = [];
  for (const segment of search.replace(/^\?/, '').split('&')) {
    if (segment === '') {
      continue;
    }
    const separator = segment.indexOf('=');
    const rawName = separator === -1 ? segment : segment.slice(0, separator);
    const rawValue = separator === -1 ? '' : segment.slice(separator + 1);
    const name = decode(rawName);
    const value = decode(rawValue);
    if (name === undefined || value === undefined) {
      return undefined;
    }
    pairs.push([name, value]);
  }
  return pairs;
}

/**
 * Consulta de `GET /api/tasks` (RF-F19, paso 4): sin parámetros, o UN `filter` con `completed` o `pending`.
 * Devuelve `undefined` ante cualquier otra cosa (la ruta responde 400).
 */
export function parseListQuery(search: string): { filter: ListFilter | undefined } | undefined {
  const pairs = normalizeRawQuery(search);
  if (pairs === undefined) {
    return undefined;
  }
  if (pairs.length === 0) {
    return { filter: undefined };
  }
  const [name, value] = pairs[0] ?? [];
  if (pairs.length === 1 && name === 'filter' && (value === 'completed' || value === 'pending')) {
    return { filter: value };
  }
  return undefined;
}

/** Consulta de `POST`, `PUT` y `DELETE`: no admiten ningún parámetro (`?` vacío es válido). */
export function parseEmptyQuery(search: string): boolean {
  return normalizeRawQuery(search)?.length === 0;
}
