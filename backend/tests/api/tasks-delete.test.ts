import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCaptureLogger } from '../helpers/capture-logger';
import { createClosedPortDatabase, startApiApp, type ApiApp } from '../helpers/api-app';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { rawRequest } from '../helpers/raw-http';
import { getTestDatabase, truncateTasks } from '../helpers/test-database';

const JSON_TYPE = 'Content-Type: application/json';
const UUID = '3f1c2d5e-8a0b-4c7d-9e1f-0a2b3c4d5e6f';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const LOWER_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Recurso no encontrado.', details: [] } };
const ID_DETAIL = { field: 'id', message: 'El identificador no es un UUID válido.' };
const QUERY_DETAIL = { field: 'query', message: 'Parámetros de consulta no permitidos.' };
const NO_BODY_DETAIL = { field: 'body', message: 'Esta ruta no admite cuerpo.' };

let api: ApiApp;
let loopback: LoopbackServer;
let owner: Client;

beforeAll(async () => {
  api = await startApiApp();
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
  text: string;
}

/** Petición con socket crudo (los bytes viajan tal cual) y `Connection: close`. Sin cabeceras ni cuerpo por defecto. */
async function send(
  port: number,
  method: string,
  path: string,
  body: string | Buffer = '',
  headers: readonly string[] = [],
): Promise<Reply> {
  const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  const length = bytes.length === 0 ? [] : [`Content-Length: ${bytes.length}`];
  const head = [`${method} ${path} HTTP/1.1`, 'Host: localhost', 'Connection: close', ...headers, ...length];
  const result = await rawRequest(port, [`${head.join('\r\n')}\r\n\r\n`, bytes]);
  const response = result.responses[0];
  if (response === undefined) {
    throw new Error(`Sin respuesta: ${result.text}`);
  }
  return { status: response.status, headers: response.headers, text: response.body };
}

function del(id: string, suffix = '', body: string | Buffer = '', headers: readonly string[] = []): Promise<Reply> {
  return send(loopback.port, 'DELETE', `/api/tasks/${id}${suffix}`, body, headers);
}

function put(id: string, payload: unknown): Promise<Reply> {
  return send(loopback.port, 'PUT', `/api/tasks/${id}`, JSON.stringify(payload), [JSON_TYPE]);
}

function detailsOf(reply: Reply): unknown {
  return (JSON.parse(reply.text) as { error: { details: unknown } }).error.details;
}

async function seed(title = 'Comprar pan'): Promise<string> {
  const result = await owner.query<{ id: string }>('INSERT INTO tasks (title) VALUES ($1) RETURNING id', [title]);
  return (result.rows[0] as { id: string }).id;
}

async function count(): Promise<number> {
  const result = await owner.query<{ total: string }>('SELECT count(*) AS total FROM tasks');
  return Number((result.rows[0] as { total: string }).total);
}

async function exists(id: string): Promise<boolean> {
  const result = await owner.query('SELECT 1 FROM tasks WHERE id = $1', [id]);
  return result.rowCount === 1;
}

describe('RF-C18: borrado', () => {
  it('RF-C18: DELETE de una tarea existente responde 204 sin cuerpo y la tarea desaparece de la lista', async () => {
    const id = await seed();

    const reply = await del(id);
    const list = await send(loopback.port, 'GET', '/api/tasks');

    expect(reply.status).toBe(204);
    expect(reply.text).toBe('');
    expect(reply.headers['content-length']).toBeUndefined();
    expect(reply.headers['content-type']).toBeUndefined();
    expect(JSON.parse(list.text)).toEqual([]);
    expect(await exists(id)).toBe(false);
  });

  it('RF-C18: no borra otras tareas', async () => {
    const target = await seed('Una');
    const other = await seed('Otra');

    await del(target);

    expect(await exists(target)).toBe(false);
    expect(await exists(other)).toBe(true);
    expect(await count()).toBe(1);
  });

  it('RF-C18: un id en mayúsculas borra la tarea (RF-C6)', async () => {
    const id = await seed();

    const reply = await del(id.toUpperCase());

    expect(reply.status).toBe(204);
    expect(await exists(id)).toBe(false);
  });

  it('RF-C18: DELETE no deja datos del usuario en el log', async () => {
    const id = await seed('titulo-secreto-zzz');
    const before = api.capture.lines.length;

    const deleted = await del(id);
    const repeated = await del(id);

    expect(deleted.status).toBe(204);
    expect(repeated.status).toBe(404);
    expect(api.capture.lines.slice(before)).toEqual([]);
    expect(api.capture.output()).not.toContain('titulo-secreto-zzz');
    expect(api.capture.output()).not.toContain(id);
  });
});

describe('RF-C19: tarea inexistente y concurrencia', () => {
  it('RF-C19: DELETE repetido responde 404 NOT_FOUND', async () => {
    const id = await seed();

    const first = await del(id);
    const second = await del(id);

    expect(first.status).toBe(204);
    expect(second.status).toBe(404);
    expect(JSON.parse(second.text)).toEqual(NOT_FOUND);
  });

  it.each([[UUID], [NIL_UUID]])('RF-C19: DELETE de un id válido inexistente (%s) responde 404', async (id) => {
    const reply = await del(id);

    expect(reply.status).toBe(404);
    expect(JSON.parse(reply.text)).toEqual(NOT_FOUND);
  });

  it('RF-C19: dos DELETE simultáneos de la misma tarea dan exactamente un 204 y un 404', async () => {
    for (let round = 0; round < 15; round += 1) {
      const id = await seed();

      const replies = await Promise.all([del(id), del(id)]);

      expect(replies.map((reply) => reply.status).sort()).toEqual([204, 404]);
      expect(await exists(id)).toBe(false);
    }
  });

  it('RF-C15: 50 iteraciones de PUT y DELETE a la vez dan siempre 200 o 404 en el PUT, nunca 500', async () => {
    const outcomes = { put200: 0, put404: 0 };
    for (let round = 0; round < 50; round += 1) {
      const id = await seed();

      const [updated, deleted] = await Promise.all([put(id, { completed: true }), del(id)]);

      expect([200, 404]).toContain(updated.status);
      expect(deleted.status).toBe(204);
      if (updated.status === 200) {
        outcomes.put200 += 1;
      } else {
        outcomes.put404 += 1;
      }
      expect(await exists(id)).toBe(false);
    }
    expect(outcomes.put200 + outcomes.put404).toBe(50);
  }, 30_000);
});

describe('RF-C6: identificador en DELETE', () => {
  const FULL_WIDTH_ONE = encodeURIComponent('１');
  const hostile: [string, string][] = [
    ['%E0%A4%A (porcentaje roto)', '%E0%A4%A'],
    ['%2F', '%2F'],
    ['<uuid>%2F', `${UUID}%2F`],
    ['%252D (doble codificación)', UUID.replace('-', '%252D')],
    ['%0A (salto de línea final)', `${UUID}%0A`],
    ['dígito de anchura completa', `${FULL_WIDTH_ONE}${UUID.slice(1)}`],
    ['llaves', `%7B${UUID}%7D`],
    ['sin guiones', UUID.replaceAll('-', '')],
  ];

  it.each(hostile)('RF-C6: DELETE con id inválido %s da 400 con SOLO la entrada id', async (_label, raw) => {
    const id = await seed();

    const reply = await del(raw);

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([ID_DETAIL]);
    expect(await exists(id)).toBe(true);
  });

  it('RF-C6: %2D por guiones y %41 por A se aceptan', async () => {
    await owner.query('INSERT INTO tasks (id, title) VALUES ($1, $2)', [UUID, 'a']);
    await owner.query('INSERT INTO tasks (id, title) VALUES ($1, $2)', [LOWER_UUID, 'b']);

    const hyphens = await del(UUID.replaceAll('-', '%2D'));
    const letter = await del(LOWER_UUID.replace('a', '%41'));

    expect(hyphens.status).toBe(204);
    expect(letter.status).toBe(204);
    expect(await count()).toBe(0);
  });
});

describe('RF-C5: cuerpo en DELETE', () => {
  it('RF-C5: DELETE con body JSON y Content-Type JSON da 400 body y no borra', async () => {
    const id = await seed();

    const reply = await del(id, '', '{"a":1}', [JSON_TYPE]);

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([NO_BODY_DETAIL]);
    expect(await exists(id)).toBe(true);
  });

  it('RF-C5: DELETE con body y sin Content-Type da 415', async () => {
    const id = await seed();

    const reply = await del(id, '', '{"a":1}');

    expect(reply.status).toBe(415);
    expect(await exists(id)).toBe(true);
  });

  it('RF-C5: DELETE con body de solo espacios y tipo JSON da 400 body', async () => {
    const id = await seed();

    const reply = await del(id, '', '   ', [JSON_TYPE]);

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([NO_BODY_DETAIL]);
    expect(await exists(id)).toBe(true);
  });
});

describe('RF-C3 / RF-C4: entrada de DELETE', () => {
  it('RF-C4: DELETE con Content-Encoding gzip da 415 y no borra', async () => {
    const id = await seed();

    const reply = await del(id, '', '', ['Content-Encoding: gzip']);

    expect(reply.status).toBe(415);
    expect(await exists(id)).toBe(true);
  });

  it('RF-C3: DELETE con 10 241 bytes da 413 y no borra', async () => {
    const id = await seed();

    const reply = await del(id, '', 'x'.repeat(10241), [JSON_TYPE]);

    expect(reply.status).toBe(413);
    expect(await exists(id)).toBe(true);
  });
});

describe('RF-C10: consulta en DELETE', () => {
  it.each(['?x=1', '?completed=true'])('RF-C10: DELETE %s da 400 query y no borra', async (query) => {
    const id = await seed();

    const reply = await del(id, query);

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([QUERY_DETAIL]);
    expect(await exists(id)).toBe(true);
  });
});

describe('RF-C24: desajuste de longitud en DELETE', () => {
  it('RF-C24: DELETE con Content-Length mayor que lo enviado y cierre da 400 body y cierra la conexión', async () => {
    const id = await seed();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const head = `DELETE /api/tasks/${id} HTTP/1.1\r\nHost: localhost\r\n${JSON_TYPE}\r\nContent-Length: 50\r\n\r\n`;

      const result = await rawRequest(loopback.port, [head, '{"a"'], { afterWrite: 'end' });

      expect(result.responses).toHaveLength(1);
      expect(result.responses[0]?.status).toBe(400);
      expect((JSON.parse(result.responses[0]?.body ?? '') as { error: { details: unknown } }).error.details).toEqual([
        { field: 'body', message: 'El cuerpo no coincide con la longitud declarada.' },
      ]);
      expect(result.closedByServer).toBe(true);
    }
    expect(await exists(id)).toBe(true);
  });
});

