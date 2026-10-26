import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] as const;
const TASK = {
  id: '3f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6b',
  title: 'Comprar pan',
  description: '',
  completed: false,
  createdAt: '2026-01-31T10:00:00.000Z',
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('BACKEND_URL', 'http://127.0.0.1:3000');
  vi.stubEnv('API_KEY', 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1eF3hJ5kL7nP9r');
  vi.stubEnv('READER_DATABASE_URL', 'postgresql://reader:secret@127.0.0.1:5432/todo');
  vi.stubEnv('ALLOWED_HOSTS', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('rutas reales', () => {
  it('RF-F17: cada route.ts exporta GET, POST, PUT, DELETE, PATCH, HEAD y OPTIONS y dynamic force-dynamic', async () => {
    const collection = await import('../../src/app/api/tasks/route');
    const item = await import('../../src/app/api/tasks/[id]/route');
    for (const route of [collection, item]) {
      for (const method of METHODS) {
        expect(route[method]).toBeTypeOf('function');
      }
      expect(route.dynamic).toBe('force-dynamic');
    }
  });

  it('RF-F17: la ruta con id lee params como promesa y reenvía el id en minúsculas', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { DELETE } = await import('../../src/app/api/tasks/[id]/route');
    const upper = TASK.id.toUpperCase();
    const request = new Request(`http://localhost:3001/api/tasks/${upper}`, {
      method: 'DELETE',
      headers: { host: 'localhost:3001' },
    });
    const response = await DELETE(request, { params: Promise.resolve({ id: upper }) });
    expect(response.status).toBe(204);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`http://127.0.0.1:3000/api/tasks/${TASK.id}`);
  });
});
