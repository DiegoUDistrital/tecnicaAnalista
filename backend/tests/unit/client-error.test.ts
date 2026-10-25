import { EventEmitter } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachClientErrorHandler } from '../../src/server/client-error';
import { rawRequest } from '../helpers/raw-http';

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

/** Servidor HTTP real y mínimo; con `withHandler` lleva el manejador de `clientError` que se prueba. */
async function listen(withHandler: boolean): Promise<number> {
  const server = http.createServer((_req, res) => {
    res.end('ok');
  });
  if (withHandler) {
    attachClientErrorHandler(server);
  }
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

interface FakeSocket {
  writable: boolean;
  bytesWritten: number;
  end: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

function fakeSocket(overrides: Partial<FakeSocket> = {}): FakeSocket {
  return { writable: true, bytesWritten: 0, end: vi.fn(), destroy: vi.fn(), ...overrides };
}

function clientError(code: string | undefined): NodeJS.ErrnoException {
  return Object.assign(new Error('boom'), { code });
}

function emitOn(socket: FakeSocket, code: string | undefined): void {
  const emitter = new EventEmitter();
  attachClientErrorHandler(emitter as unknown as http.Server);
  emitter.emit('clientError', clientError(code), socket);
}

describe('RF-C24: manejador de clientError (HPE_INVALID_EOF_STATE)', () => {
  it('RF-C24: un socket escribible y sin datos escritos recibe el 400 JSON y se cierra', () => {
    const socket = fakeSocket();

    emitOn(socket, 'HPE_INVALID_EOF_STATE');

    expect(socket.end).toHaveBeenCalledTimes(1);
    const written = String(socket.end.mock.calls[0]?.[0]);
    expect(written).toMatch(/^HTTP\/1\.1 400 Bad Request\r\n/);
    expect(written).toContain('Content-Type: application/json; charset=utf-8\r\n');
    expect(written).toContain('Connection: close\r\n');
    const body = written.slice(written.indexOf('\r\n\r\n') + 4);
    expect(written).toContain(`Content-Length: ${Buffer.byteLength(body)}\r\n`);
    expect(JSON.parse(body)).toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: [{ field: 'body' }] },
    });
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  it('RF-C24: si el socket ya no es escribible se destruye sin escribir y sin lanzar', () => {
    const socket = fakeSocket({ writable: false });

    expect(() => emitOn(socket, 'HPE_INVALID_EOF_STATE')).not.toThrow();

    expect(socket.end).not.toHaveBeenCalled();
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it('RF-C24: si el socket ya envió bytes (otra respuesta) solo se destruye, sin un segundo mensaje', () => {
    const socket = fakeSocket({ bytesWritten: 120 });

    emitOn(socket, 'HPE_INVALID_EOF_STATE');

    expect(socket.end).not.toHaveBeenCalled();
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('RF-C24: los demás errores de cliente se comportan como el valor por defecto de Node', () => {
  it.each([
    ['petición mal formada', 'GARBAGE\r\n\r\n'],
    ['método desconocido para el analizador', 'BREW /x HTTP/1.1\r\nHost: l\r\n\r\n'],
  ])('RF-C24: %s recibe lo mismo con el manejador que sin él', async (_name, raw) => {
    const withHandler = await rawRequest(await listen(true), [raw]);
    const byDefault = await rawRequest(await listen(false), [raw]);

    expect(withHandler.text).toMatch(/^HTTP\/1\.1 400 Bad Request\r\n/);
    expect(withHandler.text).toBe(byDefault.text);
    expect(withHandler.closedByServer).toBe(true);
  });

  it('RF-C24: cabeceras que superan el límite de Node reciben el 431 de Node con Connection: close', async () => {
    const raw = `GET / HTTP/1.1\r\nHost: l\r\nX-A: ${'a'.repeat(70 * 1024)}\r\n\r\n`;

    const result = await rawRequest(await listen(true), [raw]);

    expect(result.text).toBe('HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n');
  });

  it('RF-C24: con un socket no escribible solo se destruye, sea cual sea el error', () => {
    const unwritable = fakeSocket({ writable: false });

    emitOn(unwritable, 'HPE_INVALID_METHOD');

    expect(unwritable.end).not.toHaveBeenCalled();
    expect(unwritable.destroy).toHaveBeenCalledTimes(1);
  });

  it('RF-C24: un error sin código recibe el 400 sin cuerpo de Node', () => {
    const socket = fakeSocket();

    emitOn(socket, undefined);

    expect(String(socket.end.mock.calls[0]?.[0])).toBe('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  it('RF-C24: HPE_HEADER_OVERFLOW da 431 y ERR_HTTP_REQUEST_TIMEOUT da 408, como Node', () => {
    const overflow = fakeSocket();
    const timeout = fakeSocket();

    emitOn(overflow, 'HPE_HEADER_OVERFLOW');
    emitOn(timeout, 'ERR_HTTP_REQUEST_TIMEOUT');

    expect(String(overflow.end.mock.calls[0]?.[0])).toBe(
      'HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n',
    );
    expect(String(timeout.end.mock.calls[0]?.[0])).toBe('HTTP/1.1 408 Request Timeout\r\nConnection: close\r\n\r\n');
  });
});
