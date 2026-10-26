import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApiApp, type ApiApp } from '../helpers/api-app';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { rawRequest } from '../helpers/raw-http';
import { getTestDatabase, truncateTasks } from '../helpers/test-database';

const FIVE_FIELDS = ['id', 'title', 'description', 'completed', 'createdAt'];
const JSON_TYPE = 'Content-Type: application/json';
const UUID = '3f1c2d5e-8a0b-4c7d-9e1f-0a2b3c4d5e6f';

const BODY_DETAIL = { field: 'body', message: 'El cuerpo debe ser un objeto JSON válido.' };
const UNKNOWN_DETAIL = { field: 'body', message: 'El cuerpo contiene campos no permitidos.' };
const NO_FIELDS_DETAIL = { field: 'body', message: 'Debe enviar al menos title, description o completed.' };
const ID_DETAIL = { field: 'id', message: 'El identificador no es un UUID válido.' };
const QUERY_DETAIL = { field: 'query', message: 'Parámetros de consulta no permitidos.' };
const TITLE_TYPE_DETAIL = { field: 'title', message: 'Debe ser una cadena de texto.' };
const TITLE_CHARS_DETAIL = { field: 'title', message: 'Contiene caracteres no permitidos.' };
const TITLE_LENGTH_DETAIL = { field: 'title', message: 'Debe tener entre 1 y 100 caracteres.' };
const DESCRIPTION_TYPE_DETAIL = { field: 'description', message: 'Debe ser una cadena de texto.' };
const DESCRIPTION_CHARS_DETAIL = { field: 'description', message: 'Contiene caracteres no permitidos.' };
const DESCRIPTION_LENGTH_DETAIL = { field: 'description', message: 'Debe tener como máximo 500 caracteres.' };
const COMPLETED_DETAIL = { field: 'completed', message: 'Debe ser true o false.' };

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
  json: unknown;
}

interface Stored {
  title: string;
  description: string;
  completed: boolean;
}

/** Petición con socket crudo (los bytes viajan tal cual) y `Connection: close`. Sin cabeceras: JSON por defecto. */
async function send(
  method: string,
  path: string,
  body: string | Buffer,
  headers: readonly string[] = [JSON_TYPE],
): Promise<Reply> {
  const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  const length = bytes.length === 0 ? [] : [`Content-Length: ${bytes.length}`];
  const head = [`${method} ${path} HTTP/1.1`, 'Host: localhost', 'Connection: close', ...headers, ...length];
  const result = await rawRequest(loopback.port, [`${head.join('\r\n')}\r\n\r\n`, bytes]);
  const response = result.responses[0];
  if (response === undefined) {
    throw new Error(`Sin respuesta: ${result.text}`);
  }
  return { status: response.status, headers: response.headers, json: JSON.parse(response.body) as unknown };
}

function put(id: string, payload: unknown, suffix = ''): Promise<Reply> {
  return send('PUT', `/api/tasks/${id}${suffix}`, JSON.stringify(payload));
}

function putRaw(id: string, body: string | Buffer, headers?: readonly string[]): Promise<Reply> {
  return send('PUT', `/api/tasks/${id}`, body, headers);
}

function detailsOf(reply: Reply): unknown {
  return (reply.json as { error: { details: unknown } }).error.details;
}

async function seed(title = 'Comprar pan', description = 'Integral', completed = false): Promise<string> {
  const result = await owner.query<{ id: string }>(
    'INSERT INTO tasks (title, description, completed) VALUES ($1, $2, $3) RETURNING id',
    [title, description, completed],
  );
  return (result.rows[0] as { id: string }).id;
}

async function stored(id: string): Promise<Stored | undefined> {
  const result = await owner.query<Stored>('SELECT title, description, completed FROM tasks WHERE id = $1', [id]);
  return result.rows[0];
}

const SEED: Stored = { title: 'Comprar pan', description: 'Integral', completed: false };

