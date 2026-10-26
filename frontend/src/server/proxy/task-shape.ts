import 'server-only';

export interface Task {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  createdAt: string;
}

const TASK_KEYS = ['id', 'title', 'description', 'completed', 'createdAt'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_8601 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;
const MAX_TITLE = 100;
const MAX_DESCRIPTION = 500;

/** Longitud en puntos de código (un emoji cuenta 1), como la validación de Express. */
function length(value: string): number {
  return [...value].length;
}

/** ISO 8601 con zona Y fecha real: se reconstruye y se compara cada campo (`2026-02-31` no existe). */
function isRealTimestamp(value: string): boolean {
  const match = ISO_8601.exec(value);
  if (match === null) {
    return false;
  }
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const offsetHour = Number(match[7] ?? 0);
  const offsetMinute = Number(match[8] ?? 0);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59
  );
}

/**
 * Valida la forma de una tarea de Express (RF-F20, definición de «Tarea»): EXACTAMENTE cinco claves con sus tipos y
 * límites. Devuelve una copia con solo esas cinco claves en orden fijo, o `undefined` si algo no encaja.
 */
export function toTask(value: unknown): Task | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const keys = Object.keys(value);
  if (keys.length !== TASK_KEYS.length || !TASK_KEYS.every((key) => Object.hasOwn(value, key))) {
    return undefined;
  }
  const { id, title, description, completed, createdAt } = value as Record<(typeof TASK_KEYS)[number], unknown>;
  const valid =
    typeof id === 'string' &&
    UUID.test(id) &&
    typeof title === 'string' &&
    length(title) >= 1 &&
    length(title) <= MAX_TITLE &&
    typeof description === 'string' &&
    length(description) <= MAX_DESCRIPTION &&
    typeof completed === 'boolean' &&
    typeof createdAt === 'string' &&
    isRealTimestamp(createdAt);
  return valid ? { id, title, description, completed, createdAt } : undefined;
}
