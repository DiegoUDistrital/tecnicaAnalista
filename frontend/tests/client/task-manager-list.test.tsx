// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskCard } from '../../src/client/task-card';
import { TaskManager } from '../../src/client/task-manager';
import { useTaskList, type TaskList } from '../../src/client/use-task-list';
import { NO_CONNECTION_MESSAGE } from '../../src/lib/api-error';
import type { Task } from '../../src/lib/task';
import { formatCreatedAt } from '../../src/lib/task-date';
import type { TaskFilter } from '../../src/lib/task-filter';
import '../helpers/dom-cleanup';
import { installFakeApi, jsonResponse, makeTask, type FakeApi } from '../helpers/fake-api';

// El hook es el real salvo en los tests que fijan su estado a mano (refresco fallido y refresco en curso).
// Hasta T4 ninguna acción pide un refresco en segundo plano, así que esos estados no se alcanzan desde la pantalla.
vi.mock('../../src/client/use-task-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/use-task-list')>();
  return { ...actual, useTaskList: vi.fn(actual.useTaskList) };
});
const useTaskListMock = vi.mocked(useTaskList);

afterEach(() => {
  useTaskListMock.mockRestore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const manyTasks = (count: number): Task[] => Array.from({ length: count }, (_, index) => makeTask(index + 1));

function fixedList(overrides: Partial<TaskList>): TaskList {
  return {
    tasks: [],
    status: 'ready',
    loadError: undefined,
    refreshError: undefined,
    pending: 0,
    reload: vi.fn(),
    ...overrides,
  };
}

function renderList(filter: TaskFilter = 'all', total: number | null = null): FakeApi {
  const api = installFakeApi();
  render(<TaskManager filter={filter} total={total} />);
  return api;
}

/** Responde la lista y espera a que deje de estar cargando (la lectura del JSON es asíncrona). */
async function showList(tasks: Task[], filter: TaskFilter = 'all', total: number | null = null): Promise<void> {
  const api = renderList(filter, total);
  act(() => api.calls[0]?.resolve(jsonResponse(200, tasks)));
  await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe('Cargando tareas…'));
}

const normalizeSpaces = (text: string) => text.replace(/\s/g, ' ');

function sourcesIn(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourcesIn(path) : [path];
  });
}

