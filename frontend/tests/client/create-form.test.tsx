// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { TaskManager } from '../../src/client/task-manager';
import { POST_UNCONFIRMED_MESSAGE } from '../../src/lib/api-error';
import type { Task } from '../../src/lib/task';
import type { TaskFilter } from '../../src/lib/task-filter';
import '../helpers/dom-cleanup';
import { installFakeApi, jsonResponse, makeTask, type FakeApi } from '../helpers/fake-api';
import { newTaskButton, openPanel } from '../helpers/open-panel';
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
const TITLE_RULE = 'Debe tener entre 1 y 100 caracteres.';
const DESCRIPTION_RULE = 'Debe tener como máximo 500 caracteres.';

/** Monta el componente y entrega la lista inicial (la lectura del JSON es asíncrona: se espera a que termine). */
async function setup(options: { filter?: TaskFilter; total?: number | null; tasks?: Task[] } = {}) {
  const api = installFakeApi();
  const view = render(<TaskManager filter={options.filter ?? 'all'} total={options.total ?? null} />);
  act(() => api.calls[0]?.resolve(jsonResponse(200, options.tasks ?? [])));
  await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe(LOADING));
  openPanel();
  return { api, ...view };
}

const form = () => screen.getByRole('form', { name: 'Nueva tarea' });
const titleField = () => screen.getByLabelText<HTMLInputElement>('Título');
const descriptionField = () => screen.getByLabelText<HTMLTextAreaElement>('Descripción');
const submitButton = () => screen.getByRole('button', { name: 'Crear tarea' });

function fill(title: string, description = '') {
  fireEvent.change(titleField(), { target: { value: title } });
  fireEvent.change(descriptionField(), { target: { value: description } });
}

const posts = (api: FakeApi) => api.calls.filter((call) => call.method === 'POST');
const lists = (api: FakeApi) => api.calls.filter((call) => call.method === 'GET');

/** Responde el POST pendiente y deja que React termine de pintar. */
async function answerPost(api: FakeApi, response: Response) {
  await act(async () => {
    posts(api)[0]?.resolve(response);
    await Promise.resolve();
  });
}

const serverError = (status: number, code: string, message: string, details?: unknown) =>
  jsonResponse(status, { error: { code, message, ...(details === undefined ? {} : { details }) } });

