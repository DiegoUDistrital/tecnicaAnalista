import { describe, expect, it, type Mock, vi } from 'vitest';
import { HttpError } from '../../src/http/http-error';
import type { NewTask, TaskChanges, TaskRow } from '../../src/repositories/task-repository';
import { createTaskService } from '../../src/services/task-service';

const ROW: TaskRow = {
  id: '3f1c2d5e-8a0b-4c7d-9e1f-0a2b3c4d5e6f',
  title: 'Comprar pan',
  description: 'Integral',
  completed: false,
  createdAt: '2026-01-02T03:04:05.678Z',
};

interface FakeRepository {
  list: Mock<(completed?: boolean) => Promise<TaskRow[]>>;
  insert: Mock<(input: NewTask) => Promise<TaskRow>>;
  update: Mock<(id: string, changes: TaskChanges) => Promise<TaskRow | undefined>>;
  remove: Mock<(id: string) => Promise<boolean>>;
}

function fakeRepository(rows: TaskRow[], inserted: TaskRow = ROW): FakeRepository {
  return {
    list: vi.fn<(completed?: boolean) => Promise<TaskRow[]>>().mockResolvedValue(rows),
    insert: vi.fn<(input: NewTask) => Promise<TaskRow>>().mockResolvedValue(inserted),
    update: vi.fn<(id: string, changes: TaskChanges) => Promise<TaskRow | undefined>>().mockResolvedValue(inserted),
    remove: vi.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true),
  };
}

describe('RF-C12: TaskService.list', () => {
  it('RF-C12: list devuelve cada tarea con EXACTAMENTE los cinco campos (id, title, description, ...)', async () => {
    // Una fila con un campo extra (p. ej. una columna futura) no debe filtrarse a la respuesta.
    const dirty = { ...ROW, secret: 'no debe salir' } as TaskRow;
    const service = createTaskService(fakeRepository([dirty]));

    const tasks = await service.list();

    expect(tasks).toEqual([ROW]);
    expect(Object.keys(tasks[0] as object)).toEqual(['id', 'title', 'description', 'completed', 'createdAt']);
  });

  it('RF-C12: list devuelve [] cuando no hay tareas', async () => {
    expect(await createTaskService(fakeRepository([])).list()).toEqual([]);
  });
});

describe('RF-C13: TaskService.list con filtro', () => {
  it.each([[true], [false], [undefined]])('RF-C13: list pasa el filtro %s al repositorio', async (completed) => {
    const repository = fakeRepository([]);

    await createTaskService(repository).list(completed);

    expect(repository.list).toHaveBeenCalledExactlyOnceWith(completed);
  });
});

describe('RF-C11: TaskService.create', () => {
  it('RF-C11: create pasa título y descripción al repositorio y devuelve EXACTAMENTE cinco campos', async () => {
    const dirty = { ...ROW, secret: 'no debe salir' } as TaskRow;
    const repository = fakeRepository([], dirty);

    const task = await createTaskService(repository).create({ title: 'Comprar pan', description: 'Integral' });

    expect(repository.insert).toHaveBeenCalledExactlyOnceWith({ title: 'Comprar pan', description: 'Integral' });
    expect(task).toEqual(ROW);
    expect(Object.keys(task)).toEqual(['id', 'title', 'description', 'completed', 'createdAt']);
  });

  it('RF-C11: create propaga el error del repositorio sin cambiarlo', async () => {
    const repository = fakeRepository([]);
    const failure = new Error('fallo del repositorio');
    repository.insert.mockRejectedValue(failure);

    await expect(createTaskService(repository).create({ title: 'a', description: '' })).rejects.toBe(failure);
  });
});

describe('RF-C15 / RF-C17: TaskService.update', () => {
  const ID = ROW.id;

  it('RF-C15: update pasa id y cambios al repositorio y devuelve EXACTAMENTE cinco campos', async () => {
    const dirty = { ...ROW, secret: 'no debe salir' } as TaskRow;
    const repository = fakeRepository([]);
    repository.update.mockResolvedValue(dirty);

    const task = await createTaskService(repository).update(ID, { completed: true });

    expect(repository.update).toHaveBeenCalledExactlyOnceWith(ID, { completed: true });
    expect(task).toEqual(ROW);
    expect(Object.keys(task)).toEqual(['id', 'title', 'description', 'completed', 'createdAt']);
  });

  it('RF-C17: update lanza HttpError 404 cuando el repositorio no encuentra la fila', async () => {
    const repository = fakeRepository([]);
    repository.update.mockResolvedValue(undefined);

    const failure = createTaskService(repository).update(ID, { title: 'a' });

    await expect(failure).rejects.toBeInstanceOf(HttpError);
    await expect(failure).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('RF-C15: update propaga el error del repositorio sin cambiarlo', async () => {
    const repository = fakeRepository([]);
    const failure = new Error('fallo del repositorio');
    repository.update.mockRejectedValue(failure);

    await expect(createTaskService(repository).update(ID, { title: 'a' })).rejects.toBe(failure);
  });
});

describe('RF-C18 / RF-C19: TaskService.remove', () => {
  const ID = ROW.id;

  it('RF-C18: remove pasa el id al repositorio y termina sin valor cuando se borró una fila', async () => {
    const repository = fakeRepository([]);
    repository.remove.mockResolvedValue(true);

    await expect(createTaskService(repository).remove(ID)).resolves.toBeUndefined();

    expect(repository.remove).toHaveBeenCalledExactlyOnceWith(ID);
  });

  it('RF-C19: remove lanza HttpError 404 cuando el repositorio no afecta filas', async () => {
    const repository = fakeRepository([]);
    repository.remove.mockResolvedValue(false);

    const failure = createTaskService(repository).remove(ID);

    await expect(failure).rejects.toBeInstanceOf(HttpError);
    await expect(failure).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('RF-C18: remove propaga el error del repositorio sin cambiarlo', async () => {
    const repository = fakeRepository([]);
    const failure = new Error('fallo del repositorio');
    repository.remove.mockRejectedValue(failure);

    await expect(createTaskService(repository).remove(ID)).rejects.toBe(failure);
  });
});
