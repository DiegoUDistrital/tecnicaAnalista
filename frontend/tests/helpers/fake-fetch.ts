import type { BackendResponse, FetchLike } from '../../src/server/proxy/backend-client';

export interface FakeResponseInit {
  status: number;
  headers?: Record<string, string>;
  /** Texto, bytes o flujo propio; `null`/ausente = sin cuerpo. */
  body?: string | Uint8Array | ReadableStream<Uint8Array> | null;
}

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

function toStream(body: FakeResponseInit['body']): ReadableStream<Uint8Array> | null {
  if (body === undefined || body === null) {
    return null;
  }
  if (body instanceof ReadableStream) {
    return body;
  }
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Respuesta mínima (solo estado, cabeceras y cuerpo): permite un 204 con cuerpo, que `Response` no admite. */
export function fakeResponse({ status, headers = {}, body }: FakeResponseInit): BackendResponse {
  return { status, headers: new Headers(headers), body: toStream(body) as BackendResponse['body'] };
}

/** `fetch` simulado que anota cada llamada y responde lo que decida `handler`. */
export function createFakeFetch(handler: (call: RecordedCall) => BackendResponse | Promise<BackendResponse>): {
  fetchImpl: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return handler(call);
  };
  return { fetchImpl, calls };
}