describe('CreateForm: crear una tarea', () => {
  it('RF-F9: envía título y descripción recortados, cierra el panel, muestra «Tarea creada.», lleva el foco al botón', async () => {
    const { api } = await setup();
    fill('  Comprar pan  ', '\n leche 　');
    fireEvent.click(submitButton());
    expect(posts(api)).toHaveLength(1);
    expect(posts(api)[0]?.url).toBe('/api/tasks');
    expect(posts(api)[0]?.body).toEqual({ title: 'Comprar pan', description: 'leche' });
    await answerPost(api, jsonResponse(201, makeTask(1)));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Tarea creada.'));
    expect(screen.queryByRole('form', { name: 'Nueva tarea' })).toBeNull();
    expect(document.activeElement).toBe(newTaskButton());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['red', () => new TypeError('Failed to fetch'), POST_UNCONFIRMED_MESSAGE],
    ['500', () => serverError(500, 'INTERNAL_ERROR', 'Error interno.'), 'Error interno.'],
    [
      '502 sin mensaje conocido (HTML de proxy)',
      () => new Response('<html>', { status: 502 }),
      POST_UNCONFIRMED_MESSAGE,
    ],
  ])(
    'RF-F9: con fallo (%s) conserva lo escrito, muestra role="alert" junto al formulario y no hay aviso',
    async (_name, failure, expected) => {
      const { api } = await setup();
      fill('Comprar pan', 'leche');
      fireEvent.click(submitButton());
      const outcome = failure();
      await act(async () => {
        if (outcome instanceof Response) {
          posts(api)[0]?.resolve(outcome);
        } else {
          posts(api)[0]?.reject(outcome);
        }
        await Promise.resolve();
      });
      const alert = await within(form()).findByRole('alert');
      expect(alert.textContent).toContain(expected);
      expect(titleField().value).toBe('Comprar pan');
      expect(descriptionField().value).toBe('leche');
      expect(screen.getByRole('status').textContent).not.toContain('Tarea creada.');
      expect(submitButton().getAttribute('aria-disabled')).not.toBe('true');
      expect(lists(api)).toHaveLength(1);
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  it('RF-F9: envío con Enter', async () => {
    const { api } = await setup();
    fill('Comprar pan');
    fireEvent.submit(form());
    expect(posts(api)).toHaveLength(1);
    expect(posts(api)[0]?.body).toEqual({ title: 'Comprar pan', description: '' });
  });

  it('RF-F14: dos clics (y dos envíos) dentro de la misma actuación hacen UNA sola llamada a fetch; el botón queda aria-disabled y se reactiva', async () => {
    const { api } = await setup();
    fill('Comprar pan');
    act(() => {
      fireEvent.click(submitButton());
      fireEvent.click(submitButton());
      fireEvent.submit(form());
      fireEvent.submit(form());
    });
    expect(posts(api)).toHaveLength(1);
    expect(submitButton().getAttribute('aria-disabled')).toBe('true');
    await answerPost(api, serverError(500, 'INTERNAL_ERROR', 'Error interno.'));
    await waitFor(() => expect(submitButton().getAttribute('aria-disabled')).not.toBe('true'));
    fireEvent.click(submitButton());
    expect(posts(api)).toHaveLength(2);
  });

  it.each([
    ['título vacío', '', '', TITLE_RULE, 'title'],
    ['título de 101 emojis', '😀'.repeat(101), '', TITLE_RULE, 'title'],
    ['título con NUL', 'a\u0000b', '', 'Contiene caracteres no permitidos.', 'title'],
    ['descripción de 501 caracteres', 'Título', 'a'.repeat(501), DESCRIPTION_RULE, 'description'],
  ])(
    'RF-F10: caso inválido (%s) no llama a fetch, muestra el mensaje junto al campo y lleva el foco',
    async (_name, title, description, message, field) => {
      const { api } = await setup();
      fill(title, description);
      fireEvent.click(submitButton());
      expect(posts(api)).toHaveLength(0);
      const input = field === 'title' ? titleField() : descriptionField();
      expect(input.getAttribute('aria-invalid')).toBe('true');
      const describedBy = (input.getAttribute('aria-describedby') ?? '').split(' ');
      const texts = describedBy.map((id) => document.getElementById(id)?.textContent);
      expect(texts).toContain(message);
      expect(document.activeElement).toBe(input);
    },
  );

  it('RF-F10: con título y descripción inválidos muestra los dos mensajes y el foco va al primero (título)', async () => {
    const { api } = await setup();
    fill('', 'a'.repeat(501));
    fireEvent.click(submitButton());
    expect(posts(api)).toHaveLength(0);
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([TITLE_RULE, DESCRIPTION_RULE]);
    expect(document.activeElement).toBe(titleField());
    expect(descriptionField().getAttribute('aria-invalid')).toBe('true');
  });

  it('RF-F10: el contador n/100 y n/500 sobre el texto recortado y con emoji compuesto; no hay maxLength', async () => {
    await setup();
    expect(screen.getByText('0/100')).toBeTruthy();
    expect(screen.getByText('0/500')).toBeTruthy();
    fill('  ab  ', '　👨‍👩‍👧 ');
    expect(screen.getByText('2/100')).toBeTruthy();
    // Un emoji compuesto con ZWJ cuenta varios puntos de código (3 emojis + 2 uniones).
    expect(screen.getByText('5/500')).toBeTruthy();
    expect(titleField().hasAttribute('maxlength')).toBe(false);
    expect(descriptionField().hasAttribute('maxlength')).toBe(false);
    fill('😀'.repeat(100));
    expect(screen.getByText('100/100')).toBeTruthy();
  });

  it('RF-F10: 400 con details de title, de description y de otro campo (mensaje general = error.message)', async () => {
    const { api } = await setup();
    fill('Comprar pan', 'leche');
    fireEvent.click(submitButton());
    await answerPost(
      api,
      serverError(400, 'VALIDATION_ERROR', 'Hay datos inválidos.', [
        { field: 'title', message: 'Título rechazado.' },
        { field: 'description', message: 'Descripción rechazada.' },
        { field: 'body', message: 'Cuerpo rechazado.' },
      ]),
    );
    await waitFor(() => expect(screen.getByText('Título rechazado.')).toBeTruthy());
    const describedBy = (field: HTMLElement) => (field.getAttribute('aria-describedby') ?? '').split(' ');
    expect(describedBy(titleField()).map((id) => document.getElementById(id)?.textContent)).toContain(
      'Título rechazado.',
    );
    expect(describedBy(descriptionField()).map((id) => document.getElementById(id)?.textContent)).toContain(
      'Descripción rechazada.',
    );
    expect(titleField().getAttribute('aria-invalid')).toBe('true');
    expect(within(form()).getByText('Hay datos inválidos.')).toBeTruthy();
    expect(screen.queryByText('Cuerpo rechazado.')).toBeNull();
    expect(titleField().value).toBe('Comprar pan');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('RF-F10: 400 sin details muestra solo el mensaje general', async () => {
    const { api } = await setup();
    fill('Comprar pan');
    fireEvent.click(submitButton());
    await answerPost(api, serverError(400, 'BAD_REQUEST', 'Petición inválida.'));
    expect((await within(form()).findByRole('alert')).textContent).toBe('Petición inválida.');
    expect(titleField().hasAttribute('aria-invalid')).toBe(false);
  });

  it('RF-F15: tras crear se pide la lista una vez (en segundo plano, con el filtro vigente) y se llama a router.refresh una vez; tras un error no se hace ninguna de las dos', async () => {
    const { api } = await setup({ filter: 'pending', tasks: [makeTask(1)] });
    fill('Comprar pan');
    fireEvent.click(submitButton());
    await answerPost(api, jsonResponse(201, makeTask(2)));
    await waitFor(() => expect(lists(api)).toHaveLength(2));
    expect(lists(api)[1]?.url).toBe('/api/tasks?filter=pending');
    // En segundo plano: la lista anterior sigue visible y no hay indicador de carga.
    expect(screen.getByText('Tarea 1')).toBeTruthy();
    expect(screen.getByRole('status').textContent).not.toContain(LOADING);
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      lists(api)[1]?.resolve(jsonResponse(200, [makeTask(1), makeTask(2)]));
      await Promise.resolve();
    });
    expect(lists(api)).toHaveLength(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('RF-F9: crear bajo Completadas cierra el panel y avisa aunque la tarea no aparezca', async () => {
    const { api } = await setup({ filter: 'completed' });
    fill('Comprar pan');
    fireEvent.click(submitButton());
    await answerPost(api, jsonResponse(201, makeTask(1)));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Tarea creada.'));
    expect(screen.queryByRole('form', { name: 'Nueva tarea' })).toBeNull();
    expect(lists(api)[1]?.url).toBe('/api/tasks?filter=completed');
    await act(async () => {
      lists(api)[1]?.resolve(jsonResponse(200, []));
      await Promise.resolve();
    });
    expect(screen.getByText('No hay tareas completadas.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Tarea creada.');
  });

  it('RF-F6: el borrador del formulario y su error sobreviven a un cambio de filtro', async () => {
    const { rerender } = await setup();
    fill('Mi borrador', 'a'.repeat(501));
    fireEvent.click(submitButton());
    expect(screen.getByText(DESCRIPTION_RULE)).toBeTruthy();
    rerender(<TaskManager filter="completed" total={null} />);
    expect(titleField().value).toBe('Mi borrador');
    expect(descriptionField().value).toBe('a'.repeat(501));
    expect(screen.getByText(DESCRIPTION_RULE)).toBeTruthy();
  });

  it('RF-F16: con un refresco de Next pendiente no sale el aviso de truncado', async () => {
    const tasks = Array.from({ length: 1000 }, (_, index) => makeTask(index + 1));
    const { api } = await setup({ tasks, total: 1200 });
    expect(screen.getByText('Mostrando las 1000 tareas más recientes de 1200.')).toBeTruthy();
    // Una promesa sin resolver como resultado del refresco mantiene `isPending` de la transición.
    let finishRefresh: () => void = () => undefined;
    refresh.mockImplementationOnce(() => new Promise<void>((resolve) => (finishRefresh = resolve)));
    fill('Comprar pan');
    fireEvent.click(submitButton());
    await answerPost(api, jsonResponse(201, makeTask(1001)));
    await waitFor(() => expect(lists(api)).toHaveLength(2));
    await act(async () => {
      lists(api)[1]?.resolve(jsonResponse(200, tasks));
      await Promise.resolve();
    });
    expect(screen.queryByText(/Mostrando las/)).toBeNull();
    await act(async () => {
      finishRefresh();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText('Mostrando las 1000 tareas más recientes de 1200.')).toBeTruthy());
    // Pinta 1000 tarjetas varias veces: con las tarjetas con más elementos (006c) 5 s no bastan bajo carga.
  }, 20_000);

  it('RF-F9: si se desmonta durante el envío el POST no se cancela y no se pide la lista ni se refresca', async () => {
    const { api, unmount } = await setup();
    fill('Comprar pan');
    fireEvent.click(submitButton());
    unmount();
    expect(posts(api)[0]?.signal).toBeUndefined();
    await answerPost(api, jsonResponse(201, makeTask(1)));
    expect(lists(api)).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });
});
