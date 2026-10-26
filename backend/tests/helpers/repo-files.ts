import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Una instrucción de un Dockerfile, con la etapa (`FROM ... AS nombre`) a la que pertenece. */
export interface Instruction {
  stage: string | null;
  name: string;
  args: string;
}

/** Vitest se ejecuta desde backend/: la raíz del repositorio es la carpeta superior. */
export function repoRoot(): string {
  return resolve(process.cwd(), '..');
}

export function readRepoText(relativePath: string): string {
  return readFileSync(resolve(repoRoot(), relativePath), 'utf8');
}

/** Une las líneas que terminan en `\`, ignora comentarios y líneas vacías, y asigna la etapa a cada instrucción. */
export function parseDockerfile(text: string): Instruction[] {
  const joined = text.replace(/\\[ \t]*\r?\n/g, ' ');
  const instructions: Instruction[] = [];
  let stage: string | null = null;
  for (const rawLine of joined.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const [first = '', ...rest] = line.split(/\s+/);
    const name = first.toUpperCase();
    const args = rest.join(' ');
    if (name === 'FROM') {
      const alias = /\sAS\s+(\S+)$/i.exec(args);
      stage = alias?.[1]?.toLowerCase() ?? null;
    }
    instructions.push({ stage, name, args });
  }
  return instructions;
}

export function stagesOf(instructions: Instruction[]): Map<string, Instruction[]> {
  const stages = new Map<string, Instruction[]>();
  for (const instruction of instructions) {
    if (instruction.stage === null) continue;
    stages.set(instruction.stage, [...(stages.get(instruction.stage) ?? []), instruction]);
  }
  return stages;
}

/** Lee `engines.node` del package.json de un paquete (por ejemplo `backend/package.json`). */
export function nodeEngines(relativePackageJson: string): string {
  const parsed = JSON.parse(readRepoText(relativePackageJson)) as { engines?: { node?: string } };
  const engines = parsed.engines?.node;
  if (engines === undefined) throw new Error(`${relativePackageJson}: falta engines.node`);
  return engines;
}

/**
 * Indica si una versión mayor de Node cumple `engines.node`. Solo admite los formatos `^X.y.z` y `>=X.y.z`
 * unidos por `||`; ante cualquier otro formato lanza, para no pasar en silencio.
 */
export function satisfiesEngines(major: number, engines: string): boolean {
  return engines.split('||').some((alternative) => {
    const match = /^\s*(\^|>=)(\d+)\.\d+\.\d+\s*$/.exec(alternative);
    if (match === null) throw new Error(`Formato de engines no admitido: «${alternative.trim()}»`);
    const bound = Number(match[2]);
    return match[1] === '^' ? major === bound : major >= bound;
  });
}
