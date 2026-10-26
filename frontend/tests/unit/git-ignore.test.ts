import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** Código de salida de `git check-ignore <ruta>` (0 ignorada, 1 no ignorada) o undefined si no se puede usar git. */
function checkIgnore(path: string): number | undefined {
  const result = spawnSync('git', ['check-ignore', '--quiet', path], { cwd: repositoryRoot });
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    return undefined;
  }
  return result.status;
}

describe('git', () => {
  it('RF-F24: git check-ignore reconoce frontend/.env como ignorado y frontend/.env.example como no ignorado', (context) => {
    const ignored = checkIgnore('frontend/.env');
    if (ignored === undefined) {
      process.stderr.write(`SALTADO: no hay repositorio git o no hay el comando git\n`);
      context.skip();
      return;
    }

    expect(ignored).toBe(0);
    expect(checkIgnore('frontend/.env.example')).toBe(1);
  });
});
