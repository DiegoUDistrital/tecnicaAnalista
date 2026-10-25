import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Vitest se ejecuta desde backend/: el Compose está en la raíz del repositorio.
const compose = parse(readFileSync(resolve(process.cwd(), '..', 'docker-compose.dev.yml'), 'utf8')) as {
  services: Record<string, { image: string; ports?: string[]; environment: Record<string, string> }>;
};
const postgres = compose.services['postgres'];

// Referencia obligatoria de Compose: ${NOMBRE:?mensaje}, sin valor literal ni valor por defecto.
const REQUIRED_REFERENCE = /^\$\{([A-Z_]+):\?[^}]+\}$/;

describe('RF-D15 (i): docker-compose.dev.yml', () => {
  it('RF-D15 (i): define solo el servicio postgres', () => {
    expect(Object.keys(compose.services)).toEqual(['postgres']);
  });

  it('RF-D15 (i): la imagen lleva la etiqueta mayor 16 (nunca latest ni sin etiqueta)', () => {
    expect(postgres?.image).toMatch(/^postgres:16([.-].*)?$/);
  });

  it('RF-D15 (i): todo puerto publicado empieza por 127.0.0.1:', () => {
    const ports = postgres?.ports ?? [];
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) {
      expect(port.startsWith('127.0.0.1:')).toBe(true);
    }
  });

  it('RF-D15 (i): cada *_PASSWORD es una referencia obligatoria sin literal ni valor por defecto', () => {
    const entries = Object.entries(postgres?.environment ?? {}).filter(([name]) => name.endsWith('_PASSWORD'));
    expect(entries.map(([name]) => name).sort()).toEqual([
      'OWNER_PASSWORD',
      'POSTGRES_PASSWORD',
      'READER_PASSWORD',
      'WRITER_PASSWORD',
    ]);
    for (const [name, value] of entries) {
      expect(value).toMatch(REQUIRED_REFERENCE);
      expect(value.startsWith(`\${${name}:?`)).toBe(true);
      expect(value).not.toContain(':-');
    }
  });

  it('RF-D15 (i): ninguna variable de entorno lleva un literal ni un valor por defecto', () => {
    for (const value of Object.values(postgres?.environment ?? {})) {
      expect(value).toMatch(REQUIRED_REFERENCE);
      expect(value).not.toContain(':-');
    }
  });
});
