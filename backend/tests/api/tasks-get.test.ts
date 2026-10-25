import type { Express } from 'express';
import type { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCaptureLogger } from '../helpers/capture-logger';
import { createClosedPortDatabase, startApiApp, type ApiApp } from '../helpers/api-app';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { rawRequest } from '../helpers/raw-http';
import { getTestDatabase, truncateTasks } from '../helpers/test-database';

const FIVE_FIELDS = ['id', 'title', 'description', 'completed', 'createdAt'];
const QUERY_DETAIL = { field: 'query', message: 'Parámetros de consulta no permitidos.' };
const COMPLETED_DETAIL = { field: 'completed', message: 'Debe ser true o false.' };
const UUID = '3f1c2d5e-8a0b-4c7d-9e1f-0a2b3c4d5e6f';

let api: ApiApp;
let loopback: LoopbackServer;
let owner: Client;

function registerQueryProbe(app: Express): void {
  app.get('/api/test-query', (req, res) => {
    res.json({ keys: Object.keys(req.query) });
  });
}

beforeAll(async () => {
  api = await startApiApp({ registerRoutes: registerQueryProbe });
  loopback = await listenOnLoopback(api.app);
  owner = await getTestDatabase().ownerClient();
});

beforeEach(async () => {
  await truncateTasks();
});

afterAll(async () => {
  await loopback.close();
  await owner.end();
  await api.close();
});

interface Reply {
  status: number;
  headers: Readonly<Record<string, string>>;
  json: unknown;
}

/** Petición con socket crudo (la ruta llega tal cual, sin normalizar) y `Connection: close`. */
async function call(method: string, path: string, extraHeaders: readonly string[] = [], body = ''): Promise<Reply> {
  const lines = ['Host: localhost', 'Connection: close', ...extraHeaders];
  if (body !== '') {
    lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
  }
  const text = `${method} ${path} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n${body}`;
  const result = await rawRequest(loopback.port, [text]);
  const response = result.responses[0];
  if (response === undefined) {
    throw new Error(`Sin respuesta: ${result.text}`);
  }
  return { status: response.status, headers: response.headers, json: JSON.parse(response.body) as unknown };
}

function detailsOf(reply: Reply): unknown {
  return (reply.json as { error: { details: unknown } }).error.details;
}

async function insert(title: string, createdAt: string, completed = false): Promise<void> {
  await owner.query('INSERT INTO tasks (title, "createdAt", completed) VALUES ($1, $2::timestamptz, $3)', [
    title,
    createdAt,
    completed,
  ]);
}

async function seedMixed(): Promise<void> {
  await insert('pendiente', '2026-01-01T10:00:00Z', false);
  await insert('hecha', '2026-01-02T10:00:00Z', true);
}

function titles(reply: Reply): string[] {
  return (reply.json as { title: string }[]).map((task) => task.title);
}

describe('RF-C12: GET /api/tasks', () => {
  it('RF-C12: GET /api/tasks sin tareas responde 200 y []', async () => {
    const res = await request(api.app).get('/api/tasks');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.body).toEqual([]);
  });

  it('RF-C12: con tareas responde 200 con las tareas completas (exactamente los cinco campos)', async () => {
    await insert('Comprar pan', '2026-01-02T03:04:05.678Z');

    const res = await request(api.app).get('/api/tasks');

    expect(res.status).toBe(200);
    const tasks = res.body as object[];
    expect(tasks).toHaveLength(1);
    expect(Object.keys(tasks[0] as object)).toEqual(FIVE_FIELDS);
    expect(tasks[0]).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/) as string,
      title: 'Comprar pan',
      description: '',
      completed: false,
      createdAt: '2026-01-02T03:04:05.678Z',
    });
  });

  it('RF-C12: GET /api/tasks? equivale a sin consulta', async () => {
    await seedMixed();

    const plain = await call('GET', '/api/tasks');
    const empty = await call('GET', '/api/tasks?');

    expect(empty.status).toBe(200);
    expect(empty.json).toEqual(plain.json);
  });

  it.each(['*', 'W/"abc"', '"abc"'])(
    'RF-C12: If-None-Match %s no produce 304: responde 200 y sin ETag',
    async (tag) => {
      const res = await call('GET', '/api/tasks', [`If-None-Match: ${tag}`]);

      expect(res.status).toBe(200);
      expect(res.headers['etag']).toBeUndefined();
    },
  );

  it('RF-C14: la lista llega ordenada por createdAt descendente', async () => {
    await insert('antigua', '2026-01-01T00:00:00Z');
    await insert('reciente', '2026-03-01T00:00:00Z');
    await insert('media', '2026-02-01T00:00:00Z');

    expect(titles(await call('GET', '/api/tasks'))).toEqual(['reciente', 'media', 'antigua']);
  });

  it('RF-C20: createdAt sale con milisegundos truncados (marca ...123987 del owner sale ...123)', async () => {
    await insert('precisa', '2026-01-02T03:04:05.123987+00:00');

    const reply = await call('GET', '/api/tasks');

    expect((reply.json as { createdAt: string }[])[0]?.createdAt).toBe('2026-01-02T03:04:05.123Z');
  });
});

