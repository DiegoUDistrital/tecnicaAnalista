import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApiApp, type ApiApp } from '../helpers/api-app';
import { listenOnLoopback, type LoopbackServer } from '../helpers/loopback';
import { rawRequest } from '../helpers/raw-http';
import { getTestDatabase, truncateTasks } from '../helpers/test-database';

const FIVE_FIELDS = ['id', 'title', 'description', 'completed', 'createdAt'];
const JSON_TYPE = 'Content-Type: application/json';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const BODY_DETAIL = { field: 'body', message: 'El cuerpo debe ser un objeto JSON válido.' };
const UNKNOWN_DETAIL = { field: 'body', message: 'El cuerpo contiene campos no permitidos.' };
const QUERY_DETAIL = { field: 'query', message: 'Parámetros de consulta no permitidos.' };
const TITLE_TYPE_DETAIL = { field: 'title', message: 'Debe ser una cadena de texto.' };
const TITLE_CHARS_DETAIL = { field: 'title', message: 'Contiene caracteres no permitidos.' };
const TITLE_LENGTH_DETAIL = { field: 'title', message: 'Debe tener entre 1 y 100 caracteres.' };
const DESCRIPTION_TYPE_DETAIL = { field: 'description', message: 'Debe ser una cadena de texto.' };
const DESCRIPTION_LENGTH_DETAIL = { field: 'description', message: 'Debe tener como máximo 500 caracteres.' };

/** Cada carácter del conjunto de espacios que recorta `trim()` (la spec los enumera). */
const TRIM_SPACES = [
  '\u0009',
  '\u000a',
  '\u000b',
  '\u000c',
  '\u000d',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  '　',
  '﻿',
];

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
  text: string;
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
  return {
    status: response.status,
    headers: response.headers,
    json: JSON.parse(response.body) as unknown,
    text: response.body,
  };
}

function post(payload: unknown, path = '/api/tasks'): Promise<Reply> {
  return send('POST', path, JSON.stringify(payload));
}

function detailsOf(reply: Reply): unknown {
  return (reply.json as { error: { details: unknown } }).error.details;
}

async function storedTasks(): Promise<{ title: string; description: string }[]> {
  const result = await owner.query<{ title: string; description: string }>(
    'SELECT title, description FROM tasks ORDER BY "createdAt"',
  );
  return result.rows;
}

