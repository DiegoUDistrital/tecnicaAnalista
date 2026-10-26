import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { rawRequest } from '../helpers/raw-http';

// Caracterización del comportamiento de Node con `Authorization` (no hay código propio): fija lo que la guarda
// supone al leer `req.rawHeaders`. Un servidor simple devuelve lo que Node entrega a la aplicación.

interface Seen {
  readonly raw: string[];
  readonly authorization: string | undefined;
}

let server: Server | undefined;

afterEach(async () => {
  const current = server;
  server = undefined;
  if (current !== undefined) {
    await new Promise<void>((resolve) => current.close(() => resolve()));
  }
});

/** Envía la cabecera tal cual por un socket crudo y devuelve lo que Node entregó a la aplicación. */
async function observe(headerLines: readonly string[]): Promise<Seen> {
  let seen: Seen | undefined;
  const started = createServer((req, res) => {
    seen = { raw: [...req.rawHeaders], authorization: req.headers.authorization };
    res.end('ok');
  });
  server = started;
  await new Promise<void>((resolve) => started.listen(0, '127.0.0.1', resolve));
  const { port } = started.address() as AddressInfo;
  const lines = ['GET / HTTP/1.1', 'Host: x', ...headerLines, 'Connection: close', '', ''];
  await rawRequest(port, [lines.join('\r\n')]);
  if (seen === undefined) {
    throw new Error('El servidor no recibió la petición');
  }
  return seen;
}

function authorizationValues(raw: readonly string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < raw.length; index += 2) {
    if (raw[index]?.toLowerCase() === 'authorization') {
      values.push(raw[index + 1] ?? '');
    }
  }
  return values;
}

describe('RF-G3: comportamiento de Node con la cabecera Authorization', () => {
  it('RF-G3: con dos Authorization iguales rawHeaders conserva las dos y headers deja una sola', async () => {
    const seen = await observe(['Authorization: Bearer abc', 'Authorization: Bearer abc']);

    expect(authorizationValues(seen.raw)).toEqual(['Bearer abc', 'Bearer abc']);
    expect(seen.authorization).toBe('Bearer abc');
  });

  it('RF-G3: con dos Authorization distintas rawHeaders conserva las dos y headers deja solo la primera', async () => {
    const seen = await observe(['Authorization: Bearer abc', 'authorization: Bearer def']);

    expect(authorizationValues(seen.raw)).toEqual(['Bearer abc', 'Bearer def']);
    expect(seen.authorization).toBe('Bearer abc');
  });

  it('RF-G3: Node recorta el espacio final del valor: Bearer <key> llega como Bearer <key>', async () => {
    const seen = await observe(['Authorization: Bearer abc ']);

    expect(authorizationValues(seen.raw)).toEqual(['Bearer abc']);
    expect(seen.authorization).toBe('Bearer abc');
  });

  it('RF-G3: Node recorta también espacios iniciales y tabuladores de los extremos', async () => {
    const seen = await observe(['Authorization: \t Bearer abc\t ']);

    expect(authorizationValues(seen.raw)).toEqual(['Bearer abc']);
  });

  it('RF-G3: Bearer seguido de un espacio llega como Bearer (solo el esquema)', async () => {
    const seen = await observe(['Authorization: Bearer ']);

    expect(authorizationValues(seen.raw)).toEqual(['Bearer']);
    expect(seen.authorization).toBe('Bearer');
  });

  it('RF-G3: dos espacios entre esquema y key llegan intactos (no los recorta)', async () => {
    const seen = await observe(['Authorization: Bearer  abc']);

    expect(authorizationValues(seen.raw)).toEqual(['Bearer  abc']);
  });
});
