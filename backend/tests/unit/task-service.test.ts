import { describe, expect, it, type Mock, vi } from 'vitest';
import type { TaskRow } from '../../src/repositories/task-repository';
import { createTaskService } from '../../src/services/task-service';

const ROW: TaskRow = {
  id: '3f1c2d5e-8a0b-4c7d-9e1f-0a2b3c4d5e6f',
  title: 'Comprar pan',
  description: 'Integral',
  completed: false,
  createdAt: '2026-01-02T03:04:05.678Z',
};

function fakeRepository(rows: TaskRow[]): { list: Mock<(completed?: boolean) => Promise<TaskRow[]>> } {
  return { list: vi.fn<(completed?: boolean) => Promise<TaskRow[]>>().mockResolvedValue(rows) };
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
