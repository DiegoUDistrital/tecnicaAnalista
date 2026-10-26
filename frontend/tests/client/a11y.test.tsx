// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskManager } from '../../src/client/task-manager';
import { HomeView } from '../../src/components/home-view';
import type { Task } from '../../src/lib/task';
import '../helpers/dom-cleanup';
import { installFakeApi, jsonResponse, makeTask, type FakeApi } from '../helpers/fake-api';
import { refresh } from '../helpers/router-mock';

vi.mock('next/navigation', async () => (await import('../helpers/router-mock')).navigationMock);

beforeEach(() => {
  refresh.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const LOADING = 'Cargando tareas…';
const GONE = 'La tarea ya no existe.';

async function setup(tasks: Task[], ui: 'manager' | 'page' = 'manager') {
  const api = installFakeApi();
  render(
    ui === 'page' ? (
      <HomeView filter="all" counters={{ available: true, all: tasks.length, completed: 0, pending: tasks.length }} />
    ) : (
      <TaskManager filter="all" total={null} />
    ),
  );
  act(() => api.calls[0]?.resolve(jsonResponse(200, tasks)));
  await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe(LOADING));
  return api;
}

const lists = (api: FakeApi) => api.calls.filter((call) => call.method === 'GET');
const writes = (api: FakeApi, method: string) => api.calls.filter((call) => call.method === method);
const toggleButton = (title: string) => screen.getByRole('button', { name: `Marcar «${title}» como completada` });
const editButton = (title: string) => screen.getByRole('button', { name: `Editar «${title}»` });
const deleteButton = (title: string) => screen.getByRole('button', { name: `Eliminar «${title}»` });
const notFound = () => jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'No encontrada.' } });
const serverFailure = () => jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Error interno.' } });

async function answer(call: FakeApi['calls'][number] | undefined, response: Response) {
  await act(async () => {
    call?.resolve(response);
    await Promise.resolve();
  });
}

