import 'server-only';

const TASKS_PREFIX = '/api/tasks/';
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Valida el `id` de `/api/tasks/<id>` (RF-F19, paso 3). Toma el segmento de la dirección SIN decodificar, exige un
 * UUID completo (sin `%`, `/` ni `.`) idéntico al parámetro que entrega Next, y lo devuelve en minúsculas.
 * Devuelve `undefined` si algo no cuadra (la ruta responde 400).
 */
export function parseTaskId(requestUrl: string, paramId: string): string | undefined {
  const { pathname } = new URL(requestUrl);
  if (!pathname.startsWith(TASKS_PREFIX)) {
    return undefined;
  }
  const segment = pathname.slice(TASKS_PREFIX.length);
  return UUID.test(segment) && segment === paramId ? segment.toLowerCase() : undefined;
}
