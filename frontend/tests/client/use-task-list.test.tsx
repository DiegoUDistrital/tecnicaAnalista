// @vitest-environment jsdom
import { act, render, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTaskList, type TaskList } from '../../src/client/use-task-list';
import type { TaskFilter } from '../../src/lib/task-filter';
import { NO_CONNECTION_MESSAGE } from '../../src/lib/api-error';
import '../helpers/dom-cleanup';
import { installFakeApi, jsonResponse, makeTask, type FakeApi } from '../helpers/fake-api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const A = [makeTask(1), makeTask(2)];
const B = [makeTask(3)];

function setup(options: { ignoreAbort?: boolean } = {}) {
  const api: FakeApi = installFakeApi({ ignoreAbort: options.ignoreAbort });
  const hook = renderHook(({ filter }: { filter: TaskFilter }) => useTaskList(filter), {
    initialProps: { filter: 'all' as TaskFilter },
  });
  return { api, ...hook };
}

async function answer(api: FakeApi, index: number, response: Response) {
  await act(async () => {
    api.calls[index]?.resolve(response);
    await Promise.resolve();
  });
}

describe('useTaskList', () => {
  it('RF-F6: la primera carga muestra loading y luego ready', async () => {
    const { api, result } = setup();
    expect(result.current.status).toBe('loading');
    expect(api.calls).toHaveLength(1);
    await answer(api, 0, jsonResponse(200, A));
    expect(result.current.status).toBe('ready');
    expect(result.current.tasks).toEqual(A);
    expect(result.current.pending).toBe(0);
  });

  it('RF-F6: error de red y 500 dan error con Reintentar que repite SOLO esa petición', async () => {
    const { api, result } = setup();
    await act(async () => {
      api.calls[0]?.reject(new TypeError('Failed to fetch'));
      await Promise.resolve();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.loadError).toBe(NO_CONNECTION_MESSAGE);

    act(() => result.current.reload('initial'));
    expect(result.current.status).toBe('loading');
    expect(api.calls).toHaveLength(2);
    await answer(api, 1, jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Error interno.' } }));
    expect(result.current.status).toBe('error');
    expect(result.current.loadError).toBe('Error interno.');

    act(() => result.current.reload('initial'));
    expect(api.calls).toHaveLength(3);
    await answer(api, 2, jsonResponse(200, A));
    expect(result.current.status).toBe('ready');
    expect(result.current.loadError).toBeUndefined();
  });

  it('RF-F6: respuesta lenta del filtro viejo DESPUÉS de la del nuevo no la pisa (3 pasadas)', async () => {
    for (let pass = 0; pass < 3; pass += 1) {
      const { api, result, rerender, unmount } = setup({ ignoreAbort: true });
      rerender({ filter: 'completed' });
      expect(api.calls.map((call) => call.url)).toEqual(['/api/tasks', '/api/tasks?filter=completed']);
      await answer(api, 1, jsonResponse(200, B));
      await answer(api, 0, jsonResponse(200, A));
      expect(result.current.tasks).toEqual(B);
      expect(result.current.status).toBe('ready');
      expect(result.current.pending).toBe(0);
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('RF-F6: cambiar el filtro cancela la petición anterior (señal abortada)', () => {
    const { api, rerender } = setup();
    expect(api.calls[0]?.signal?.aborted).toBe(false);
    rerender({ filter: 'pending' });
    expect(api.calls[0]?.signal?.aborted).toBe(true);
    expect(api.calls[1]?.signal?.aborted).toBe(false);
  });

  it('RF-F6: desmontar cancela y no deja errores en consola', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { api, unmount } = setup();
    unmount();
    expect(api.calls[0]?.signal?.aborted).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('RF-F6: refresco en segundo plano mantiene la lista y no pone loading', async () => {
    const { api, result } = setup();
    await answer(api, 0, jsonResponse(200, A));
    act(() => result.current.reload('background'));
    expect(result.current.status).toBe('ready');
    expect(result.current.tasks).toEqual(A);
    expect(result.current.pending).toBe(1);
    await answer(api, 1, jsonResponse(200, B));
    expect(result.current.tasks).toEqual(B);
    expect(result.current.pending).toBe(0);
  });

  it('RF-F6: refresco fallido mantiene la lista y fija «No se pudo actualizar la lista.»', async () => {
    const { api, result } = setup();
    await answer(api, 0, jsonResponse(200, A));
    act(() => result.current.reload('background'));
    await answer(api, 1, jsonResponse(500, {}));
    expect(result.current.status).toBe('ready');
    expect(result.current.tasks).toEqual(A);
    expect(result.current.refreshError).toBe('No se pudo actualizar la lista.');

    act(() => result.current.reload('background'));
    await answer(api, 2, jsonResponse(200, B));
    expect(result.current.refreshError).toBeUndefined();
    expect(result.current.tasks).toEqual(B);
  });

  it('RF-F6: un refresco sin lista previa se comporta como carga inicial', async () => {
    const { api, result } = setup();
    await answer(api, 0, jsonResponse(500, {}));
    expect(result.current.status).toBe('error');
    act(() => result.current.reload('background'));
    expect(result.current.status).toBe('loading');
    await answer(api, 1, jsonResponse(500, {}));
    expect(result.current.status).toBe('error');
    expect(result.current.refreshError).toBeUndefined();
  });

  it('RF-F6: cada petición usa el filtro vigente en el momento de pedirla', async () => {
    const { api, result, rerender } = setup();
    const staleReload = result.current.reload;
    rerender({ filter: 'pending' });
    await answer(api, 1, jsonResponse(200, B));
    act(() => staleReload('background'));
    expect(api.calls.at(-1)?.url).toBe('/api/tasks?filter=pending');
  });

  it('RF-F6: StrictMode manda dos GET y gana el segundo sin error', async () => {
    // renderHook no duplica los efectos con su wrapper; render sí, así que se usa un componente mínimo.
    const api = installFakeApi();
    let latest: TaskList | undefined;
    function Probe() {
      latest = useTaskList('all');
      return null;
    }
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    expect(api.calls).toHaveLength(2);
    expect(api.calls[0]?.signal?.aborted).toBe(true);
    await answer(api, 1, jsonResponse(200, A));
    expect(latest?.status).toBe('ready');
    expect(latest?.tasks).toEqual(A);
    expect(latest?.loadError).toBeUndefined();
  });
});
