import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as PackageJson;

describe('package.json', () => {
  it('RF-F24: dev y start fijan -p 3001 y -H 127.0.0.1', () => {
    for (const name of ['dev', 'start']) {
      expect(pkg.scripts[name]).toMatch(/ -p 3001\b/);
      expect(pkg.scripts[name]).toMatch(/ -H 127\.0\.0\.1\b/);
    }
  });

  it('RF-F28: existen lint, format, typecheck, test (con --coverage) y build', () => {
    for (const name of ['lint', 'format', 'typecheck', 'test', 'build']) {
      expect(pkg.scripts[name]).toBeTruthy();
    }
    expect(pkg.scripts['test']).toContain('--coverage');
  });

  it('RF-F28: package.json no tiene dependencias con ^ ni ~ ni prefijo NEXT_PUBLIC_ en scripts', () => {
    const versions = [...Object.values(pkg.dependencies), ...Object.values(pkg.devDependencies)];
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) {
      expect(version).not.toMatch(/^[\^~]/);
    }
    for (const script of Object.values(pkg.scripts)) {
      expect(script).not.toContain('NEXT_PUBLIC_');
    }
  });
});
