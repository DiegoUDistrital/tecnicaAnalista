import { vi } from 'vitest';
import type { Task } from '../../src/lib/task';

export interface FakeCall {
  method: string;
  url: string;
  body: unknown;
  signal: AbortSignal | undefined;
  /** Responde a esta petición (la promesa de `fetch` se resuelve a mano para controlar el orden). */
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
}

export interface FakeApi {
  calls: FakeCall[];
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function makeTask(n: number, overrides: Partial<Task> = {}): Task {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    title: `Tarea ${n}`,
    description: '',
    completed: false,
    createdAt: '2026-01-31T15:05:00.000Z',
    ...overrides,
  };
}

/**
 * Sustituye `fetch`: cada llamada queda registrada y espera a que el test la resuelva. Una señal abortada rechaza,
 * salvo con `ignoreAbort` (simula una respuesta que llega aunque ya se canceló, para probar el número de petición).
 */
export function installFakeApi(options: { ignoreAbort?: boolean } = {}): FakeApi {
  const calls: FakeCall[] = [];
  vi.stubGlobal(
    'fetch',
    (url: string, init: RequestInit = {}) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init.signal ?? undefined;
        calls.push({
          method: init.method ?? 'GET',
          url,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
          signal,
          resolve,
          reject,
        });
        if (!options.ignoreAbort) {
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }
      }),
  );
  return { calls };
}
