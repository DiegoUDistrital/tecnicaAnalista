import { describe, expect, it } from 'vitest';
import { readRepoText } from '../helpers/repo-files';

// Lectura estática: el script no se ejecuta aquí (PostgreSQL solo lo corre con el volumen vacío).
const SCRIPT = 'docker/postgres/init/01-roles-and-databases.sh';
const BLOCK_START = 'if [[ -n "${DB_NAME_TEST:-}" ]]; then';

/** Quita las líneas de comentario (las que empiezan por #). */
function codeOf(lines: string[]): string {
  return lines.filter((line) => !line.trim().startsWith('#')).join('\n');
}

/** Separa el código del script en lo que queda fuera del bloque opcional y lo que está dentro de él. */
function split(text: string): { outside: string; block: string } {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === BLOCK_START);
  if (start < 0) return { outside: codeOf(lines), block: '' };
  const endRelative = lines.slice(start + 1).findIndex((line) => line.trim() === 'fi');
  const end = endRelative < 0 ? lines.length : start + 1 + endRelative;
  return { outside: codeOf(lines.slice(0, start)), block: codeOf(lines.slice(start + 1, end)) };
}

const script = readRepoText(SCRIPT);
const { outside, block } = split(script);

describe('RF-P10: script de inicio con base de pruebas opcional', () => {
  it('RF-P10: valida DB_NAME siempre y DB_NAME_TEST solo dentro del bloque opcional', () => {
    expect(script.split('\n')).toContain(BLOCK_START);
    expect(outside).toContain('for name in DB_NAME; do');
    expect(outside).not.toContain('DB_NAME_TEST');
    expect(block).toContain('for name in DB_NAME_TEST; do');
  });

  it('RF-P10: la base de pruebas solo se crea dentro del bloque; DB_NAME y los roles quedan fuera', () => {
    expect(block).toContain('CREATE DATABASE :"db_test" OWNER owner');
    expect(outside).not.toContain('db_test');
    expect(block).not.toContain('CREATE ROLE');
    expect(block).not.toContain('CREATE DATABASE :"db_name"');
    expect(outside).toContain('CREATE DATABASE :"db_name" OWNER owner');
    for (const role of ['owner', 'writer', 'reader']) {
      expect(outside).toMatch(new RegExp(`CREATE ROLE ${role} LOGIN PASSWORD :'${role}_pw'`));
    }
  });

  it('RF-P10: la comprobación de que DB_NAME_TEST termina en _test sigue presente dentro del bloque', () => {
    expect(block).toContain('[[ "$DB_NAME_TEST" == *_test ]]');
    expect(outside).not.toContain('_test ]]');
  });

  it('RF-P10: el script no contiene \\r y .gitattributes impone LF a *.sh', () => {
    expect(script.includes('\r')).toBe(false);
    expect(readRepoText('.gitattributes')).toMatch(/^\*\.sh\s+text\s+eol=lf$/m);
  });

  it('RF-P10: las contraseñas entran con \\getenv (no por -v) y ninguna va escrita en el script', () => {
    expect(outside).toContain('\\getenv owner_pw OWNER_PASSWORD');
    expect(outside).toContain('\\getenv writer_pw WRITER_PASSWORD');
    expect(outside).toContain('\\getenv reader_pw READER_PASSWORD');
    expect(outside).not.toMatch(/\s-v\s/);
    expect(block).not.toMatch(/\s-v\s/);
    expect(script).not.toMatch(/PASSWORD\s+'/);
  });
});
