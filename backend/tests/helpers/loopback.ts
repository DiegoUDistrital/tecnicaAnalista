import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

export interface LoopbackServer {
  readonly server: Server;
  readonly port: number;
  close(): Promise<void>;
}

/** Arranca la app en 127.0.0.1 con un puerto libre asignado por el sistema (solo para tests). */
export async function listenOnLoopback(app: Express): Promise<LoopbackServer> {
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
