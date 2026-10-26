import 'server-only';
import { MAX_BODY_BYTES } from './body-headers';

/** Plazo para recibir el cuerpo completo (RF-F19, paso 7). */
export const BODY_READ_TIMEOUT_MS = 5000;

export type BodyReadResult = { status: 'ok'; bytes: Uint8Array } | { status: 'too_large' | 'timeout' | 'aborted' };

type ReadStep = ReadableStreamReadResult<Uint8Array> | 'timeout';

/** Une los trozos recibidos en un único `Uint8Array`. */
export function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/**
 * Lee el cuerpo EN FLUJO, trozo a trozo (nunca entero de golpe): corta con `too_large` al superar el tope de bytes
 * REALMENTE recibidos (aunque `Content-Length` mintiera), con `timeout` si el plazo total se agota y con `aborted`
 * si la conexión se corta. En los tres fallos cancela el lector; el temporizador se limpia siempre.
 */
export async function readBody(body: ReadableStream<Uint8Array> | null): Promise<BodyReadResult> {
  if (body === null) {
    return { status: 'ok', bytes: new Uint8Array() };
  }
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), BODY_READ_TIMEOUT_MS);
  });
  const chunks: Uint8Array[] = [];
  let total = 0;
  const fail = (status: 'too_large' | 'timeout' | 'aborted'): BodyReadResult => {
    reader.cancel().catch(() => undefined);
    return { status };
  };
  try {
    for (;;) {
      const step: ReadStep = await Promise.race([reader.read(), deadline]);
      if (step === 'timeout') {
        return fail('timeout');
      }
      if (step.done) {
        return { status: 'ok', bytes: concat(chunks, total) };
      }
      total += step.value.length;
      if (total > MAX_BODY_BYTES) {
        return fail('too_large');
      }
      chunks.push(step.value);
    }
  } catch {
    return fail('aborted');
  } finally {
    clearTimeout(timer);
  }
}
