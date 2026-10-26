import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { readRepoText } from '../helpers/repo-files';

// Pruebas estáticas: leen .env.example como texto (sin Docker). La sección de despliegue es solo de comentarios.
const raw = readRepoText('.env.example');
const values = parseEnv(raw);

const FRONTEND_HEADER = '# --- Frontend (Next.js) ---';
const DEPLOY_HEADER = '# --- Despliegue con Docker Compose (docker-compose.yml) ---';

/** Texto desde el encabezado de despliegue hasta el final; vacío si el encabezado no existe. */
function deploySection(): string {
  const start = raw.indexOf(DEPLOY_HEADER);
  return start === -1 ? '' : raw.slice(start);
}

/** Colapsa los espacios en blanco (los párrafos del archivo se parten en líneas). */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** Variables nuevas de despliegue: todas van comentadas, así que parseEnv no debe verlas. */
const NEW_VARIABLES = [
  'ALLOWED_HOSTS',
  'BACKEND_MEM_LIMIT',
  'BACKEND_CPUS',
  'BACKEND_PIDS_LIMIT',
  'FRONTEND_MEM_LIMIT',
  'FRONTEND_CPUS',
  'FRONTEND_PIDS_LIMIT',
];

/** Frases que el test de restos de la raíz (tests/docs-leftovers.test.js) prohíbe en .env.example. */
const RETIRED_PHRASES = [
  'cupo compartido hasta la 007',
  'todavía no se envía',
  'despliegue (pendiente)',
  'hasta que el frontend envíe',
  'hasta que el frontend reenvíe',
  'cada persona tiene su cupo y el frontend no consume el de todos',
  'subred fija',
  'contrato para el frontend',
  'debe pasar la ip del usuario',
  'sin conocer la ip real',
  've siempre la ip del servidor del frontend',
  'debe incluir la red desde la que se conecta el servidor del frontend',
  'bloquea la ip del frontend',
];

describe('RF-P16: sección de despliegue de .env.example', () => {
  it('RF-P16: .env.example tiene el encabezado «Despliegue con Docker Compose» después del bloque del frontend', () => {
    const frontendAt = raw.indexOf(FRONTEND_HEADER);
    const deployAt = raw.indexOf(DEPLOY_HEADER);
    expect(frontendAt).not.toBe(-1);
    expect(deployAt).not.toBe(-1);
    expect(deployAt).toBeGreaterThan(frontendAt);
  });

  it('RF-P16: ALLOWED_HOSTS y los seis límites figuran comentados con sus valores por defecto', () => {
    const lines = deploySection().split('\n');
    const expected: Record<string, string> = {
      ALLOWED_HOSTS: 'localhost:3001,127.0.0.1:3001',
      BACKEND_MEM_LIMIT: '512m',
      BACKEND_CPUS: '1.0',
      BACKEND_PIDS_LIMIT: '200',
      FRONTEND_MEM_LIMIT: '768m',
      FRONTEND_CPUS: '1.0',
      FRONTEND_PIDS_LIMIT: '300',
    };
    for (const [name, value] of Object.entries(expected)) {
      expect(lines, name).toContain(`# ${name}=${value}`);
    }
  });

  it('RF-P16: toda línea de la sección es comentario o vacía, así que parseEnv no ve variables nuevas', () => {
    const lines = deploySection()
      .split('\n')
      .filter((line) => line.trim() !== '');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.startsWith('#'), line).toBe(true);
    }
    for (const name of NEW_VARIABLES) {
      expect(Object.keys(values), name).not.toContain(name);
    }
    expect(Object.keys(values).filter((name) => name.endsWith('DATABASE_URL'))).toHaveLength(6);
  });

  it('RF-P15: la sección advierte de que la copia literal (100 y 20) gana sobre la demo (1000 y 200)', () => {
    const text = normalize(deploySection());
    expect(text).toMatch(/\b100\b/);
    expect(text).toMatch(/\b20\b/);
    expect(text).toMatch(/\b1000\b/);
    expect(text).toMatch(/\b200\b/);
    expect(text).toContain('RATE_LIMIT_MAX');
    expect(text).toContain('RATE_LIMIT_POST_MAX');
    expect(text.toLowerCase()).toContain('copia literal');
    expect(text.toLowerCase()).toContain('cupo único compartido');
    expect(text.toLowerCase()).toMatch(/ganan/);
    expect(text.toLowerCase()).toMatch(/borre|borrar/);
  });

  it('RF-P16: la sección explica cómo generar contraseñas y la key (node -e) y que el ejemplo es change-me', () => {
    const text = normalize(deploySection());
    expect(text).toContain('node -e');
    expect(text).toContain("randomBytes(24).toString('base64url')");
    expect(text).toContain("randomBytes(32).toString('base64url')");
    expect(text).toContain('change-me');
  });

  it('RF-P16: la sección dice que las URL de desarrollo no se usan y que varias variables no se pasan', () => {
    const text = normalize(deploySection());
    for (const name of ['DATABASE_URL', 'OWNER_DATABASE_URL', 'READER_DATABASE_URL']) {
      expect(text, name).toContain(name);
    }
    expect(text).toContain('no se usan');
    expect(text).toContain('no se pasan');
    for (const name of ['DB_NAME_TEST', 'HOST', 'PORT', 'TRUSTED_PROXIES', 'SHUTDOWN_TIMEOUT_MS']) {
      expect(text, name).toContain(name);
    }
  });

  it('RF-P16: el archivo no contiene las frases retiradas de la 007 (lista del test de la raíz)', () => {
    const lowered = normalize(raw).toLowerCase();
    for (const phrase of RETIRED_PHRASES) {
      expect(lowered.includes(phrase), phrase).toBe(false);
    }
  });
});
