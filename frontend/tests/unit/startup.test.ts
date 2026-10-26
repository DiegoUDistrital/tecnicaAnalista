import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const VALID_KEY = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV'.slice(0, 43);
const SENTINEL = 'centinela-valor-secreto-T3-9904';

function setEnv(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    vi.stubEnv(name, value);
  }
}

const VALID_VARIABLES = {
  BACKEND_URL: 'http://127.0.0.1:3000',
  API_KEY: VALID_KEY,
  READER_DATABASE_URL: 'postgresql://reader:change-me@127.0.0.1:5433/todo_app',
  ALLOWED_HOSTS: undefined,
};
const INVALID_VARIABLES = { BACKEND_URL: SENTINEL, API_KEY: undefined, READER_DATABASE_URL: undefined };

/** Importa un instrumentation.ts recién cargado (los módulos se reinician: la configuración recuerda su resultado). */
async function loadRegister(): Promise<() => Promise<void>> {
  vi.resetModules();
  return (await import('../../src/instrumentation')).register;
}

let written: string[] = [];

beforeEach(() => {
  written = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  vi.stubEnv('NEXT_PHASE', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('register (gancho de arranque)', () => {
  it('RF-F23: register lanza con variables inválidas cuando NEXT_RUNTIME es nodejs y el error nombra solo variables', async () => {
    setEnv({ NEXT_RUNTIME: 'nodejs', ...INVALID_VARIABLES });
    const register = await loadRegister();

    const failure = await register().then(
      () => undefined,
      (error: unknown) => error as Error,
    );

    expect(failure?.name).toBe('ConfigError');
    expect(failure?.message).toBe('Configuración del frontend inválida: BACKEND_URL, API_KEY, READER_DATABASE_URL.');
    expect(failure?.message).not.toContain(SENTINEL);
    const output = written.join('');
    expect(output).toContain('"event":"config_invalid"');
    expect(output).not.toContain(SENTINEL);
  });

  it('RF-F23: register no lanza ni lee la configuración en el runtime edge', async () => {
    setEnv({ NEXT_RUNTIME: 'edge', ...INVALID_VARIABLES });
    const register = await loadRegister();

    await expect(register()).resolves.toBeUndefined();
    expect(written).toEqual([]);
  });

  it('RF-F23: register no lanza sin NEXT_RUNTIME', async () => {
    setEnv({ NEXT_RUNTIME: undefined, ...INVALID_VARIABLES });
    const register = await loadRegister();

    await expect(register()).resolves.toBeUndefined();
  });

  it('RF-F23: register no valida durante next build (NEXT_PHASE de compilación) aunque falten las variables', async () => {
    setEnv({ NEXT_RUNTIME: 'nodejs', NEXT_PHASE: 'phase-production-build', ...INVALID_VARIABLES });
    const register = await loadRegister();

    await expect(register()).resolves.toBeUndefined();
    expect(written).toEqual([]);
  });

  it('RF-F23: register no lanza en nodejs con variables válidas', async () => {
    setEnv({ NEXT_RUNTIME: 'nodejs', ...VALID_VARIABLES });
    const register = await loadRegister();

    await expect(register()).resolves.toBeUndefined();
    expect(written).toEqual([]);
  });
});
