import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runDev = vi.hoisted(() => vi.fn());
vi.mock('../scripts/dev/run-dev.js', () => ({ runDev }));

/**
 * Importa el punto de entrada y devuelve lo que pasó a runDev.
 * @param {number} code código que devuelve el runDev simulado
 */
async function importEntry(code) {
  runDev.mockResolvedValue(code);
  await import('../scripts/dev.js');
  const [options] = runDev.mock.calls[0] ?? [];
  if (options === undefined) throw new Error('runDev no fue llamado');
  return options;
}

describe('scripts/dev.js (punto de entrada de npm run dev)', () => {
  /** @type {typeof process.exitCode} */
  let previousExitCode;

  beforeEach(() => {
    previousExitCode = process.exitCode;
    runDev.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
  });

  it('RF-I5: importar scripts/dev.js llama a runDev una vez con la raíz y la plataforma reales', async () => {
    const { root, platform, deps } = await importEntry(0);
    expect(runDev).toHaveBeenCalledTimes(1);
    expect(root).toBe(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
    expect(platform).toBe(process.platform);
    expect(deps.env).toBe(process.env);
    expect(deps.execPath).toBe(process.execPath);
  });

  it('RF-I5: propaga el código de runDev a process.exitCode (caso límite: código distinto de 0)', async () => {
    await importEntry(1);
    expect(process.exitCode).toBe(1);
  });

  it('RF-I7: onSignal registra SIGINT y SIGTERM y la función devuelta los retira', async () => {
    const { deps } = await importEntry(0);
    const handler = vi.fn();
    const count = () => [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const [intBefore = 0, termBefore = 0] = count();
    const dispose = deps.onSignal(handler);
    expect(count()).toEqual([intBefore + 1, termBefore + 1]);
    process.emit('SIGINT');
    process.emit('SIGTERM');
    expect(handler).toHaveBeenCalledTimes(2);
    dispose();
    expect(count()).toEqual([intBefore, termBefore]);
  });

  it('RF-I5: las dependencias reales escriben en stdout y comprueban archivos de verdad', async () => {
    const { deps } = await importEntry(0);
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    deps.write('[dev] hola\n');
    expect(stdout).toHaveBeenCalledWith('[dev] hola\n');
    expect(deps.fileExists(process.cwd())).toBe(true);
    expect(deps.fileExists(path.join(process.cwd(), 'no-existe-nunca'))).toBe(false);
    for (const name of ['isPortFree', 'startChild', 'killTree']) expect(typeof deps[name]).toBe('function');
  });
});
