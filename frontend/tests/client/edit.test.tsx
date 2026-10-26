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
const TITLE_EMPTY = 'Debe tener entre 1 y 100 caracteres.';

async function setup(tasks: Task[], filter: TaskFilter = 'all') {
  const api = installFakeApi();
  const view = render(<TaskManager filter={filter} total={null} />);
  act(() => api.calls[0]?.resolve(jsonResponse(200, tasks)));
  await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe(LOADING));
  return { api, view };
}

const editButton = (title: string) => screen.getByRole('button', { name: `Editar «${title}»` });
const toggleButton = (title: string) => screen.getByRole('button', { name: `Marcar «${title}» como completada` });
const deleteButton = (title: string) => screen.getByRole('button', { name: `Eliminar «${title}»` });
const formOf = (title: string) => within(screen.getByRole('form', { name: `Editar «${title}»` }));
const hasForm = (title: string) => screen.queryByRole('form', { name: `Editar «${title}»` }) !== null;
const titleField = (title: string) => formOf(title).getByLabelText<HTMLInputElement>('Título');
const descriptionField = (title: string) => formOf(title).getByLabelText<HTMLTextAreaElement>('Descripción');
const saveButton = (title: string) => formOf(title).getByRole('button', { name: 'Guardar' });
const puts = (api: FakeApi) => api.calls.filter((call) => call.method === 'PUT');
const lists = (api: FakeApi) => api.calls.filter((call) => call.method === 'GET');
const type = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } });
const cardAround = (element: HTMLElement) => within(element.closest('article')!);

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

function invalid(details: { field: string; message: string }[]) {
  return jsonResponse(400, { error: { code: 'VALIDATION_ERROR', message: 'Datos inválidos.', details } });
}

