import { describe, expect, it } from 'vitest';
import { readRepoText } from '../helpers/repo-files';

// Lectura estática: comprueba que el README contiene la lista de comprobación manual completa.
const HEADING = '### Comprobación manual';
const STEP_COUNT = 20;

/** Texto de la sección «Comprobación manual», hasta el siguiente encabezado de nivel 1 a 3. */
function manualSection(readme: string): string {
  const lines = readme.split('\n');
  const start = lines.findIndex((line) => line.trim() === HEADING);
  if (start < 0) return '';
  const endRelative = lines.slice(start + 1).findIndex((line) => /^#{1,3} /.test(line));
  const end = endRelative < 0 ? lines.length : start + 1 + endRelative;
  return lines.slice(start, end).join('\n');
}

/** Bloque de cada paso numerado (`N. **Título**`), desde su línea hasta el siguiente paso o el fin de la lista. */
function stepBlocks(section: string): Map<number, string> {
  const lines = section.split('\n');
  const blocks = new Map<number, string[]>();
  let current: string[] | null = null;
  for (const line of lines) {
    const match = /^(\d+)\. \*\*/.exec(line);
    if (match?.[1] !== undefined) {
      current = [];
      blocks.set(Number(match[1]), current);
    } else if (/^#{1,6} /.test(line)) {
      current = null;
    }
    current?.push(line);
  }
  return new Map([...blocks].map(([number, blockLines]) => [number, blockLines.join('\n')]));
}

const section = manualSection(readRepoText('README.md'));
const steps = stepBlocks(section);
const sectionLines = section.split('\n');

describe('RF-P22: README con la comprobación manual del despliegue', () => {
  it('RF-P22: existe el encabezado «Comprobación manual» con contenido', () => {
    expect(section).not.toBe('');
  });

  it('RF-P22: tiene los 20 pasos numerados, cada uno con su comando y su resultado esperado', () => {
    expect([...steps.keys()]).toEqual(Array.from({ length: STEP_COUNT }, (_, index) => index + 1));
    for (const [number, block] of steps) {
      expect(block, `paso ${number}: bloque de comandos`).toContain('```powershell');
      expect(block, `paso ${number}: resultado esperado`).toMatch(/Esperado/);
    }
  });

  it('RF-P22: la tabla de resultados tiene una fila por paso con un resultado de la lista cerrada', () => {
    expect(section).toMatch(/^\| Paso \| .*\| Resultado \|/m);
    const rows = sectionLines.filter((line) => /^\| \d+\s+\|/.test(line));
    expect(rows).toHaveLength(STEP_COUNT);
    const RESULT_CELL = /^\| \d+\s+\| [^|]+\| (cumple|parcial|no cumple|no ejecutado) +\|/;
    for (const [index, row] of rows.entries()) {
      expect(row, `fila ${index + 1}`).toMatch(new RegExp(`^\\| ${index + 1}\\s+\\|`));
      expect(row, `fila ${index + 1}: resultado`).toMatch(RESULT_CELL);
    }
  });

  it('RF-P22: todos los comandos de Compose llevan -f docker-compose.yml (salvo el listado de proyectos)', () => {
    const commands = sectionLines.filter((line) => /docker compose /.test(line) && !/docker compose ls\b/.test(line));
    expect(commands.length).toBeGreaterThan(20);
    for (const line of commands) expect(line, line).toContain('-f docker-compose.yml');
  });

  it('RF-P22: docker compose config se documenta solo con --quiet', () => {
    expect(section).toContain('config --quiet');
    for (const line of sectionLines.filter((text) => /docker compose .*\bconfig\b/.test(text))) {
      expect(line, line).toContain('config --quiet');
    }
  });

  it('RF-P22: down -v solo aparece con -p todo-app-deploy y con la advertencia de que borra los datos', () => {
    expect(section).toMatch(/docker compose -f docker-compose\.yml down(\s|$)/m);
    const destructive = sectionLines.filter((line) => /\bdown -v\b/.test(line) && /docker compose/.test(line));
    expect(destructive.length).toBeGreaterThan(0);
    for (const line of destructive) expect(line, line).toContain('-f docker-compose.yml -p todo-app-deploy down -v');
    expect(section).toMatch(/BORRA/);
    expect(section).toMatch(/nunca[^.]*desarrollo/i);
  });

  it('RF-P22: indica la versión mínima de Compose comprobada y la nota de SIGTERM', () => {
    expect(section).toContain('v5.3.1');
    expect(section).toContain('SIGTERM');
    expect(section).toContain('shutdown_completed');
  });

  it('RF-P22: ningún comando imprime el contenido de .env', () => {
    const risky = sectionLines.filter((line) => /^(Get-Content|type|cat)\s+(\.\\)?\.env$/.test(line.trim()));
    expect(risky).toEqual([]);
  });
});