describe('RF-C15: actualización parcial', () => {
  it('RF-C15: PUT con title, description y completed responde 200 con exactamente los cinco campos', async () => {
    const id = await seed();

    const reply = await put(id, { title: 'Nuevo', description: 'Otra', completed: true });

    expect(reply.status).toBe(200);
    expect(Object.keys(reply.json as object)).toEqual(FIVE_FIELDS);
    expect(reply.json).toMatchObject({ id, title: 'Nuevo', description: 'Otra', completed: true });
    expect(await stored(id)).toEqual({ title: 'Nuevo', description: 'Otra', completed: true });
  });

  it('RF-C15: PUT {"completed":true} deja title y description intactos', async () => {
    const id = await seed();

    const reply = await put(id, { completed: true });

    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({ title: SEED.title, description: SEED.description, completed: true });
    expect(await stored(id)).toEqual({ ...SEED, completed: true });
  });

  it('RF-C15: dos PUT concurrentes, uno con title y otro con completed, dejan ambos cambios', async () => {
    for (let round = 0; round < 15; round += 1) {
      const id = await seed();

      const replies = await Promise.all([put(id, { title: `Título ${round}` }), put(id, { completed: true })]);

      expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
      expect(await stored(id)).toEqual({ title: `Título ${round}`, description: SEED.description, completed: true });
    }
  });
});

describe('RF-C16: cuerpo sin campos o con campos desconocidos', () => {
  it('RF-C16: {} y {"foo":1} dan UNA entrada body; con ?x=1 dan body y query', async () => {
    const emptyAlone = await put(UUID, {});
    const unknownAlone = await put(UUID, { foo: 1 });
    expect(detailsOf(emptyAlone)).toEqual([NO_FIELDS_DETAIL]);
    expect(detailsOf(unknownAlone)).toEqual([UNKNOWN_DETAIL]);

    const empty = await put(UUID, {}, '?x=1');
    const unknown = await put(UUID, { foo: 1 }, '?x=1');

    expect(detailsOf(empty)).toEqual([NO_FIELDS_DETAIL, QUERY_DETAIL]);
    expect(detailsOf(unknown)).toEqual([UNKNOWN_DETAIL, QUERY_DETAIL]);
  });

  it('RF-C16: {"foo":1,"completed":"x"} da body y completed; {"foo":1,"title":""} da body y title', async () => {
    const withCompleted = await put(UUID, { foo: 1, completed: 'x' });
    const withTitle = await put(UUID, { foo: 1, title: '' });

    expect(detailsOf(withCompleted)).toEqual([UNKNOWN_DETAIL, COMPLETED_DETAIL]);
    expect(detailsOf(withTitle)).toEqual([UNKNOWN_DETAIL, TITLE_LENGTH_DETAIL]);
  });

  it('RF-C16: tras un 400 por campo desconocido junto a uno válido la tarea queda intacta', async () => {
    const id = await seed();

    const reply = await put(id, { completed: true, foo: 1 });

    expect(reply.status).toBe(400);
    expect(await stored(id)).toEqual(SEED);
  });
});

describe('RF-C17: tarea inexistente', () => {
  it('RF-C17: PUT de un id válido inexistente da 404 NOT_FOUND', async () => {
    const reply = await put(UUID, { completed: true });

    expect(reply.status).toBe(404);
    expect(reply.json).toEqual({
      error: { code: 'NOT_FOUND', message: 'Recurso no encontrado.', details: [] },
    });
  });
});

describe('RF-C6: identificador por HTTP', () => {
  const hostile: [string, string][] = [
    ['%E0%A4%A (porcentaje roto)', '%E0%A4%A'],
    ['%252D (doble codificación)', UUID.replace('-', '%252D')],
    ['texto cualquiera', 'abc'],
  ];

  it.each(hostile)('RF-C6: PUT con id inválido %s da 400 con SOLO la entrada id', async (_label, raw) => {
    const id = await seed();

    const reply = await putRaw(raw, JSON.stringify({ completed: true }));

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([ID_DETAIL]);
    expect(await stored(id)).toEqual(SEED);
  });
});

describe('RF-C7: campos desconocidos en PUT', () => {
  it.each([['{"__proto__":{}}'], ['{"constructor":1}'], ['{"id":"x"}'], ['{"createdAt":"x"}']])(
    'RF-C7: %s en PUT da 400 body',
    async (body) => {
      const reply = await putRaw(UUID, body);

      expect(reply.status).toBe(400);
      expect(detailsOf(reply)).toEqual([UNKNOWN_DETAIL]);
    },
  );
});