describe('Editar en la propia tarjeta', () => {
  it('RF-F12: Editar muestra título y descripción precargados y el foco va al título', async () => {
    await setup([makeTask(1, { description: 'Desc 1' }), makeTask(2)]);
    expect(hasForm('Tarea 1')).toBe(false);
    fireEvent.click(editButton('Tarea 1'));
    expect(titleField('Tarea 1').value).toBe('Tarea 1');
    expect(descriptionField('Tarea 1').value).toBe('Desc 1');
    expect(document.activeElement).toBe(titleField('Tarea 1'));
    expect(hasForm('Tarea 2')).toBe(false);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('RF-F12: Guardar envía PUT con SOLO los campos cambiados (una sola clave) y refresca; salir devuelve el foco a Editar', async () => {
    const task = makeTask(1, { description: 'Desc 1' });
    const { api } = await setup([task, makeTask(2)]);
    fireEvent.click(editButton('Tarea 1'));
    type(titleField('Tarea 1'), '  Nuevo título  ');
    type(descriptionField('Tarea 1'), 'Desc 1 ');
    fireEvent.click(saveButton('Tarea 1'));
    expect(puts(api)).toHaveLength(1);
    expect(puts(api)[0]?.url).toBe(`/api/tasks/${task.id}`);
    expect(puts(api)[0]?.body).toEqual({ title: 'Nuevo título' });
    await answer(puts(api)[0], jsonResponse(200, {}));
    await waitFor(() => expect(lists(api)).toHaveLength(2));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(hasForm('Tarea 1')).toBe(false);
    expect(document.activeElement).toBe(editButton('Tarea 1'));
    await answer(lists(api)[1], jsonResponse(200, [{ ...task, title: 'Nuevo título' }, makeTask(2)]));
    expect(screen.getByRole('status').textContent).toContain('Lista actualizada.');
    expect(screen.getByRole('heading', { name: 'Nuevo título' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(editButton('Nuevo título')));
  });

  it('RF-F12: cambio solo de espacios no hace fetch y sale de la edición; sin cambios, igual', async () => {
    const { api } = await setup([makeTask(1, { description: 'Desc 1' })]);
    fireEvent.click(editButton('Tarea 1'));
    type(titleField('Tarea 1'), '  Tarea 1   ');
    type(descriptionField('Tarea 1'), ' Desc 1');
    fireEvent.click(saveButton('Tarea 1'));
    expect(hasForm('Tarea 1')).toBe(false);
    expect(document.activeElement).toBe(editButton('Tarea 1'));
    fireEvent.click(editButton('Tarea 1'));
    fireEvent.click(saveButton('Tarea 1'));
    expect(hasForm('Tarea 1')).toBe(false);
    expect(document.activeElement).toBe(editButton('Tarea 1'));
    expect(api.calls).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('RF-F12: Cancelar y Escape descartan y devuelven el foco al botón Editar', async () => {
    const { api } = await setup([makeTask(1, { description: 'Desc 1' })]);
    fireEvent.click(editButton('Tarea 1'));
    type(titleField('Tarea 1'), 'Cambiado');
    fireEvent.click(formOf('Tarea 1').getByRole('button', { name: 'Cancelar' }));
    expect(hasForm('Tarea 1')).toBe(false);
    expect(screen.getByRole('heading', { name: 'Tarea 1' })).toBeTruthy();
    expect(document.activeElement).toBe(editButton('Tarea 1'));
    fireEvent.click(editButton('Tarea 1'));
    expect(titleField('Tarea 1').value).toBe('Tarea 1');
    type(descriptionField('Tarea 1'), 'Otra');
    fireEvent.keyDown(descriptionField('Tarea 1'), { key: 'Escape' });
    expect(hasForm('Tarea 1')).toBe(false);
    expect(document.activeElement).toBe(editButton('Tarea 1'));
    fireEvent.click(editButton('Tarea 1'));
    expect(descriptionField('Tarea 1').value).toBe('Desc 1');
    expect(api.calls).toHaveLength(1);
  });

  it('RF-F10: Guardar valida (caso inválido sin fetch, mensaje junto al campo, foco al primer inválido)', async () => {
    const { api } = await setup([makeTask(1)]);
    fireEvent.click(editButton('Tarea 1'));
    type(titleField('Tarea 1'), '   ');
    type(descriptionField('Tarea 1'), 'x'.repeat(501));
    fireEvent.click(saveButton('Tarea 1'));
    expect(api.calls).toHaveLength(1);
    const title = titleField('Tarea 1');
    expect(title.getAttribute('aria-invalid')).toBe('true');
    const errorId = title.getAttribute('aria-describedby')?.split(' ').at(-1);
    expect(document.getElementById(errorId!)?.textContent).toBe(TITLE_EMPTY);
    expect(document.activeElement).toBe(title);
    expect(descriptionField('Tarea 1').getAttribute('aria-invalid')).toBe('true');
    expect(formOf('Tarea 1').getByText('Debe tener como máximo 500 caracteres.')).toBeTruthy();

    type(titleField('Tarea 1'), 'Válido');
    fireEvent.click(saveButton('Tarea 1'));
    expect(titleField('Tarea 1').getAttribute('aria-invalid')).toBeNull();
    expect(document.activeElement).toBe(descriptionField('Tarea 1'));
    expect(api.calls).toHaveLength(1);
  });

  it.each([
    ['title', 'Título repetido.', (title: string) => formOf(title).getByLabelText('Título')],
    ['description', 'Descripción rara.', (title: string) => formOf(title).getByLabelText('Descripción')],
  ])('RF-F10: 400 con details de %s muestra el mensaje junto a ese campo', async (field, message, locate) => {
    const { api } = await setup([makeTask(1)]);
    fireEvent.click(editButton('Tarea 1'));
    type(titleField('Tarea 1'), 'Nuevo');
    fireEvent.click(saveButton('Tarea 1'));
    await answer(puts(api)[0], invalid([{ field, message }]));
    const input = locate('Tarea 1');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const errorId = input.getAttribute('aria-describedby')?.split(' ').at(-1);
    expect(document.getElementById(errorId!)?.textContent).toBe(message);
    expect(titleField('Tarea 1').value).toBe('Nuevo');
    expect(saveButton('Tarea 1').getAttribute('aria-disabled')).toBe('false');
    expect(lists(api)).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('RF-F10: 400 con details de otro campo muestra el mensaje general del servidor', async () => {
    const { api } = await setup([makeTask(1)]);
    fireEvent.click(editButton('Tarea 1'));
    type(titleField('Tarea 1'), 'Nuevo');
    fireEvent.click(saveButton('Tarea 1'));
    await answer(puts(api)[0], invalid([{ field: 'completed', message: 'No vale.' }]));
    expect(formOf('Tarea 1').getByRole('alert').textContent).toBe('Datos inválidos.');
    expect(titleField('Tarea 1').getAttribute('aria-invalid')).toBeNull();
    expect(titleField('Tarea 1').value).toBe('Nuevo');
  });

  it('RF-F12: Editar otra tarea con cambios sin guardar pide confirm con «Hay cambios sin guardar en «X». ¿Descartarlos?» (aceptado cambia, rechazado se queda); sin cambios cambia sin preguntar', async () => {
    await setup([makeTask(1), makeTask(2)]);
    fireEvent.click(editButton('Tarea 1'));
    type(titleField('Tarea 1'), 'Escrito');
    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(editButton('Tarea 2'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenLastCalledWith('Hay cambios sin guardar en «Tarea 1». ¿Descartarlos?');
    expect(hasForm('Tarea 1')).toBe(true);
    expect(titleField('Tarea 1').value).toBe('Escrito');
    expect(hasForm('Tarea 2')).toBe(false);

    fireEvent.click(editButton('Tarea 2'));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(hasForm('Tarea 1')).toBe(false);
    expect(hasForm('Tarea 2')).toBe(true);
    expect(document.activeElement).toBe(titleField('Tarea 2'));

    type(titleField('Tarea 2'), ' Tarea 2 ');
    fireEvent.click(editButton('Tarea 1'));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(hasForm('Tarea 1')).toBe(true);
    expect(hasForm('Tarea 2')).toBe(false);
    expect(titleField('Tarea 1').value).toBe('Tarea 1');
  });

  it('RF-V10: al editar se ocultan completar, editar y eliminar y el formulario es lo único de la tarjeta', async () => {
    await setup([makeTask(1, { description: 'Desc 1' }), makeTask(2)]);
    fireEvent.click(editButton('Tarea 1'));
    const card = cardAround(titleField('Tarea 1'));
    for (const name of ['Marcar «Tarea 1» como completada', 'Editar «Tarea 1»', 'Eliminar «Tarea 1»']) {
      expect(card.queryByRole('button', { name })).toBeNull();
    }
    expect(card.getAllByRole('button').map((button) => button.textContent)).toEqual(['Guardar', 'Cancelar']);
    expect(screen.getByRole('form', { name: 'Editar «Tarea 1»' }).classList).toContain('w-full');
    expect(screen.getByRole('form', { name: 'Editar «Tarea 1»' }).classList).toContain('gap-3');
    expect(editButton('Tarea 2')).toBeTruthy();
    expect(card.getByText('Pendiente')).toBeTruthy();
  });

  it.each([
    ['Cancelar', (title: string) => fireEvent.click(formOf(title).getByRole('button', { name: 'Cancelar' }))],
    ['Escape', (title: string) => fireEvent.keyDown(titleField(title), { key: 'Escape' })],
    ['Guardar sin cambios', (title: string) => fireEvent.click(saveButton(title))],
  ])('RF-V10: al salir con %s vuelven los tres iconos y el foco va a Editar', async (_name, leave) => {
    await setup([makeTask(1)]);
    fireEvent.click(editButton('Tarea 1'));
    leave('Tarea 1');
    expect(hasForm('Tarea 1')).toBe(false);
    expect(toggleButton('Tarea 1')).toBeTruthy();
    expect(deleteButton('Tarea 1')).toBeTruthy();
    expect(document.activeElement).toBe(editButton('Tarea 1'));
  });

  it('RF-V10: al guardar con éxito vuelven los tres iconos', async () => {
    const { api } = await setup([makeTask(1)]);
    fireEvent.click(editButton('Tarea 1'));
    type(titleField('Tarea 1'), 'Nuevo');
    fireEvent.click(saveButton('Tarea 1'));
    await answer(puts(api)[0], jsonResponse(200, {}));
    await waitFor(() => expect(lists(api)).toHaveLength(2));
    expect(toggleButton('Tarea 1')).toBeTruthy();
    expect(editButton('Tarea 1')).toBeTruthy();
    expect(deleteButton('Tarea 1')).toBeTruthy();
  });

  it('RF-V11: al salir de la edición la tarjeta conserva si estaba expandida o plegada', async () => {
    await setup([makeTask(1, { description: 'Desc 1' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Tarea 1' }));
    fireEvent.click(editButton('Tarea 1'));
    expect(descriptionField('Tarea 1').value).toBe('Desc 1');
    fireEvent.click(formOf('Tarea 1').getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: 'Tarea 1' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Desc 1')).toBeTruthy();
  });

  it('RF-F12: si la tarea en edición desaparece tras un refresco, la edición se descarta', async () => {
    const { api } = await setup([makeTask(1), makeTask(2)]);
    fireEvent.click(editButton('Tarea 1'));
    type(titleField('Tarea 1'), 'Escrito');
    fireEvent.click(toggleButton('Tarea 2'));
    await answer(puts(api)[0], jsonResponse(200, {}));
    await waitFor(() => expect(lists(api)).toHaveLength(2));
    await answer(lists(api)[1], jsonResponse(200, [makeTask(2, { completed: true })]));
    expect(hasForm('Tarea 1')).toBe(false);
    expect(screen.queryByText('Escrito')).toBeNull();
    expect(screen.getByText('Tarea 2')).toBeTruthy();
  });

  it('RF-F6: clave de prueba: editar B, completar A y al llegar el refresco B sigue en edición con su texto escrito', async () => {
    const [a, b] = [makeTask(1), makeTask(2)];
    const { api } = await setup([a, b]);
    fireEvent.click(editButton('Tarea 2'));
    type(titleField('Tarea 2'), 'Texto de B');
    const fieldBefore = titleField('Tarea 2');
    fireEvent.click(toggleButton('Tarea 1'));
    await answer(puts(api)[0], jsonResponse(200, {}));
    await waitFor(() => expect(lists(api)).toHaveLength(2));
    await answer(lists(api)[1], jsonResponse(200, [{ ...a, completed: true }, b]));
    expect(screen.getByText('Completada')).toBeTruthy();
    expect(hasForm('Tarea 2')).toBe(true);
    expect(titleField('Tarea 2')).toBe(fieldBefore);
    expect(titleField('Tarea 2').value).toBe('Texto de B');
  });

  it('RF-F6: el borrador de edición sobrevive al cambio de filtro si la tarea sigue en la lista', async () => {
    const tasks = [makeTask(1), makeTask(2)];
    const { api, view } = await setup(tasks);
    fireEvent.click(editButton('Tarea 2'));
    type(titleField('Tarea 2'), 'Borrador');
    view.rerender(<TaskManager filter="pending" total={null} />);
    expect(lists(api)).toHaveLength(2);
    await answer(lists(api)[1], jsonResponse(200, tasks));
    expect(hasForm('Tarea 2')).toBe(true);
    expect(titleField('Tarea 2').value).toBe('Borrador');
    expect(document.activeElement).not.toBe(titleField('Tarea 2'));
    fireEvent.click(saveButton('Tarea 2'));
    expect(puts(api)[0]?.body).toEqual({ title: 'Borrador' });
  });

  it('RF-F14: dos clics/envíos en Guardar hacen una sola llamada', async () => {
    const { api } = await setup([makeTask(1)]);
    fireEvent.click(editButton('Tarea 1'));
    type(titleField('Tarea 1'), 'Nuevo');
    act(() => {
      fireEvent.click(saveButton('Tarea 1'));
      fireEvent.click(saveButton('Tarea 1'));
      fireEvent.submit(screen.getByRole('form', { name: 'Editar «Tarea 1»' }));
    });
    expect(puts(api)).toHaveLength(1);
    expect(saveButton('Tarea 1').getAttribute('aria-disabled')).toBe('true');
    await answer(puts(api)[0], jsonResponse(200, {}));
    await waitFor(() => expect(lists(api)).toHaveLength(2));
    expect(puts(api)).toHaveLength(1);
  });

  it.each([
    ['red', new TypeError('Failed to fetch'), NO_CONNECTION_MESSAGE],
    ['500', jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Error interno.' } }), 'Error interno.'],
  ])(
    'RF-F25: %s al guardar muestra el alert, conserva lo escrito, reactiva los controles y no refresca',
    async (_name, failure, expected) => {
      const { api } = await setup([makeTask(1), makeTask(2)]);
      fireEvent.click(editButton('Tarea 1'));
      type(titleField('Tarea 1'), 'Escrito');
      fireEvent.click(saveButton('Tarea 1'));
      await answer(puts(api)[0], failure);
      const alerts = await cardAround(titleField('Tarea 1')).findAllByRole('alert');
      expect(alerts.map((alert) => alert.textContent)).toEqual([expected]);
      expect(cardAround(editButton('Tarea 2')).queryByRole('alert')).toBeNull();
      expect(titleField('Tarea 1').value).toBe('Escrito');
      expect(saveButton('Tarea 1').getAttribute('aria-disabled')).toBe('false');
      expect(lists(api)).toHaveLength(1);
      expect(refresh).not.toHaveBeenCalled();
      fireEvent.click(saveButton('Tarea 1'));
      expect(puts(api)).toHaveLength(2);
    },
  );

  it('RF-F12: guardar con éxito no cierra la edición de otra tarea abierta mientras tanto', async () => {
    const { api } = await setup([makeTask(1), makeTask(2)]);
    fireEvent.click(editButton('Tarea 1'));
    type(titleField('Tarea 1'), 'Uno nuevo');
    fireEvent.click(saveButton('Tarea 1'));
    fireEvent.click(editButton('Tarea 2'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await answer(puts(api)[0], jsonResponse(200, {}));
    await waitFor(() => expect(lists(api)).toHaveLength(2));
    expect(hasForm('Tarea 2')).toBe(true);
    expect(document.activeElement).toBe(titleField('Tarea 2'));
  });
});