describe('TaskManager: estados de la lista', () => {
  it('RF-F6: cargando muestra el indicador en la región de estado y no la lista, y el formulario sigue disponible (se añade en T4)', () => {
    renderList();
    expect(screen.getByRole('status').textContent).toBe('Cargando tareas…');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('RF-F6: error de carga muestra role="alert" con Reintentar', async () => {
    const api = renderList();
    act(() => api.calls[0]?.reject(new TypeError('Failed to fetch')));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(NO_CONNECTION_MESSAGE);
    fireEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    expect(api.calls).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toBe('Cargando tareas…');
  });

  it('RF-F6: refresco fallido deja la lista y el alert «No se pudo actualizar la lista.»', () => {
    const reload = vi.fn();
    useTaskListMock.mockReturnValue(
      fixedList({ tasks: [makeTask(1)], refreshError: 'No se pudo actualizar la lista.', reload }),
    );
    render(<TaskManager filter="all" total={null} />);
    expect(screen.getByText('Tarea 1')).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('No se pudo actualizar la lista.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    expect(reload).toHaveBeenCalledWith('background');
  });

  it('RF-F6: 1 000 tareas se muestran con clave única sin errores de React', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await showList(manyTasks(1000));
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1000);
    expect(errors).not.toHaveBeenCalled();
  }, 20000);

  it('RF-F27: un solo h2 «Tareas» con tabIndex -1', () => {
    renderList();
    const heading = screen.getByRole('heading', { level: 2, name: 'Tareas' });
    expect(heading.tabIndex).toBe(-1);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
  });
});

describe('TaskManager y TaskCard: contenido de cada tarea', () => {
  it('RF-F7: título <img src=x onerror=alert(1)> se ve literal y no crea imagen', async () => {
    const title = '<img src=x onerror=alert(1)>';
    await showList([makeTask(1, { title })]);
    expect(screen.getByText(title)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('RF-F7: emoji, 100 caracteres sin espacios (la tarjeta lleva las clases anti-desbordamiento), descripción con saltos de línea (clase whitespace-pre-wrap), descripción vacía no se pinta', async () => {
    const longTitle = 'a'.repeat(100);
    await showList([
      makeTask(1, { title: '😀 Comprar 🥖' }),
      makeTask(2, { title: longTitle, description: 'línea uno\nlínea dos' }),
      makeTask(3, { title: 'Sin descripción', description: '' }),
    ]);
    expect(screen.getByText('😀 Comprar 🥖')).toBeTruthy();
    const card = screen.getByText(longTitle).closest('article');
    expect(card?.className).toContain('wrap-anywhere');
    expect(card?.className).toContain('min-w-0');
    const description = screen.getByText(/línea uno/);
    expect(description.className).toContain('whitespace-pre-wrap');
    expect(description.textContent).toBe('línea uno\nlínea dos');
    const withoutDescription = screen.getByText('Sin descripción').closest('article');
    expect(Array.from(withoutDescription?.querySelectorAll('p') ?? []).every((p) => p.textContent !== '')).toBe(true);
  });

  it('RF-F7: fecha con es-CO en America/Bogota', () => {
    const task = makeTask(1);
    render(<TaskCard task={task} timeZone="America/Bogota" />);
    const shown = normalizeSpaces(document.querySelector('time')?.textContent ?? '');
    expect(shown).toBe(normalizeSpaces(formatCreatedAt(task.createdAt, 'America/Bogota')));
    // 15:05 UTC son las 10:05 en Bogotá: si se mostrara la hora UTC, esta prueba fallaría.
    expect(shown).toContain('10:05');
  });

  it('RF-F7: estado con texto Completada/Pendiente', async () => {
    await showList([makeTask(1, { completed: true }), makeTask(2)]);
    expect(screen.getByText('Completada')).toBeTruthy();
    expect(screen.getByText('Pendiente')).toBeTruthy();
  });

  it('RF-F7: ningún archivo de src/client usa dangerouslySetInnerHTML (caracterización)', () => {
    const clientDirectory = resolve(process.cwd(), 'src', 'client');
    const offenders = sourcesIn(clientDirectory).filter((file) =>
      readFileSync(file, 'utf8').includes('dangerouslySetInnerHTML'),
    );
    expect(offenders).toEqual([]);
  });
});

describe('TaskManager: vacío, truncado y totales', () => {
  it.each([
    ['all', 'Aún no hay tareas…'],
    ['completed', 'No hay tareas completadas.'],
    ['pending', 'No hay tareas pendientes.'],
  ] as const)('RF-F8: vacío por filtro (%s): «%s» y sin role="alert"', async (filter, text) => {
    await showList([], filter);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('RF-F16: 1 000 tareas recibidas y total 1 200 -> «Mostrando las 1000 tareas más recientes de 1200.»', async () => {
    await showList(manyTasks(1000), 'all', 1200);
    expect(screen.getByText('Mostrando las 1000 tareas más recientes de 1200.')).toBeTruthy();
  }, 20000);

  it('RF-F16: total igual, null, carga pendiente, refresco en curso -> sin aviso', async () => {
    await showList(manyTasks(2), 'all', 2);
    expect(screen.queryByText(/Mostrando/)).toBeNull();
    cleanup();

    await showList(manyTasks(2), 'all', null);
    expect(screen.queryByText(/Mostrando/)).toBeNull();
    cleanup();

    renderList('all', 1200);
    expect(screen.getByRole('status').textContent).toBe('Cargando tareas…');
    expect(screen.queryByText(/Mostrando/)).toBeNull();
    cleanup();

    useTaskListMock.mockReturnValue(fixedList({ tasks: manyTasks(2), pending: 1 }));
    render(<TaskManager filter="all" total={1200} />);
    expect(screen.queryByText(/Mostrando/)).toBeNull();
  });
});