describe('RF-C13: filtro completed', () => {
  it('RF-C13: ?completed=true devuelve solo completadas y ?completed=false solo pendientes', async () => {
    await seedMixed();

    expect(titles(await call('GET', '/api/tasks?completed=true'))).toEqual(['hecha']);
    expect(titles(await call('GET', '/api/tasks?completed=false'))).toEqual(['pendiente']);
  });

  it.each(['completed=%74rue', '%63ompleted=true', '&completed=true&&'])(
    'RF-C10: %s da 200 (una sola decodificación)',
    async (query) => {
      await seedMixed();

      const reply = await call('GET', `/api/tasks?${query}`);

      expect(reply.status).toBe(200);
      expect(titles(reply)).toEqual(['hecha']);
    },
  );
});

describe('RF-C10: consulta inválida', () => {
  it.each([
    'completed=TRUE',
    'completed=',
    'completed',
    'completed=a&completed=b',
    'completed=true&completed=true',
    'completed[]=true',
    'completed%5B%5D=true',
    'completed=true%20',
    'completed=%2574rue',
    'completed=%E0%A4%A',
  ])('RF-C10: ?%s da 400 con field completed (no 500)', async (query) => {
    const reply = await call('GET', `/api/tasks?${query}`);

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([COMPLETED_DETAIL]);
  });

  it.each(['filter=pending', '__proto__=x', 'constructor=1', 'a[b]=1', 'completed[', 'completed[a]x', '=x'])(
    'RF-C10: ?%s da 400 con field query y el nombre no se refleja',
    async (query) => {
      const reply = await call('GET', `/api/tasks?${query}`);

      expect(reply.status).toBe(400);
      expect(detailsOf(reply)).toEqual([QUERY_DETAIL]);
      const name = query.split('=')[0] as string;
      if (name !== '') {
        expect(JSON.stringify(reply.json)).not.toContain(name);
      }
    },
  );

  it('RF-C10: 1 500 parámetros dan 400 query', async () => {
    const query = `${'a&'.repeat(1499)}completed=true`;

    const reply = await call('GET', `/api/tasks?${query}`);

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([QUERY_DETAIL]);
  });

  it('RF-C10: completed inválido y parámetro desconocido a la vez dan query y completed, en ese orden', async () => {
    const reply = await call('GET', '/api/tasks?completed=nope&x=1');

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([QUERY_DETAIL, COMPLETED_DETAIL]);
  });

  it('RF-C10: control: una ruta de prueba que lee req.query no ve nada (el intérprete está desactivado)', async () => {
    const reply = await call('GET', '/api/test-query?a=1&__proto__=x&completed=true');

    expect(reply.json).toEqual({ keys: [] });
  });
});

describe('RF-C22: métodos y rutas de /api/tasks', () => {
  it.each(['OPTIONS', 'PUT', 'DELETE', 'PATCH', 'PROPFIND'])(
    'RF-C22: %s en /api/tasks da 405 con Allow: GET, POST',
    async (method) => {
      const reply = await call(method, '/api/tasks');

      expect(reply.status).toBe(405);
      expect(reply.headers['allow']).toBe('GET, POST');
      expect(reply.json).toEqual({
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido.', details: [] },
      });
    },
  );

  it('RF-C22: HEAD en /api/tasks da 405 con Allow: GET, POST', async () => {
    const res = await request(api.app).head('/api/tasks');

    expect(res.status).toBe(405);
    expect(res.headers['allow']).toBe('GET, POST');
  });

  it.each(['/api/tasks/', '/api/tasks//', '/api/%74asks', '/api/nada', '/api', '/api/'])(
    'RF-C22: %s da 404',
    async (path) => {
      const reply = await call('GET', path);

      expect(reply.status).toBe(404);
      expect(reply.json).toEqual({ error: { code: 'NOT_FOUND', message: 'Recurso no encontrado.', details: [] } });
    },
  );

  // PUT tiene sus propios tests y DELETE aún no está cableado (T4); la tabla de métodos da 405 a lo no cableado.
  it.each(['GET', 'POST', 'PATCH'])(
    'RF-C22: TRANSITORIO (la 004 lo sustituye en T5): %s /api/tasks/<uuid> da 405',
    async (method) => {
      const reply = await call(method, `/api/tasks/${UUID}`);

      expect(reply.status).toBe(405);
    },
  );
});

describe('RF-C5: la tubería de entrada está conectada a la ruta real', () => {
  it('RF-C5: GET con body JSON da 400 body', async () => {
    const reply = await call('GET', '/api/tasks', ['Content-Type: application/json'], '{"a":1}');

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([{ field: 'body', message: 'Esta ruta no admite cuerpo.' }]);
  });

  it('RF-C5: GET con gzip y sin body da 415', async () => {
    const reply = await call('GET', '/api/tasks', ['Content-Encoding: gzip']);

    expect(reply.status).toBe(415);
  });
});

describe('RF-C2 (i): base de datos inalcanzable', () => {
  it('RF-C2 (i): con el Pool a un puerto cerrado responde 500 genérico y el log no lleva datos', async () => {
    const capture = createCaptureLogger();
    const closed = await createClosedPortDatabase(capture.logger);
    const down = await startApiApp({ capture, database: closed });
    try {
      const res = await request(down.app).get('/api/tasks?completed=true');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.', details: [] },
      });
      const records = capture.records();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        level: 'error',
        event: 'request_error',
        errorClass: 'DatabaseUnavailableError',
      });
      expect(capture.output()).not.toContain('completed=true');
    } finally {
      await down.close();
    }
  });
});