describe('RF-C11: crear tarea', () => {
  it('RF-C11: POST válido responde 201 con exactamente id, title, description, completed y createdAt', async () => {
    const reply = await post({ title: 'Comprar pan', description: 'Integral' });

    expect(reply.status).toBe(201);
    expect(reply.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(Object.keys(reply.json as object)).toEqual(FIVE_FIELDS);
    expect(reply.json).toEqual({
      id: expect.stringMatching(UUID_PATTERN) as string,
      title: 'Comprar pan',
      description: 'Integral',
      completed: false,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) as string,
    });
    expect(await storedTasks()).toEqual([{ title: 'Comprar pan', description: 'Integral' }]);
  });

  it('RF-C11: se permiten títulos duplicados', async () => {
    const first = await post({ title: 'Repetida' });
    const second = await post({ title: 'Repetida' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((first.json as { id: string }).id).not.toBe((second.json as { id: string }).id);
    expect(await storedTasks()).toHaveLength(2);
  });

  it.each([['{}'], ['{"description":"x"}'], ['{"title":null}']])('RF-C11: %s da 400 con field title', async (body) => {
    const reply = await send('POST', '/api/tasks', body);

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([TITLE_TYPE_DETAIL]);
  });

  it('RF-C11: description: null en POST da 400 description', async () => {
    const reply = await post({ title: 'a', description: null });

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([DESCRIPTION_TYPE_DETAIL]);
    expect(await storedTasks()).toEqual([]);
  });

  it('RF-C11: description omitida vale cadena vacía', async () => {
    const reply = await post({ title: 'sin descripción' });

    expect(reply.status).toBe(201);
    expect((reply.json as { description: string }).description).toBe('');
    expect(await storedTasks()).toEqual([{ title: 'sin descripción', description: '' }]);
  });
});

describe('RF-C9: recorte y límites de title y description', () => {
  it('RF-C9: title y description se guardan recortados', async () => {
    const reply = await post({ title: '  \t Comprar pan 　', description: '  Integral \n' });

    expect(reply.status).toBe(201);
    expect(reply.json).toMatchObject({ title: 'Comprar pan', description: 'Integral' });
    expect(await storedTasks()).toEqual([{ title: 'Comprar pan', description: 'Integral' }]);
  });

  it.each(TRIM_SPACES.map((space) => [JSON.stringify(space), space] as const))(
    'RF-C9: un título de solo el espacio %s da 400 title (1 a 100 caracteres)',
    async (_label, space) => {
      const reply = await post({ title: space.repeat(3) });

      expect(reply.status).toBe(400);
      expect(detailsOf(reply)).toEqual([TITLE_LENGTH_DETAIL]);
    },
  );

  it('RF-C9: un título con NUL y uno con sustituto suelto dan 400 title', async () => {
    const withNul = await send('POST', '/api/tasks', '{"title":"a\\u0000b"}');
    const withSurrogate = await send('POST', '/api/tasks', '{"title":"\\ud800"}');

    expect(withNul.status).toBe(400);
    expect(detailsOf(withNul)).toEqual([TITLE_CHARS_DETAIL]);
    expect(withSurrogate.status).toBe(400);
    expect(detailsOf(withSurrogate)).toEqual([TITLE_CHARS_DETAIL]);
    expect(await storedTasks()).toEqual([]);
  });

  it('RF-C9: un título de 100 caracteres se acepta y uno de 101 da 400 title', async () => {
    expect((await post({ title: 'a'.repeat(100) })).status).toBe(201);

    const reply = await post({ title: 'a'.repeat(101) });

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([TITLE_LENGTH_DETAIL]);
  });

  it('RF-C9: una description de 500 caracteres se acepta y una de 501 da 400 description', async () => {
    expect((await post({ title: 'a', description: 'b'.repeat(500) })).status).toBe(201);

    const reply = await post({ title: 'a', description: 'b'.repeat(501) });

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([DESCRIPTION_LENGTH_DETAIL]);
  });

  it('RF-C9: un título de solo U+200B se acepta (201)', async () => {
    const reply = await post({ title: '​' });

    expect(reply.status).toBe(201);
    expect(await storedTasks()).toEqual([{ title: '​', description: '' }]);
  });
});

describe('RF-C8: tipos de title y description', () => {
  it.each([[5], [true], [[]], [{}], [null]])('RF-C8: title %j que no es cadena da 400 title', async (title) => {
    const reply = await post({ title });

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([TITLE_TYPE_DETAIL]);
  });

  it.each([[5], [false], [['x']], [{ a: 1 }], [null]])(
    'RF-C8: description %j que no es cadena da 400 description',
    async (description) => {
      const reply = await post({ title: 'a', description });

      expect(reply.status).toBe(400);
      expect(detailsOf(reply)).toEqual([DESCRIPTION_TYPE_DETAIL]);
    },
  );
});

describe('RF-C7: campos desconocidos', () => {
  it.each([['{"__proto__":{}}'], ['{"constructor":1}'], ['{"id":"x"}'], ['{"createdAt":"x"}'], ['{"completed":true}']])(
    'RF-C7: %s en POST con title válido da 400 body sin nombres de campos',
    async (extra) => {
      const body = `{"title":"a",${extra.slice(1)}`;
      const reply = await send('POST', '/api/tasks', body);

      expect(reply.status).toBe(400);
      expect(detailsOf(reply)).toEqual([UNKNOWN_DETAIL]);
      for (const name of ['__proto__', 'constructor', 'createdAt', 'completed']) {
        expect(reply.text).not.toContain(name);
      }
      expect(await storedTasks()).toEqual([]);
    },
  );

  it.each([['{"__proto__":{}}'], ['{"constructor":1}'], ['{"id":"x"}'], ['{"createdAt":"x"}'], ['{"completed":true}']])(
    'RF-C7: %s solo (sin title) da body y title, en ese orden',
    async (body) => {
      const reply = await send('POST', '/api/tasks', body);

      expect(reply.status).toBe(400);
      expect(detailsOf(reply)).toEqual([UNKNOWN_DETAIL, TITLE_TYPE_DETAIL]);
    },
  );
});

describe('RF-C10: consulta en POST', () => {
  it.each(['completed=true', 'x=1', '__proto__=x'])(
    'RF-C10: POST /api/tasks?%s da 400 con field query',
    async (query) => {
      const reply = await post({ title: 'a' }, `/api/tasks?${query}`);

      expect(reply.status).toBe(400);
      expect(detailsOf(reply)).toEqual([QUERY_DETAIL]);
      expect(await storedTasks()).toEqual([]);
    },
  );

  it('RF-C10: POST /api/tasks? y POST /api/tasks?&& equivalen a sin consulta', async () => {
    expect((await post({ title: 'a' }, '/api/tasks?')).status).toBe(201);
    expect((await post({ title: 'b' }, '/api/tasks?&&')).status).toBe(201);
  });
});

describe('RF-C5: cuerpo por la ruta real', () => {
  it('RF-C5: claves repetidas (gana la última) llegan y se guardan', async () => {
    const reply = await send('POST', '/api/tasks', '{"title":"a","title":"b"}');

    expect(reply.status).toBe(201);
    expect(await storedTasks()).toEqual([{ title: 'b', description: '' }]);
  });

  it('RF-C5: U+FFFD legítimo en un título llega intacto y se guarda', async () => {
    const reply = await send('POST', '/api/tasks', Buffer.from('{"title":"a\u{fffd}b"}', 'utf8'));

    expect(reply.status).toBe(201);
    expect(await storedTasks()).toEqual([{ title: 'a\u{fffd}b', description: '' }]);
  });

  it.each<[string, Buffer]>([
    ['FF FE', Buffer.from([0xff, 0xfe])],
    ['C3 truncado', Buffer.from([0xc3])],
    ['ED A0 80', Buffer.from([0xed, 0xa0, 0x80])],
    ['BOM y objeto', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"title":"a"}')])],
    ['JSON roto', Buffer.from('{"title":')],
    ['arreglo', Buffer.from('[]')],
    ['null', Buffer.from('null')],
    ['cadena', Buffer.from('"x"')],
    ['número', Buffer.from('5')],
    ['solo espacios', Buffer.from('   ')],
  ])('RF-C5: el cuerpo %s da 400 body', async (_label, bytes) => {
    const reply = await send('POST', '/api/tasks', bytes);

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([BODY_DETAIL]);
  });

  it('RF-C5: un cuerpo vacío (Content-Length 0) da 400 body', async () => {
    const reply = await send('POST', '/api/tasks', '');

    expect(reply.status).toBe(400);
    expect(detailsOf(reply)).toEqual([BODY_DETAIL]);
  });
});

describe('RF-C4: codificación y tipo por la ruta real', () => {
  it('RF-C4: Content-Encoding Identity se acepta', async () => {
    const reply = await send('POST', '/api/tasks', '{"title":"a"}', [JSON_TYPE, 'Content-Encoding: Identity']);

    expect(reply.status).toBe(201);
  });

  it('RF-C4: application/json; charset=utf8 da 415', async () => {
    const reply = await send('POST', '/api/tasks', '{"title":"a"}', ['Content-Type: application/json; charset=utf8']);

    expect(reply.status).toBe(415);
  });
});

describe('RF-C3: límite de tamaño', () => {
  function padded(bytes: number): string {
    const base = '{"title":"a"}';
    return base + ' '.repeat(bytes - base.length);
  }

  it('RF-C3: 10 240 bytes válidos (con espacios de relleno) dan 201 y 10 241 dan 413', async () => {
    const accepted = await send('POST', '/api/tasks', padded(10240));
    const rejected = await send('POST', '/api/tasks', padded(10241));

    expect(accepted.status).toBe(201);
    expect(rejected.status).toBe(413);
  });
});

describe('RF-C21: inyección SQL por la API', () => {
  it("RF-C21: POST con título '); DROP TABLE tasks;-- da 201, se guarda literal y la tabla sigue intacta", async () => {
    const hostile = "'); DROP TABLE tasks;--";

    const reply = await post({ title: hostile, description: "x'; DELETE FROM tasks;--" });

    expect(reply.status).toBe(201);
    expect(await storedTasks()).toEqual([{ title: hostile, description: "x'; DELETE FROM tasks;--" }]);
    const table = await owner.query(`SELECT to_regclass('public.tasks') IS NOT NULL AS found`);
    expect((table.rows[0] as { found: boolean }).found).toBe(true);
  });
});

describe('RF-C22: métodos en /api/tasks', () => {
  it.each(['OPTIONS', 'PUT', 'DELETE', 'PATCH', 'PROPFIND'])(
    'RF-C22: %s en /api/tasks da 405 con Allow: GET, POST',
    async (method) => {
      const reply = await send(method, '/api/tasks', '');

      expect(reply.status).toBe(405);
      expect(reply.headers['allow']).toBe('GET, POST');
      expect(reply.json).toEqual({
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido.', details: [] },
      });
    },
  );

  it('RF-C22: HEAD en /api/tasks da 405 con Allow: GET, POST', async () => {
    const result = await rawRequest(loopback.port, [
      'HEAD /api/tasks HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n',
    ]);

    expect(result.text.startsWith('HTTP/1.1 405')).toBe(true);
    expect(result.text.toLowerCase()).toContain('allow: get, post');
  });
});

describe('RF-C23: forma de details y secreto de las respuestas', () => {
  it('RF-C23: POST /api/tasks?x=1 con {"foo":1,"title":"","description":5} da los cuatro details', async () => {
    const reply = await send('POST', '/api/tasks?x=1', '{"foo":1,"title":"","description":5}');

    expect(reply.status).toBe(400);
    expect(reply.json).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Datos inválidos.',
        details: [UNKNOWN_DETAIL, QUERY_DETAIL, TITLE_LENGTH_DETAIL, DESCRIPTION_TYPE_DETAIL],
      },
    });
    expect(reply.text).toBe(
      '{"error":{"code":"VALIDATION_ERROR","message":"Datos inválidos.","details":[' +
        '{"field":"body","message":"El cuerpo contiene campos no permitidos."},' +
        '{"field":"query","message":"Parámetros de consulta no permitidos."},' +
        '{"field":"title","message":"Debe tener entre 1 y 100 caracteres."},' +
        '{"field":"description","message":"Debe ser una cadena de texto."}]}}',
    );
  });

  it('RF-C23: ninguna respuesta de error contiene SQL, traza, ruta interna ni el valor enviado', async () => {
    const secret = 'valor-secreto-123';
    const replies = [
      await send('POST', '/api/tasks', `{"title":"${secret.repeat(10)}","${secret}":1}`),
      await send('POST', `/api/tasks?${secret}=1`, `{"title":5,"description":"${'x'.repeat(600)}"}`),
      await send('POST', '/api/tasks', `{"title":"${secret}`),
      await send('POST', '/api/tasks', '{"title":"a"}', ['Content-Type: text/plain']),
      await send('PATCH', '/api/tasks', ''),
    ];

    for (const reply of replies) {
      expect(reply.status).toBeGreaterThanOrEqual(400);
      expect(reply.text).not.toContain(secret);
      expect(reply.text).not.toMatch(/SELECT|INSERT|tasks|\bat\b.*\.ts|node_modules|\\|src\/|stack/i);
    }
  });
});
