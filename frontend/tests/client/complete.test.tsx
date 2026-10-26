// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskManager } from '../../src/client/task-manager';
import { NO_CONNECTION_MESSAGE } from '../../src/lib/api-error';
import type { Task } from '../../src/lib/task';
import type { TaskFilter } from '../../src/lib/task-filter';
import '../helpers/dom-cleanup';
import { installFakeApi, jsonResponse, makeTask, type FakeApi } from '../helpers/fake-api';
import { openPanel } from '../helpers/open-panel';
import { refresh } from '../helpers/router-mock';

vi.mock('next/navigation', async () => (await import('../helpers/router-mock')).navigationMock);

beforeEach(() => {
  refresh.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const LOADING = 'Cargando tareas…';

async function setup(tasks: Task[], filter: TaskFilter = 'all') {
  const api = installFakeApi();
  render(<TaskManager filter={filter} total={null} />);
  act(() => api.calls[0]?.resolve(jsonResponse(200, tasks)));
  await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe(LOADING));
  return api;
}

const toggleButton = (title: string) => screen.getByRole('button', { name: `Marcar «${title}» como completada` });
const puts = (api: FakeApi) => api.calls.filter((call) => call.method === 'PUT');
const lists = (api: FakeApi) => api.calls.filter((call) => call.method === 'GET');
const cardOf = (title: string) => within(screen.getByRole('heading', { name: title }).closest('article')!);

/** Responde la llamada indicada y deja que React termine de pintar. */
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

/** Completa la tarea: pulsa, responde el PUT con éxito y entrega la lista nueva que pide el refresco. */
async function toggleAndRefresh(api: FakeApi, title: string, after: Task[]) {
  const listsBefore = lists(api).length;
  fireEvent.click(toggleButton(title));
  await answer(puts(api).at(-1), jsonResponse(200, {}));
  await waitFor(() => expect(lists(api)).toHaveLength(listsBefore + 1));
  await answer(lists(api).at(-1), jsonResponse(200, after));
}

describe('Completar y desmarcar', () => {
  it('RF-F11: PUT con cuerpo exacto {"completed":true} y de vuelta {"completed":false}; el estado cambia cuando llega el refresco (no antes)', async () => {
    const task = makeTask(1);
    const api = await setup([task]);
    fireEvent.click(toggleButton('Tarea 1'));
    expect(puts(api)).toHaveLength(1);
    expect(puts(api)[0]?.url).toBe(`/api/tasks/${task.id}`);
    expect(puts(api)[0]?.body).toEqual({ completed: true });
    await answer(puts(api)[0], jsonResponse(200, { ...task, completed: true }));
    await waitFor(() => expect(lists(api)).toHaveLength(2));
    expect(screen.getByText('Pendiente')).toBeTruthy();
    expect(toggleButton('Tarea 1').getAttribute('aria-pressed')).toBe('false');
    await answer(lists(api)[1], jsonResponse(200, [{ ...task, completed: true }]));
    expect(screen.getByText('Completada')).toBeTruthy();
    expect(toggleButton('Tarea 1').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggleButton('Tarea 1'));
    expect(puts(api)).toHaveLength(2);
    expect(puts(api)[1]?.body).toEqual({ completed: false });
  });

  it('RF-F11: bajo Pendientes la tarea desaparece tras el refresco', async () => {
    const api = await setup([makeTask(1), makeTask(2)], 'pending');
    await toggleAndRefresh(api, 'Tarea 1', [makeTask(2)]);
    expect(screen.queryByText('Tarea 1')).toBeNull();
    expect(screen.getByText('Tarea 2')).toBeTruthy();
    expect(lists(api)[1]?.url).toBe('/api/tasks?filter=pending');
  });

  it('RF-F11: bajo Completadas la tarea desmarcada desaparece tras el refresco', async () => {
    const api = await setup([makeTask(3, { completed: true })], 'completed');
    await toggleAndRefresh(api, 'Tarea 3', []);
    expect(screen.getByText('No hay tareas completadas.')).toBeTruthy();
    expect(puts(api)[0]?.body).toEqual({ completed: false });
  });

  it('RF-F11: el foco se queda en el botón si la tarea sigue', async () => {
    const task = makeTask(1);
    const api = await setup([task]);
    toggleButton('Tarea 1').focus();
    fireEvent.click(toggleButton('Tarea 1'));
    expect(document.activeElement).toBe(toggleButton('Tarea 1'));
    await answer(puts(api)[0], jsonResponse(200, {}));
    await waitFor(() => expect(lists(api)).toHaveLength(2));
    await answer(lists(api)[1], jsonResponse(200, [{ ...task, completed: true }]));
    await waitFor(() => expect(document.activeElement).toBe(toggleButton('Tarea 1')));
  });

  it.each([
    ['la siguiente', 'Tarea 2', ['Tarea 1', 'Tarea 3'], 'Tarea 3'],
    ['la anterior si era la última', 'Tarea 3', ['Tarea 1', 'Tarea 2'], 'Tarea 2'],
    ['la anterior si la siguiente también desaparece', 'Tarea 2', ['Tarea 1'], 'Tarea 1'],
  ])('RF-F11: el foco pasa al botón de %s', async (_name, toggled, remaining, expected) => {
    const all = [makeTask(1), makeTask(2), makeTask(3)];
    const api = await setup(all, 'pending');
    toggleButton(toggled).focus();
    await toggleAndRefresh(
      api,
      toggled,
      all.filter((task) => remaining.includes(task.title)),
    );
    await waitFor(() => expect(document.activeElement).toBe(toggleButton(expected)));
  });

  it('RF-F11: no se roba el foco si la persona ya estaba en otro campo (P7)', async () => {
    const api = await setup([makeTask(1), makeTask(2)], 'pending');
    toggleButton('Tarea 1').focus();
    fireEvent.click(toggleButton('Tarea 1'));
    openPanel();
    const title = screen.getByLabelText<HTMLInputElement>('Título');
    title.focus();
    await answer(puts(api)[0], jsonResponse(200, {}));
    await waitFor(() => expect(lists(api)).toHaveLength(2));
    await answer(lists(api)[1], jsonResponse(200, [makeTask(2)]));
    await waitFor(() => expect(screen.queryByText('Tarea 1')).toBeNull());
    expect(document.activeElement).toBe(title);
  });

  it('RF-F14: dos clics en la misma actuación hacen una sola llamada; tareas distintas pueden tener peticiones a la vez', async () => {
    const api = await setup([makeTask(1), makeTask(2)]);
    act(() => {
      fireEvent.click(toggleButton('Tarea 1'));
      fireEvent.click(toggleButton('Tarea 1'));
    });
    expect(puts(api)).toHaveLength(1);
    expect(toggleButton('Tarea 1').getAttribute('aria-disabled')).toBe('true');
    expect(toggleButton('Tarea 2').getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(toggleButton('Tarea 2'));
    expect(puts(api)).toHaveLength(2);
  });

  it.each([
    ['red', new TypeError('Failed to fetch'), NO_CONNECTION_MESSAGE],
    ['500', jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Error interno.' } }), 'Error interno.'],
    [
      '429 con su tiempo de espera',
      jsonResponse(429, {
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Demasiadas peticiones. Espera 30 segundos e inténtalo de nuevo.',
        },
      }),
      'Demasiadas peticiones. Espera 30 segundos e inténtalo de nuevo.',
    ],
    [
      '400',
      jsonResponse(400, { error: { code: 'VALIDATION_ERROR', message: 'Datos inválidos.' } }),
      'Datos inválidos.',
    ],
  ])(
    'RF-F25: %s muestra role="alert" junto a esa tarea, la tarea queda como estaba, los controles se reactivan y no se refresca',
    async (_name, failure, expected) => {
      const api = await setup([makeTask(1), makeTask(2)]);
      fireEvent.click(toggleButton('Tarea 1'));
      await answer(puts(api)[0], failure);
      expect((await cardOf('Tarea 1').findByRole('alert')).textContent).toBe(expected);
      expect(cardOf('Tarea 2').queryByRole('alert')).toBeNull();
      expect(cardOf('Tarea 1').getByText('Pendiente')).toBeTruthy();
      expect(toggleButton('Tarea 1').getAttribute('aria-disabled')).toBe('false');
      expect(lists(api)).toHaveLength(1);
      expect(refresh).not.toHaveBeenCalled();
      fireEvent.click(toggleButton('Tarea 1'));
      expect(puts(api)).toHaveLength(2);
    },
  );

  it('RF-F25: el error desaparece al iniciar otra acción sobre la misma tarea', async () => {
    const api = await setup([makeTask(1)]);
    fireEvent.click(toggleButton('Tarea 1'));
    await answer(puts(api)[0], new TypeError('Failed to fetch'));
    await cardOf('Tarea 1').findByRole('alert');
    fireEvent.click(toggleButton('Tarea 1'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(puts(api)).toHaveLength(2);
  });

  it('RF-F27: «Lista actualizada.» se limpia al iniciar la siguiente acción', async () => {
    const api = await setup([makeTask(1), makeTask(2)]);
    await toggleAndRefresh(api, 'Tarea 1', [makeTask(1), makeTask(2)]);
    expect(screen.getByRole('status').textContent).toContain('Lista actualizada.');
    fireEvent.click(toggleButton('Tarea 2'));
    await waitFor(() => expect(screen.getByRole('status').textContent).not.toContain('Lista actualizada.'));
  });
});
