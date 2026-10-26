// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskManager } from '../../src/client/task-manager';
import '../helpers/dom-cleanup';
import { makeTask } from '../helpers/fake-api';
import { fakeResponse } from '../helpers/fake-fetch';
import { BASE, createHarness, type Harness } from '../helpers/route-harness';
import { refresh } from '../helpers/router-mock';

vi.mock('next/navigation', async () => (await import('../helpers/router-mock')).navigationMock);

const GONE = 'La tarea ya no existe.';
const ID_PATH = /^\/api\/tasks\/([0-9a-f-]{36})$/;
/** Cuerpo del 404 real de Express (backend/src/http/http-error.ts). */
const EXPRESS_404 = '{"error":{"code":"NOT_FOUND","message":"Recurso no encontrado."}}';

let harness: Harness;

/** Express simulado fiel al real: PUT/DELETE de un id que ya no existe dan 404 con su cuerpo de error. */
function installBrowserOverRoutes(initial: ReturnType<typeof makeTask>[]) {
  const stored = [...initial];
  harness = createHarness({
    express: ({ url, init }) => {
      const id = ID_PATH.exec(new URL(url).pathname)?.[1];
      if (init.method === 'GET') {
        return fakeResponse({ status: 200, body: JSON.stringify(stored) });
      }
      const index = stored.findIndex((task) => task.id === id);
      if (index === -1) {
        return fakeResponse({ status: 404, headers: { 'Content-Type': 'application/json' }, body: EXPRESS_404 });
      }
      if (init.method === 'DELETE') {
        stored.splice(index, 1);
        return fakeResponse({ status: 204 });
      }
      return fakeResponse({ status: 200, body: JSON.stringify({ ...stored[index], completed: true }) });
    },
  });
  // El navegador llama a su propio origen: la petición pasa por el manejador de ruta real.
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('host', 'localhost:3001');
    headers.set('origin', BASE);
    const request = new Request(`${BASE}${url}`, { ...init, headers });
    const id = ID_PATH.exec(url.split('?')[0] ?? '')?.[1];
    return url.startsWith('/api/tasks/')
      ? harness.item(request, { params: Promise.resolve({ id }) })
      : harness.collection(request);
  });
  return stored;
}

beforeEach(() => {
  refresh.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Tarea desfasada (dos pestañas) con el servidor real de rutas', () => {
  it('RF-F13: borrar una tarea que otra pestaña ya borró muestra «La tarea ya no existe.» y la quita de la lista', async () => {
    const stored = installBrowserOverRoutes([makeTask(1), makeTask(2)]);
    render(<TaskManager filter="all" total={null} />);
    await screen.findByText('Tarea 1');
    stored.splice(0, 1); // la otra pestaña la borra
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar «Tarea 1»' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(GONE));
    await waitFor(() => expect(screen.queryByText('Tarea 1')).toBeNull());
    expect(screen.getByRole('status').textContent).toContain(GONE);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
