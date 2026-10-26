import { NO_CONNECTION_MESSAGE, ownMessage, readErrorBody, type ErrorDetail } from '../lib/api-error';
import { isTask, type Task } from '../lib/task';
import type { TaskFilter } from '../lib/task-filter';

export type ListResult = { kind: 'ok'; tasks: Task[] } | { kind: 'error'; message: string } | { kind: 'aborted' };

export type WriteResult =
  | { kind: 'ok' }
  | { kind: 'not_found' }
  | { kind: 'invalid'; message: string; details: ErrorDetail[] }
  | { kind: 'error'; message: string };

/** Crear nunca da not_found: write() solo lo devuelve para PUT y DELETE (el 404 de POST no entra en esa rama). */
export type CreateResult = Exclude<WriteResult, { kind: 'not_found' }>;

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Código HTTP de éxito de cada método: cualquier otro se trata como error. */
const SUCCESS_STATUS: Record<Method, number> = { GET: 200, POST: 201, PUT: 200, DELETE: 204 };
const INVALID_FALLBACK = 'Datos inválidos.';

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function errorCode(json: unknown): unknown {
  const error = typeof json === 'object' && json !== null && 'error' in json ? json.error : undefined;
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

/** Hace la petición a nuestro propio origen. Nunca lanza: un fallo de red o una cancelación son resultados. */
async function send(
  method: Method,
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response | 'aborted' | 'failed'> {
  try {
    return await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    return isAbort(error) ? 'aborted' : 'failed';
  }
}

async function write(method: 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<WriteResult> {
  const sent = await send(method, url, body);
  if (typeof sent === 'string') {
    return { kind: 'error', message: ownMessage(method) };
  }
  const response = sent;
  if (response.status === SUCCESS_STATUS[method]) {
    return { kind: 'ok' };
  }
  const json = await readJson(response);
  const { message, details } = readErrorBody(json);
  if (response.status === 404 && method !== 'POST' && errorCode(json) === 'NOT_FOUND') {
    return { kind: 'not_found' };
  }
  if (response.status === 400 && method !== 'DELETE') {
    return { kind: 'invalid', message: message ?? INVALID_FALLBACK, details };
  }
  return { kind: 'error', message: message ?? ownMessage(method) };
}

export async function fetchTasks(filter: TaskFilter, signal?: AbortSignal): Promise<ListResult> {
  const url = filter === 'all' ? '/api/tasks' : `/api/tasks?filter=${filter}`;
  const sent = await send('GET', url, undefined, signal);
  if (sent === 'aborted') {
    return { kind: 'aborted' };
  }
  if (sent === 'failed') {
    return { kind: 'error', message: NO_CONNECTION_MESSAGE };
  }
  const json = await readJson(sent);
  if (sent.status !== SUCCESS_STATUS.GET) {
    return { kind: 'error', message: readErrorBody(json).message ?? NO_CONNECTION_MESSAGE };
  }
  return Array.isArray(json) && json.every(isTask)
    ? { kind: 'ok', tasks: json }
    : { kind: 'error', message: NO_CONNECTION_MESSAGE };
}

export function createTask(body: { title: string; description: string }): Promise<CreateResult> {
  // El cast es seguro: write() no devuelve not_found para POST (ver la guarda `method !== 'POST'` de arriba).
  return write('POST', '/api/tasks', body) as Promise<CreateResult>;
}

export function updateTask(id: string, body: { title?: string; description?: string; completed?: boolean }) {
  return write('PUT', `/api/tasks/${id}`, body);
}

export function deleteTask(id: string): Promise<WriteResult> {
  return write('DELETE', `/api/tasks/${id}`);
}
