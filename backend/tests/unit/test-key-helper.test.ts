import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { loadConfig } from '../../src/config/config';
import { baseEnv } from '../helpers/config-env';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { rawRequest } from '../helpers/raw-http';
import { OMIT_KEY_HEADER, TEST_API_KEY, testSecurity, withTestKey } from '../helpers/security';

const BEARER = `Bearer ${TEST_API_KEY}`;

interface Seen {
  authorization: string | undefined;
  distinct: string[] | undefined;
  rawHeaders: string[];
  headerNames: string[];
}

/** App mínima que devuelve lo que ve el servidor: es lo que verá una guarda de key real. */
function probeApp(): Express {
  const app = express();
  app.get('/probe', (req, res) => {
    const seen: Seen = {
      authorization: req.headers.authorization,
      distinct: req.headersDistinct['authorization'],
      rawHeaders: req.rawHeaders,
      headerNames: Object.keys(req.headers),
    };
    res.json(seen);
  });
  return withTestKey(app);
}

function rawAuthorizations(seen: Seen): string[] {
  const values: string[] = [];
  for (let i = 0; i < seen.rawHeaders.length; i += 2) {
    if (seen.rawHeaders[i]?.toLowerCase() === 'authorization') values.push(seen.rawHeaders[i + 1] ?? '');
  }
  return values;
}

function hasOmitMarker(seen: Seen): boolean {
  const marker = OMIT_KEY_HEADER.toLowerCase();
  const inRaw = seen.rawHeaders.some((entry, index) => index % 2 === 0 && entry.toLowerCase() === marker);
  return inRaw || seen.headerNames.includes(marker);
}

const servers: LoopbackServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('RF-G19: withTestKey', () => {
  it('RF-G19: withTestKey añade Authorization en headers y rawHeaders si la petición no trae ninguna', async () => {
    const response = await request(probeApp()).get('/probe');
    const seen = response.body as Seen;

    expect(seen.authorization).toBe(BEARER);
    expect(seen.distinct).toEqual([BEARER]);
    expect(rawAuthorizations(seen)).toEqual([BEARER]);
  });

  it('RF-G19: no inyecta si ya trae una Authorization, con cualquier mayúscula del nombre, ni la duplica', async () => {
    const app = probeApp();
    const server = await listenOnLoopback(app);
    servers.push(server);

    for (const name of ['authorization', 'AUTHORIZATION', 'AuThOrIzAtIoN']) {
      const result = await rawRequest(server.port, [
        `GET /probe HTTP/1.1\r\nHost: x\r\n${name}: Bearer own-${name}\r\nConnection: close\r\n\r\n`,
      ]);
      const seen = JSON.parse(result.responses[0]?.body ?? '{}') as Seen;

      expect(seen.authorization, name).toBe(`Bearer own-${name}`);
      expect(rawAuthorizations(seen), name).toEqual([`Bearer own-${name}`]);
    }

    const sent = await request(app).get('/probe').set('Authorization', 'Basic abc');
    expect((sent.body as Seen).authorization).toBe('Basic abc');
    expect(rawAuthorizations(sent.body as Seen)).toEqual(['Basic abc']);
  });

  it('RF-G19: el marcador X-Test-Omit-Key evita la inyección y desaparece de headers y rawHeaders', async () => {
    const app = probeApp();
    const server = await listenOnLoopback(app);
    servers.push(server);

    const viaSupertest = (await request(app).get('/probe').set(OMIT_KEY_HEADER, '1')).body as Seen;
    const viaRaw = await rawRequest(server.port, [
      'GET /probe HTTP/1.1\r\nHost: x\r\nx-TEST-omit-KEY: 1\r\nConnection: close\r\n\r\n',
    ]);
    const viaSocket = JSON.parse(viaRaw.responses[0]?.body ?? '{}') as Seen;

    for (const seen of [viaSupertest, viaSocket]) {
      expect(seen.authorization).toBeUndefined();
      expect(seen.distinct).toBeUndefined();
      expect(rawAuthorizations(seen)).toEqual([]);
      expect(hasOmitMarker(seen)).toBe(false);
    }
  });

  it('RF-G19: el marcador conserva una Authorization propia que acompañe a la petición', async () => {
    const response = await request(probeApp()).get('/probe').set(OMIT_KEY_HEADER, '1').set('Authorization', 'Bearer x');
    const seen = response.body as Seen;

    expect(seen.authorization).toBe('Bearer x');
    expect(rawAuthorizations(seen)).toEqual(['Bearer x']);
    expect(hasOmitMarker(seen)).toBe(false);
  });

  it('RF-G19: funciona con Supertest, con fetch contra listenOnLoopback y con un socket crudo', async () => {
    const app = probeApp();
    const server = await listenOnLoopback(app);
    servers.push(server);

    const viaSupertest = (await request(app).get('/probe')).body as Seen;
    const viaFetch = (await (await fetch(`http://127.0.0.1:${server.port}/probe`)).json()) as Seen;
    const viaRaw = await rawRequest(server.port, ['GET /probe HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n']);
    const viaSocket = JSON.parse(viaRaw.responses[0]?.body ?? '{}') as Seen;
    const viaHttp = await new Promise<Seen>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${server.port}/probe`, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Seen));
        })
        .on('error', reject);
    });

    for (const seen of [viaSupertest, viaFetch, viaSocket, viaHttp]) {
      expect(seen.authorization).toBe(BEARER);
      expect(rawAuthorizations(seen)).toEqual([BEARER]);
    }
  });

  it('RF-G19: funciona con http.createServer(app), que es como arranca el servicio real', async () => {
    const server = http.createServer(probeApp());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as { port: number };
      const seen = (await (await fetch(`http://127.0.0.1:${port}/probe`)).json()) as Seen;
      expect(seen.authorization).toBe(BEARER);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('RF-G19: baseEnv', () => {
  it('RF-G19: baseEnv() es un entorno válido para loadConfig y acepta sobrescrituras', () => {
    expect(() => loadConfig(baseEnv())).not.toThrow();
    expect(loadConfig(baseEnv({ PORT: '4000' })).server.port).toBe(4000);
    expect(baseEnv({ DATABASE_URL: undefined }).DATABASE_URL).toBeUndefined();
  });

  it('RF-G19: baseEnv devuelve un objeto nuevo en cada llamada', () => {
    expect(baseEnv()).not.toBe(baseEnv());
  });
});

describe('RF-G19: testSecurity', () => {
  it('RF-G19: testSecurity() lleva la key de pruebas y acepta sobrescrituras', () => {
    expect(testSecurity()).toEqual({ apiKey: TEST_API_KEY });
    expect(testSecurity({ apiKey: 'otra' })).toEqual({ apiKey: 'otra' });
  });

  it('RF-G19: TEST_API_KEY cumple el formato de una key válida (43 a 128 caracteres, al menos 10 distintos)', () => {
    expect(TEST_API_KEY).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(new Set(TEST_API_KEY).size).toBeGreaterThanOrEqual(10);
  });
});
