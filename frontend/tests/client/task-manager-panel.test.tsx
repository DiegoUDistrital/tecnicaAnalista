// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskManager } from '../../src/client/task-manager';
import '../helpers/dom-cleanup';
import { installFakeApi, jsonResponse, makeTask } from '../helpers/fake-api';
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

async function setup() {
  const api = installFakeApi();
  render(<TaskManager filter="all" total={null} />);
  act(() => api.calls[0]?.resolve(jsonResponse(200, [])));
  await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe('Cargando tareas…'));
  return api;
}

const form = () => screen.queryByRole('form', { name: 'Nueva tarea' });
const posts = (api: Awaited<ReturnType<typeof setup>>) => api.calls.filter((call) => call.method === 'POST');

async function submitTitle(api: Awaited<ReturnType<typeof setup>>, response: Response) {
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Comprar pan' } });
  fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));
  await act(async () => {
    posts(api)[0]?.resolve(response);
    await Promise.resolve();
  });
}

describe('TaskManager: panel «Nueva tarea»', () => {
  it('RF-V7: empieza cerrado, alterna aria-expanded y formulario, y al abrir enfoca el título', async () => {
    await setup();
    const button = newTaskButton();
    expect(form()).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.classList).toContain('min-h-11');
    expect(button.classList).toContain('min-w-11');
    openPanel();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const panel = form()?.parentElement;
    expect(panel?.id).toBe(button.getAttribute('aria-controls'));
    expect(document.activeElement).toBe(screen.getByLabelText('Título'));
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(form()).toBeNull();
  });

  it('RF-V7: título y botón comparten fila; el panel y los filtros van debajo, en ese orden', async () => {
    const api = installFakeApi();
    render(
      <TaskManager filter="all" total={null} heading={<h1>Título</h1>}>
        <nav aria-label="Filtros" />
      </TaskManager>,
    );
    act(() => api.calls[0]?.resolve(jsonResponse(200, [])));
    await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe('Cargando tareas…'));
    openPanel();
    const heading = screen.getByRole('heading', { level: 1 });
    const button = newTaskButton();
    const panel = form()?.parentElement as HTMLElement;
    const filters = screen.getByRole('navigation', { name: 'Filtros' });
    expect(heading.parentElement).toBe(button.parentElement);
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(heading, button) && follows(button, panel) && follows(panel, filters)).toBe(true);
  });

  it('RF-V7: tras crear con éxito el panel se cierra y el foco vuelve al botón «Nueva tarea»', async () => {
    const api = await setup();
    openPanel();
    await submitTitle(api, jsonResponse(201, makeTask(1)));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Tarea creada.'));
    expect(form()).toBeNull();
    expect(newTaskButton().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(newTaskButton());
  });

  it('RF-V7: un error al crear mantiene el panel abierto con su mensaje y «Cancelar» cierra sin enviar', async () => {
    const api = await setup();
    openPanel();
    await submitTitle(api, jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Error interno.' } }));
    expect(await screen.findByText('Error interno.')).toBeTruthy();
    expect(form()).toBeTruthy();
    expect(newTaskButton().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(form()).toBeNull();
    expect(document.activeElement).toBe(newTaskButton());
    expect(posts(api)).toHaveLength(1);
  });
});
