// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTask, deleteTask, fetchTasks, updateTask } from '../../src/client/tasks-api';
import { NO_CONNECTION_MESSAGE, POST_UNCONFIRMED_MESSAGE } from '../../src/lib/api-error';
import { installFakeApi, jsonResponse, makeTask } from '../helpers/fake-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

describe('fetchTasks', () => {
  it('RF-F6: GET /api/tasks sin filtro, con ?filter=completed y con ?filter=pending (nunca filter=all)', async () => {
    const api = installFakeApi();
    for (const filter of ['all', 'completed', 'pending'] as const) {
      const pending = fetchTasks(filter);
      api.calls.at(-1)?.resolve(jsonResponse(200, []));
      await pending;
    }
    expect(api.calls.map((call) => [call.method, call.url])).toEqual([
      ['GET', '/api/tasks'],
      ['GET', '/api/tasks?filter=completed'],
      ['GET', '/api/tasks?filter=pending'],
    ]);
  });

  it('RF-F6: 200 con arreglo de tareas válido da ok', async () => {
    const api = installFakeApi();
    const tasks = [makeTask(1), makeTask(2, { completed: true })];
    const pending = fetchTasks('all');
    api.calls[0]?.resolve(jsonResponse(200, tasks));
    expect(await pending).toEqual({ kind: 'ok', tasks });
  });

  it('RF-F6: 200 con JSON roto, con objeto en lugar de arreglo o con una tarea mal formada da el mensaje propio', async () => {
    const api = installFakeApi();
    const bodies = [
      new Response('no es json', { status: 200 }),
      jsonResponse(200, { tasks: [] }),
      jsonResponse(200, [{ id: 1 }]),
    ];
    for (const response of bodies) {
      const pending = fetchTasks('all');
      api.calls.at(-1)?.resolve(response);
      expect(await pending).toEqual({ kind: 'error', message: NO_CONNECTION_MESSAGE });
    }
  });

  it('RF-F6: fetch que rechaza da el mensaje propio; AbortError da aborted', async () => {
    const api = installFakeApi();
    const failed = fetchTasks('all');
    api.calls[0]?.reject(new TypeError('Failed to fetch'));
    expect(await failed).toEqual({ kind: 'error', message: NO_CONNECTION_MESSAGE });

    const controller = new AbortController();
    const aborted = fetchTasks('all', controller.signal);
    controller.abort();
    expect(await aborted).toEqual({ kind: 'aborted' });
  });

  it('RF-F6: 500 con code INTERNAL_ERROR y message válido muestra ese message; con HTML o code ajeno usa el propio', async () => {
    const api = installFakeApi();
    const cases: [Response, string][] = [
      [jsonResponse(500, errorBody('INTERNAL_ERROR', 'Error interno.')), 'Error interno.'],
      [new Response('<html>Bad gateway</html>', { status: 500 }), NO_CONNECTION_MESSAGE],
      [jsonResponse(500, errorBody('OTHER', 'Texto ajeno.')), NO_CONNECTION_MESSAGE],
    ];
    for (const [response, expected] of cases) {
      const pending = fetchTasks('all');
      api.calls.at(-1)?.resolve(response);
      expect(await pending).toEqual({ kind: 'error', message: expected });
    }
  });

  it('RF-F25: 429 con el message del servidor (segundos, minutos y frase de reserva) se muestra tal cual', async () => {
    const api = installFakeApi();
    const messages = [
      'Demasiadas peticiones. Espera 30 segundos e inténtalo de nuevo.',
      'Demasiadas peticiones. Espera 60 minutos e inténtalo de nuevo.',
      'Demasiadas peticiones. Inténtalo de nuevo en unos minutos.',
    ];
    for (const message of messages) {
      const pending = fetchTasks('all');
      api.calls.at(-1)?.resolve(jsonResponse(429, errorBody('TOO_MANY_REQUESTS', message)));
      expect(await pending).toEqual({ kind: 'error', message });
    }
  });

  it('RF-F13: 404 en GET da error (no not_found)', async () => {
    const api = installFakeApi();
    const pending = fetchTasks('all');
    api.calls[0]?.resolve(jsonResponse(404, errorBody('NOT_FOUND', 'No encontrado.')));
    expect(await pending).toEqual({ kind: 'error', message: 'No encontrado.' });
  });
});