describe('RF-C1: orden de comprobación en DELETE', () => {
  it('RF-C1 par 4-5: DELETE /api/tasks/%E0%A4%A con body JSON da 400 body (no id)', async () => {
    const reply = await del('%E0%A4%A', '', '{"a":1}', [JSON_TYPE]);

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([NO_BODY_DETAIL]);
  });

  it('RF-C1 par 5-6: DELETE con id inválido y ?x=1 da SOLO id', async () => {
    const reply = await del('abc', '?x=1');

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([ID_DETAIL]);
  });

  it('RF-C1 par 7-8: DELETE de un id válido con la BD apagada da 500 genérico y el log no lleva el id', async () => {
    const capture = createCaptureLogger();
    const down = await startApiApp({ capture, database: await createClosedPortDatabase(capture.logger) });
    const server = await listenOnLoopback(down.app);
    try {
      const reply = await send(server.port, 'DELETE', `/api/tasks/${UUID}`);

      expect(reply.status).toBe(500);
      expect(JSON.parse(reply.text)).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.', details: [] },
      });
      expect(capture.output()).not.toContain(UUID);
    } finally {
      await server.close();
      await down.close();
    }
  });
});

describe('RF-C22: métodos en la ruta de identificador', () => {
  it('RF-C22: PATCH en /api/tasks/<uuid> da 405 con Allow: PUT, DELETE', async () => {
    const reply = await send(loopback.port, 'PATCH', `/api/tasks/${UUID}`);

    expect(reply.status).toBe(405);
    expect(reply.headers['allow']).toBe('PUT, DELETE');
  });
});