describe('RF-C8 / RF-C9 / RF-C11: tipos y textos en PUT', () => {
  it.each([
    ['{"completed":"true"}', [COMPLETED_DETAIL]],
    ['{"completed":1}', [COMPLETED_DETAIL]],
    ['{"completed":null}', [COMPLETED_DETAIL]],
    ['{"title":"  "}', [TITLE_LENGTH_DETAIL]],
    ['{"title":null}', [TITLE_TYPE_DETAIL]],
    ['{"description":null}', [DESCRIPTION_TYPE_DETAIL]],
    [JSON.stringify({ title: 'x'.repeat(101) }), [TITLE_LENGTH_DETAIL]],
    [JSON.stringify({ description: 'x'.repeat(501) }), [DESCRIPTION_LENGTH_DETAIL]],
    [JSON.stringify({ title: 'a\u0000b' }), [TITLE_CHARS_DETAIL]],
    [JSON.stringify({ description: 'a\uD800b' }), [DESCRIPTION_CHARS_DETAIL]],
  ])('RF-C8/C9/C11: %s da 400 en su campo', async (body, details) => {
    const id = await seed();

    const reply = await putRaw(id, body);

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual(details);
    expect(await stored(id)).toEqual(SEED);
  });

  it('RF-C9: 100 caracteres de title y 500 de description se aceptan', async () => {
    const id = await seed();

    const reply = await put(id, { title: 'x'.repeat(100), description: 'y'.repeat(500) });

    expect(reply.status).toBe(200);
  });

  it('RF-C9: U+0085 y U+200B en los extremos no se recortan', async () => {
    const id = await seed();
    const title = '\u0085a​';

    const reply = await put(id, { title });

    expect(reply.status).toBe(200);
    expect((await stored(id))?.title).toBe(title);
  });
});

describe('RF-C10: consulta en PUT', () => {
  it.each(['?completed=true', '?x=1'])('RF-C10: PUT %s da 400 query', async (query) => {
    const id = await seed();

    const reply = await put(id, { completed: true }, query);

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([QUERY_DETAIL]);
    expect(await stored(id)).toEqual(SEED);
  });
});

describe('RF-C3 / RF-C4 / RF-C5: entrada de PUT', () => {
  it('RF-C4: Content-Type text/plain da 415', async () => {
    const reply = await putRaw(UUID, '{"completed":true}', ['Content-Type: text/plain']);

    expect(reply.status).toBe(415);
  });

  it.each<[string, Buffer]>([
    ['vacío', Buffer.alloc(0)],
    ['UTF-8 inválido (FF FE)', Buffer.from([0xff, 0xfe])],
    ['BOM y objeto', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"completed":true}')])],
    ['JSON roto', Buffer.from('{"completed":')],
    ['raíz arreglo', Buffer.from('[]')],
    ['raíz null', Buffer.from('null')],
  ])('RF-C5: el cuerpo %s da 400 body', async (_label, bytes) => {
    const reply = await putRaw(UUID, bytes);

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([BODY_DETAIL]);
  });
});

describe('RF-C20: createdAt', () => {
  it('RF-C20: createdAt de la respuesta sale con milisegundos truncados y no cambia tras el PUT', async () => {
    const result = await owner.query<{ id: string }>(
      `INSERT INTO tasks (title, "createdAt") VALUES ('t', '2026-01-02T03:04:05.678999Z') RETURNING id`,
    );
    const id = (result.rows[0] as { id: string }).id;

    const first = await put(id, { completed: true });
    const second = await put(id, { title: 'otro' });

    expect((first.json as { createdAt: string }).createdAt).toBe('2026-01-02T03:04:05.678Z');
    expect((second.json as { createdAt: string }).createdAt).toBe('2026-01-02T03:04:05.678Z');
  });
});

describe('RF-C21: inyección SQL por PUT', () => {
  it('RF-C21: cargas hostiles en title y description se guardan literales y la tabla sigue intacta', async () => {
    const id = await seed();
    const title = "'); DROP TABLE tasks;--";
    const description = "x'; DELETE FROM tasks;--";

    const reply = await put(id, { title, description });

    expect(reply.status).toBe(200);
    expect(await stored(id)).toEqual({ title, description, completed: false });
    const table = await owner.query(`SELECT to_regclass('public.tasks') IS NOT NULL AS found`);
    expect((table.rows[0] as { found: boolean }).found).toBe(true);
  });
});