describe('createTask, updateTask y deleteTask', () => {
  it('RF-F9: POST envía el cuerpo JSON a /api/tasks y solo es ok con 201 exacto', async () => {
    const api = installFakeApi();
    const created = createTask({ title: 'A', description: 'B' });
    api.calls[0]?.resolve(jsonResponse(201, makeTask(1)));
    expect(await created).toEqual({ kind: 'ok' });
    expect(api.calls[0]).toMatchObject({ method: 'POST', url: '/api/tasks', body: { title: 'A', description: 'B' } });

    const wrongStatus = createTask({ title: 'A', description: '' });
    api.calls[1]?.resolve(jsonResponse(200, makeTask(1)));
    expect((await wrongStatus).kind).toBe('error');
  });

  it('RF-F9: POST/PUT/DELETE solo son ok con 201/200/204 exactos', async () => {
    const api = installFakeApi();
    const id = makeTask(1).id;
    const cases: [() => ReturnType<typeof updateTask>, number, string][] = [
      [() => updateTask(id, { completed: true }), 200, 'ok'],
      [() => updateTask(id, { completed: true }), 204, 'error'],
      [() => updateTask(id, { completed: true }), 201, 'error'],
      [() => deleteTask(id), 204, 'ok'],
      [() => deleteTask(id), 200, 'error'],
    ];
    for (const [call, status, kind] of cases) {
      const pending = call();
      api.calls.at(-1)?.resolve(status === 204 ? new Response(null, { status }) : jsonResponse(status, {}));
      expect((await pending).kind).toBe(kind);
    }
    expect(api.calls.slice(0, 3).map((call) => [call.method, call.url, call.body])).toEqual([
      ['PUT', `/api/tasks/${id}`, { completed: true }],
      ['PUT', `/api/tasks/${id}`, { completed: true }],
      ['PUT', `/api/tasks/${id}`, { completed: true }],
    ]);
    expect(api.calls[3]).toMatchObject({ method: 'DELETE', url: `/api/tasks/${id}`, body: undefined });
  });

  it('RF-F9: POST con 502 o 504 muestra el message del servidor y sin él el propio de POST', async () => {
    const api = installFakeApi();
    const cases: [Response, string][] = [
      [jsonResponse(502, errorBody('BAD_GATEWAY', 'No se pudo confirmar.')), 'No se pudo confirmar.'],
      [jsonResponse(504, errorBody('GATEWAY_TIMEOUT', 'Tiempo agotado.')), 'Tiempo agotado.'],
      [new Response('<html>502</html>', { status: 502 }), POST_UNCONFIRMED_MESSAGE],
    ];
    for (const [response, expected] of cases) {
      const pending = createTask({ title: 'A', description: '' });
      api.calls.at(-1)?.resolve(response);
      expect(await pending).toEqual({ kind: 'error', message: expected });
    }
    const network = createTask({ title: 'A', description: '' });
    api.calls.at(-1)?.reject(new TypeError('Failed to fetch'));
    expect(await network).toEqual({ kind: 'error', message: POST_UNCONFIRMED_MESSAGE });
  });

  it('RF-F13: 404 en PUT/DELETE con code NOT_FOUND da not_found; 404 HTML da error genérico', async () => {
    const api = installFakeApi();
    const id = makeTask(1).id;
    for (const call of [() => updateTask(id, { completed: true }), () => deleteTask(id)]) {
      const gone = call();
      api.calls.at(-1)?.resolve(jsonResponse(404, errorBody('NOT_FOUND', 'La tarea ya no existe.')));
      expect(await gone).toEqual({ kind: 'not_found' });

      const html = call();
      api.calls.at(-1)?.resolve(new Response('<html>404</html>', { status: 404 }));
      expect(await html).toEqual({ kind: 'error', message: NO_CONNECTION_MESSAGE });
    }
  });

  it('RF-F10: 400 en POST/PUT devuelve details filtrados y el message general', async () => {
    const api = installFakeApi();
    const details = [{ field: 'title', message: 'Debe tener entre 1 y 100 caracteres.' }, { field: 3 }, 'x'];
    const body = errorBody('VALIDATION_ERROR', 'Datos inválidos.', details);
    const expected = {
      kind: 'invalid',
      message: 'Datos inválidos.',
      details: [{ field: 'title', message: 'Debe tener entre 1 y 100 caracteres.' }],
    };
    const created = createTask({ title: '', description: '' });
    api.calls.at(-1)?.resolve(jsonResponse(400, body));
    expect(await created).toEqual(expected);

    const updated = updateTask(makeTask(1).id, { title: '' });
    api.calls.at(-1)?.resolve(jsonResponse(400, body));
    expect(await updated).toEqual(expected);
  });

  it('RF-F10: 400 sin cuerpo reconocible da invalid con el mensaje «Datos inválidos.» y sin details', async () => {
    const api = installFakeApi();
    const pending = createTask({ title: '', description: '' });
    api.calls[0]?.resolve(new Response('<html>400</html>', { status: 400 }));
    expect(await pending).toEqual({ kind: 'invalid', message: 'Datos inválidos.', details: [] });
  });

  it('RF-F25: DELETE con 400 es un error con el message del servidor (no invalid)', async () => {
    const api = installFakeApi();
    const pending = deleteTask(makeTask(1).id);
    api.calls[0]?.resolve(jsonResponse(400, errorBody('BAD_REQUEST', 'Identificador no válido.')));
    expect(await pending).toEqual({ kind: 'error', message: 'Identificador no válido.' });
  });
});