describe('Accesibilidad del cliente', () => {
  it('RF-F27: cada control se encuentra por rol y nombre accesible que incluye el título', async () => {
    await setup([makeTask(1), makeTask(2)]);
    expect(screen.getByRole('form', { name: 'Nueva tarea' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Crear tarea' })).toBeTruthy();
    for (const title of ['Tarea 1', 'Tarea 2']) {
      expect(toggleButton(title).getAttribute('aria-pressed')).toBe('false');
      expect(editButton(title)).toBeTruthy();
      expect(deleteButton(title)).toBeTruthy();
    }
    fireEvent.click(editButton('Tarea 1'));
    const form = within(screen.getByRole('form', { name: 'Editar «Tarea 1»' }));
    expect(form.getByLabelText('Título')).toBeTruthy();
    expect(form.getByLabelText('Descripción')).toBeTruthy();
    expect(form.getByRole('button', { name: 'Guardar' })).toBeTruthy();
    expect(form.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
  });

  it('RF-F27: la región role="status" aria-live="polite" existe siempre y anuncia carga, «Tarea creada.», «La tarea ya no existe.» y «Lista actualizada.»', async () => {
    const api = installFakeApi();
    render(<TaskManager filter="all" total={null} />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe(LOADING);
    act(() => api.calls[0]?.resolve(jsonResponse(200, [makeTask(1), makeTask(2)])));
    await waitFor(() => expect(region.textContent).toBe(''));
    expect(screen.getByRole('status')).toBe(region);

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Nueva' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));
    await answer(writes(api, 'POST')[0], jsonResponse(201, makeTask(3)));
    expect(region.textContent).toBe('Tarea creada.');

    fireEvent.click(deleteButton('Tarea 1'));
    await answer(writes(api, 'DELETE')[0], new Response(null, { status: 204 }));
    expect(region.textContent).toBe('Lista actualizada.');

    fireEvent.click(deleteButton('Tarea 2'));
    await answer(writes(api, 'DELETE')[1], notFound());
    expect(region.textContent).toBe(GONE);
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('RF-F26: tarjeta y controles (también Reintentar) llevan las clases de ancho, desbordamiento y 44 px', async () => {
    await setup([makeTask(1, { title: 'x'.repeat(100), description: 'a\nb' })], 'page');
    const card = screen.getByRole('article');
    expect(card.classList).toContain('wrap-anywhere');
    expect(card.classList).toContain('min-w-0');
    expect(screen.getByText('a\nb', { normalizer: (text) => text }).classList).toContain('whitespace-pre-wrap');
    expect(screen.getByRole('navigation', { name: 'Filtros' }).classList).toContain('flex-wrap');
    fireEvent.click(editButton('x'.repeat(100)));
    const controls = [
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('link'),
      ...screen.getAllByRole('textbox'),
    ];
    expect(controls.length).toBeGreaterThanOrEqual(9);
    for (const control of controls) {
      expect(control.classList, control.outerHTML).toContain('min-h-11');
    }
    for (const button of screen.getAllByRole('button')) {
      expect(button.classList, button.outerHTML).toContain('min-w-11');
    }
    cleanup();
    const failing = installFakeApi();
    render(<TaskManager filter="all" total={null} />);
    act(() => failing.calls[0]?.resolve(serverFailure()));
    const retry = await screen.findByRole('button', { name: 'Reintentar' });
    expect(retry.classList).toContain('min-h-11');
    expect(retry.classList).toContain('min-w-11');
  });
});

type Outcome = 'ok' | 'not_found' | 'error';

/** Acciones de escritura de la tabla de repaso: cada una devuelve la petición de escritura que provoca. */
const ACTIONS: { name: string; method: string; run: () => void }[] = [
  {
    name: 'crear',
    method: 'POST',
    run: () => {
      fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Nueva' } });
      fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));
    },
  },
  { name: 'completar (PUT)', method: 'PUT', run: () => fireEvent.click(toggleButton('Tarea 1')) },
  { name: 'borrar (DELETE)', method: 'DELETE', run: () => fireEvent.click(deleteButton('Tarea 1')) },
  {
    name: 'guardar edición (PUT)',
    method: 'PUT',
    run: () => {
      fireEvent.click(editButton('Tarea 1'));
      const form = within(screen.getByRole('form', { name: 'Editar «Tarea 1»' }));
      fireEvent.change(form.getByLabelText('Título'), { target: { value: 'Cambiada' } });
      fireEvent.click(form.getByRole('button', { name: 'Guardar' }));
    },
  },
];

function responseFor(method: string, outcome: Outcome): Response {
  if (outcome === 'not_found') {
    return notFound();
  }
  if (outcome === 'error') {
    return serverFailure();
  }
  if (method === 'POST') {
    return jsonResponse(201, makeTask(9));
  }
  return method === 'DELETE' ? new Response(null, { status: 204 }) : jsonResponse(200, makeTask(1));
}

describe('Repaso del refresco tras cada escritura', () => {
  const rows = ACTIONS.flatMap((action) =>
    (['ok', 'not_found', 'error'] as Outcome[])
      // Crear no tiene 404 (POST no puede dar not_found).
      .filter((outcome) => !(action.method === 'POST' && outcome === 'not_found'))
      .map((outcome) => ({ action, outcome, expected: outcome === 'error' ? 0 : 1 })),
  );

  it.each(rows)(
    'RF-F15: $action.name con $outcome -> $expected lectura(es) de lista nueva(s) y $expected router.refresh',
    async ({ action, outcome, expected }) => {
      const api = await setup([makeTask(1)]);
      action.run();
      await answer(writes(api, action.method)[0], responseFor(action.method, outcome));
      await waitFor(() => expect(lists(api)).toHaveLength(1 + expected));
      expect(refresh).toHaveBeenCalledTimes(expected);
      expect(writes(api, action.method)).toHaveLength(1);
    },
  );
});
