import { afterEach, describe, expect, it, vi } from 'vitest';

describe('RNF-8: index.ts', () => {
  afterEach(() => {
    vi.doUnmock('../../src/server/start-server');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('RNF-8: al importar index.ts llama a startServer una vez y aplica su código con process.exit', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const startServerMock = vi.fn(() => Promise.resolve(3));
    vi.resetModules();
    vi.doMock('../../src/server/start-server', () => ({ startServer: startServerMock }));

    await import('../../src/index.js');
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(3);
    });

    expect(startServerMock).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
