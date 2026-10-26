import 'server-only';
import { concat } from './body-reader';

export type BackendMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type TaskFilter = 'completed' | 'pending';
/** Lo único que se usa de la respuesta de Express (permite simularla en los tests, incluido un 204 con cuerpo). */
export type BackendResponse = Pick<Response, 'status' | 'headers' | 'body'>;
export type FetchLike = (url: string, init: RequestInit) => Promise<BackendResponse>;

/** Resultado ya clasificado del reenvío; el mapeo (`response-mapper`) lo traduce a la respuesta del navegador. */
export type BackendResult =
  | { kind: 'ok'; body: unknown }
  | { kind: 'validation'; body: unknown }
  | { kind: 'rate_limited'; retryAfter: string | null }
  | { kind: 'not_found' | 'too_large' | 'invalid' | 'timeout' | 'cancelled' }
  | { kind: 'unexpected'; status: number }
  | { kind: 'unreachable'; error: unknown };

export interface ForwardOptions {
  config: { backendUrl: string; apiKey: string };
  method: BackendMethod;
  /** Identificador ya validado y en minúsculas (RF-F19). */
  id?: string;
  /** Filtro ya validado; solo se usa en `GET`. */
  filter?: TaskFilter;
  /** Cuerpo ya analizado y re-serializado (RF-F19); solo en `POST` y `PUT`. */
  bodyText?: string;
  /** Señal de la petición del navegador: si se aborta, se cancela la de Express. */
  browserSignal?: AbortSignal;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

/** Plazo de reenvío (RF-F22): mayor que la espera del pool del backend (5 s por defecto) más una consulta. */
export const FORWARD_TIMEOUT_MS = 15_000;
/** Tope de la respuesta de Express (RF-F20). */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const SUCCESS_STATUS: Record<BackendMethod, number> = { GET: 200, POST: 201, PUT: 200, DELETE: 204 };
const ABORTED = Symbol('aborted');

interface Deadline {
  signal: AbortSignal;
  /** Se resuelve (no rechaza) cuando se agota el plazo o cancela el navegador: así `await` nunca queda colgado. */
  aborted: Promise<typeof ABORTED>;
  /** Resultado a devolver cuando la operación se interrumpió o falló. */
  failure: (error?: unknown) => BackendResult;
  dispose: () => void;
}

/**
 * Plazo manual con `AbortController` + `setTimeout` (y no `AbortSignal.timeout`/`any`): los temporizadores
 * simulados de los tests lo controlan. Escucha a mano la señal del navegador.
 */
function createDeadline(timeoutMs: number, browserSignal: AbortSignal | undefined): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  let resolveAborted: (value: typeof ABORTED) => void = () => undefined;
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    resolveAborted = resolve;
  });
  const stop = (): void => {
    controller.abort();
    resolveAborted(ABORTED);
  };
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeoutMs);
  browserSignal?.addEventListener('abort', stop);
  if (browserSignal?.aborted === true) {
    stop();
  }
  return {
    signal: controller.signal,
    aborted,
    failure: (error) => {
      if (timedOut) {
        return { kind: 'timeout' };
      }
      return browserSignal?.aborted === true ? { kind: 'cancelled' } : { kind: 'unreachable', error };
    },
    dispose: () => {
      clearTimeout(timer);
      browserSignal?.removeEventListener('abort', stop);
    },
  };
}

type CappedRead = { status: 'ok'; bytes: Uint8Array } | { status: 'too_large' } | { status: 'aborted' };

/** Lee el cuerpo en flujo con tope de bytes; cancela siempre el lector al terminar (también si sobra cuerpo). */
async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  aborted: Promise<typeof ABORTED>,
): Promise<CappedRead> {
  if (body === null) {
    return { status: 'ok', bytes: new Uint8Array() };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const step = await Promise.race([aborted, reader.read()]);
      if (step === ABORTED) {
        return { status: 'aborted' };
      }
      if (step.done) {
        return { status: 'ok', bytes: concat(chunks, total) };
      }
      total += step.value.length;
      if (total > maxBytes) {
        return { status: 'too_large' };
      }
      chunks.push(step.value);
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

/** JSON estricto (UTF-8 válido); `undefined` si no se puede analizar. El resultado `null` de JSON es válido. */
function parseJson(bytes: Uint8Array): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown };
  } catch {
    return undefined;
  }
}

/** Descarta el cuerpo sin leerlo (libera la conexión). */
function discard(response: BackendResponse): void {
  response.body?.cancel().catch(() => undefined);
}

async function classify(
  response: BackendResponse,
  method: BackendMethod,
  maxBytes: number,
  deadline: Deadline,
): Promise<BackendResult> {
  const { status } = response;
  const writes = method === 'POST' || method === 'PUT';
  const readsBody = status === SUCCESS_STATUS[method] || (status === 400 && writes);
  if (!readsBody) {
    discard(response);
    if (status === 429) {
      return { kind: 'rate_limited', retryAfter: response.headers.get('retry-after') };
    }
    if (status === 404 && (method === 'PUT' || method === 'DELETE')) {
      return { kind: 'not_found' };
    }
    return status === 413 && writes ? { kind: 'too_large' } : { kind: 'unexpected', status };
  }
  const read = await readCapped(response.body, maxBytes, deadline.aborted);
  if (read.status === 'aborted') {
    return deadline.failure();
  }
  if (read.status === 'too_large') {
    return { kind: 'invalid' };
  }
  if (method === 'DELETE' && status === 204) {
    return read.bytes.length === 0 ? { kind: 'ok', body: undefined } : { kind: 'invalid' };
  }
  const parsed = parseJson(read.bytes);
  if (parsed === undefined) {
    return { kind: 'invalid' };
  }
  return { kind: status === 400 ? 'validation' : 'ok', body: parsed.value };
}

/**
 * Reenvía la petición a Express (RF-F17, F18, F22) y clasifica el resultado. Únicas cabeceras propias:
 * `Authorization` y, con cuerpo, `Content-Type` (nada del navegador; sin `X-Forwarded-For` hasta la 007). Plazo único
 * que cubre también la lectura de la respuesta, sin redirecciones y sin reintentos nunca (un `POST` reintentado
 * crearía duplicados). Nunca lanza: todo fallo es un `BackendResult`.
 */
export async function forward({
  config,
  method,
  id,
  filter,
  bodyText,
  browserSignal,
  fetchImpl = fetch,
  timeoutMs = FORWARD_TIMEOUT_MS,
  maxResponseBytes = MAX_RESPONSE_BYTES,
}: ForwardOptions): Promise<BackendResult> {
  const path = id === undefined ? '/api/tasks' : `/api/tasks/${id}`;
  const query = filter === undefined ? '' : `?completed=${filter === 'completed'}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${config.apiKey}` };
  if (bodyText !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const deadline = createDeadline(timeoutMs, browserSignal);
  try {
    const request = fetchImpl(`${config.backendUrl}${path}${query}`, {
      method,
      headers,
      body: bodyText,
      redirect: 'manual',
      cache: 'no-store',
      signal: deadline.signal,
    });
    // `aborted` va primero: si ya se canceló, gana aunque la respuesta esté lista.
    const response = await Promise.race([deadline.aborted, request]);
    return response === ABORTED ? deadline.failure() : await classify(response, method, maxResponseBytes, deadline);
  } catch (error) {
    return deadline.failure(error);
  } finally {
    deadline.dispose();
  }
}
