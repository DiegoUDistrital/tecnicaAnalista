// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { TaskManager } from '../../src/client/task-manager';
import { NO_CONNECTION_MESSAGE } from '../../src/lib/api-error';
import type { Task } from '../../src/lib/task';
import type { TaskFilter } from '../../src/lib/task-filter';
import '../helpers/dom-cleanup';
import { installFakeApi, jsonResponse, makeTask, type FakeApi } from '../helpers/fake-api';
import { refresh } from '../helpers/router-mock';

vi.mock('next/navigation', async () => (await import('../helpers/router-mock')).navigationMock);

let confirmSpy: MockInstance<typeof window.confirm>;

beforeEach(() => {
  refresh.mockReset();
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const LOADING = 'Cargando tareas…';
const GONE = 'La tarea ya no existe.';

async function setup(tasks: Task[], filter: TaskFilter = 'all') {
  const api = installFakeApi();
  render(<TaskManager filter={filter} total={null} />);
  act(() => api.calls[0]?.resolve(jsonResponse(200, tasks)));
  await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe(LOADING));
  return api;
}

const deleteButton = (title: string) => screen.getByRole('button', { name: `Eliminar «${title}»` });
const toggleButton = (title: string) => screen.getByRole('button', { name: `Marcar «${title}» como completada` });
const deletes = (api: FakeApi) => api.calls.filter((call) => call.method === 'DELETE');
const lists = (api: FakeApi) => api.calls.filter((call) => call.method === 'GET');
const cardOf = (title: string) => within(screen.getByRole('heading', { name: title }).closest('article')!);
const noContent = () => new Response(null, { status: 204 });

async function answer(call: FakeApi['calls'][number] | undefined, response: Response | Error) {
  await act(async () => {
    if (response instanceof Response) {
      call?.resolve(response);
    } else {
      call?.reject(response);
    }
    await Promise.resolve();
  });
}

/** Borra la tarea: pulsa, responde el DELETE con 204 y entrega la lista nueva que pide el refresco. */
async function deleteAndRefresh(api: FakeApi, title: string, after: Task[]) {
  const listsBefore = lists(api).length;
  fireEvent.click(deleteButton(title));
  await answer(deletes(api).at(-1), noContent());
  await waitFor(() => expect(lists(api)).toHaveLength(listsBefore + 1));
  await answer(lists(api).at(-1), jsonResponse(200, after));
}

describe('Borrar', () => {
  it('RF-F13: Eliminar pide window.confirm; si se cancela no hay fetch; si se acepta, DELETE a /api/tasks/<id> y refresco', async () => {
    const task = makeTask(1);
    const api = await setup([task, makeTask(2)]);
    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(deleteButton('Tarea 1'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0]?.[0]).toContain('Tarea 1');
    expect(deletes(api)).toHaveLength(0);
    expect(api.calls).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(deleteButton('Tarea 1').getAttribute('aria-disabled')).toBe('false');

    fireEvent.click(deleteButton('Tarea 1'));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(deletes(api)).toHaveLength(1);
    expect(deletes(api)[0]?.url).toBe(`/api/tasks/${task.id}`);
    expect(deletes(api)[0]?.body).toBeUndefined();
    await answer(deletes(api)[0], noContent());
    await waitFor(() => expect(lists(api)).toHaveLength(2));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('RF-F13: 204 refresca lista (una vez) y contadores (router.refresh una vez) y el foco va a la tarjeta siguiente, la anterior o al h2', async () => {
    const all = [makeTask(1), makeTask(2), makeTask(3)];
    const api = await setup(all);
    deleteButton('Tarea 2').focus();
    await deleteAndRefresh(api, 'Tarea 2', [all[0]!, all[2]!]);
    expect(lists(api)).toHaveLength(2);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Tarea 2')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Lista actualizada.');
    await waitFor(() => expect(document.activeElement).toBe(toggleButton('Tarea 3')));

    deleteButton('Tarea 3').focus();
    await deleteAndRefresh(api, 'Tarea 3', [all[0]!]);
    await waitFor(() => expect(document.activeElement).toBe(toggleButton('Tarea 1')));

    deleteButton('Tarea 1').focus();
    await deleteAndRefresh(api, 'Tarea 1', []);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Tareas' })));
  });

  it('RF-F13: 404 con code NOT_FOUND da el aviso global «La tarea ya no existe.», refresca siempre y no deja role="alert" en la tarjeta', async () => {
    const api = await setup([makeTask(1), makeTask(2)]);
    deleteButton('Tarea 1').focus();
    fireEvent.click(deleteButton('Tarea 1'));
    await answer(deletes(api)[0], jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'No encontrada.' } }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(GONE));
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(lists(api)).toHaveLength(2));
    expect(refresh).toHaveBeenCalledTimes(1);
    await answer(lists(api)[1], jsonResponse(200, [makeTask(2)]));
    expect(screen.queryByText('Tarea 1')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(toggleButton('Tarea 2')));
    expect(screen.getByRole('status').textContent).toContain(GONE);
  });

  it.each([
    ['red', new TypeError('Failed to fetch'), NO_CONNECTION_MESSAGE],
    ['500', jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Error interno.' } }), 'Error interno.'],
  ])(
    'RF-F25: %s muestra el alert de la tarjeta, la tarea queda, los controles se reactivan y no se refresca',
    async (_name, failure, expected) => {
      const api = await setup([makeTask(1), makeTask(2)]);
      fireEvent.click(deleteButton('Tarea 1'));
      await answer(deletes(api)[0], failure);
      expect((await cardOf('Tarea 1').findByRole('alert')).textContent).toBe(expected);
      expect(cardOf('Tarea 2').queryByRole('alert')).toBeNull();
      expect(screen.getByText('Tarea 1')).toBeTruthy();
      expect(deleteButton('Tarea 1').getAttribute('aria-disabled')).toBe('false');
      expect(toggleButton('Tarea 1').getAttribute('aria-disabled')).toBe('false');
      expect(lists(api)).toHaveLength(1);
      expect(refresh).not.toHaveBeenCalled();
      fireEvent.click(deleteButton('Tarea 1'));
      expect(deletes(api)).toHaveLength(2);
    },
  );
});
