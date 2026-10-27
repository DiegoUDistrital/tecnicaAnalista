import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../src/logging/logger';

describe('RF-5: seed-cli', () => {
  afterEach(() => {
    vi.doUnmock('../../src/db/seed');
    vi.resetModules();
  });

  it('RF-5: al importarlo ejecuta runSeedCommand con el proceso real y fija process.exitCode', async () => {
    const previous = process.exitCode;
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const runSeedCommandMock = vi.fn((_env: unknown, logger: Logger) => {
      logger.info('probe');
      return Promise.resolve(5);
    });
    vi.resetModules();
    vi.doMock('../../src/db/seed', () => ({ runSeedCommand: runSeedCommandMock }));
    try {
      await import('../../src/db/seed-cli.js');
      await vi.waitFor(() => {
        expect(process.exitCode).toBe(5);
      });
      expect(runSeedCommandMock).toHaveBeenCalledWith(process.env, expect.anything());
      expect(write).toHaveBeenCalledWith(expect.stringContaining('"event":"probe"'));
    } finally {
      process.exitCode = previous;
      write.mockRestore();
    }
  });
});
