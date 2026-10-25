import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PRISMA_DIR = resolve(__dirname, '..', '..', 'prisma');
const PERMISSIONS_PATH = join(PRISMA_DIR, 'permissions.sql');

// Una URL de conexión con credenciales: esquema://usuario:clave@host
const CREDENTIALS_URL = /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]*@/i;

/** Devuelve los motivos por los que un SQL versionado no es aceptable (lista vacía = aceptable). */
function findProblems(sql: string): string[] {
  const problems: string[] = [];
  if (/password/i.test(sql)) {
    problems.push('contiene la palabra PASSWORD');
  }
  if (CREDENTIALS_URL.test(sql)) {
    problems.push('contiene una URL de conexión con credenciales');
  }
  return problems;
}

function versionedSqlFiles(): string[] {
  const migrations = readdirSync(join(PRISMA_DIR, 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(PRISMA_DIR, 'migrations', entry.name, 'migration.sql'));
  return [...migrations, PERMISSIONS_PATH];
}

describe('RF-D14: el detector de secretos en SQL (control negativo)', () => {
  it('RF-D14: detecta PASSWORD sin distinguir mayúsculas', () => {
    expect(findProblems("CREATE ROLE x PASSWORD 'a';")).toHaveLength(1);
    expect(findProblems("create role x password 'a';")).toHaveLength(1);
  });

  it('RF-D14: detecta una URL de conexión con credenciales', () => {
    expect(findProblems('-- postgresql://owner:clave@127.0.0.1:5433/todo_app')).toHaveLength(1);
  });

  it('RF-D14: un SQL limpio no da problemas', () => {
    expect(findProblems('GRANT SELECT ON TABLE tasks TO writer;')).toEqual([]);
  });
});

describe('RF-D14: los SQL versionados no contienen secretos', () => {
  const files = versionedSqlFiles();

  it('RF-D14: hay al menos dos migraciones y el script de permisos', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(files.map((file) => [file.slice(PRISMA_DIR.length + 1).replaceAll('\\', '/'), file] as const))(
    'RF-D14: %s no contiene PASSWORD ni URL con credenciales',
    (_name, file) => {
      expect(findProblems(readFileSync(file, 'utf8'))).toEqual([]);
    },
  );
});

describe('RF-D14: forma del script de permisos', () => {
  it('RF-D14: permissions.sql empieza por BEGIN y termina en COMMIT', () => {
    const code = readFileSync(PERMISSIONS_PATH, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('--'));
    expect(code[0]).toBe('BEGIN;');
    expect(code[code.length - 1]).toBe('COMMIT;');
  });
});
