export type TaskFilter = 'all' | 'completed' | 'pending';

export type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Lee el filtro de la dirección. Solo `?filter=completed` o `?filter=pending` (una vez y sin otros parámetros)
 * dan un filtro; cualquier otra cosa es "Todas", sin error ni redirección.
 */
export function readFilter(searchParams: SearchParams): TaskFilter {
  const keys = Object.keys(searchParams);
  const value = searchParams.filter;
  if (keys.length !== 1 || keys[0] !== 'filter') {
    return 'all';
  }
  return value === 'completed' || value === 'pending' ? value : 'all';
}
