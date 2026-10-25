import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { CONFIG_VARIABLE_NAMES, loadConfig } from '../../src/config/config';

// Vitest se ejecuta desde backend/: el .env.example está en la raíz del repositorio.
const raw = readFileSync(resolve(process.cwd(), '..', '.env.example'), 'utf8');
const values = parseEnv(raw);

const TABLE_VARIABLES = [
  'DATABASE_URL',
  'DB_POOL_MAX',
  'DB_POOL_IDLE_TIMEOUT_MS',
  'DB_POOL_CONNECTION_TIMEOUT_MS',
  'OWNER_DATABASE_URL',
  'READER_DATABASE_URL',
  'TEST_DATABASE_URL',
  'TEST_OWNER_DATABASE_URL',
  'TEST_READER_DATABASE_URL',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'OWNER_PASSWORD',
  'WRITER_PASSWORD',
  'READER_PASSWORD',
  'DB_NAME',
  'DB_NAME_TEST',
  'DB_LOCAL_PORT',
];

describe('RF-D2: .env.example', () => {
  it('RF-D2 (i): CONFIG_VARIABLE_NAMES está contenido en .env.example', () => {
    for (const name of CONFIG_VARIABLE_NAMES) {
      expect(Object.keys(values), name).toContain(name);
    }
  });

  it('RF-D2 (ii): figuran todas las variables de la tabla de la spec', () => {
    for (const name of TABLE_VARIABLES) {
      expect(Object.keys(values), name).toContain(name);
    }
  });

  it('RF-D2 (iii): cada contraseña (suelta o de una URL) es exactamente change-me', () => {
    const passwords = ['POSTGRES_PASSWORD', 'OWNER_PASSWORD', 'WRITER_PASSWORD', 'READER_PASSWORD'];
    for (const name of passwords) {
      expect(values[name], name).toBe('change-me');
    }
    const urlNames = Object.keys(values).filter((name) => name.endsWith('DATABASE_URL'));
    expect(urlNames.length).toBe(6);
    for (const name of urlNames) {
      expect(new URL(values[name] ?? '').password, name).toBe('change-me');
    }
  });

  it('RF-D2 (iv): cargar los valores de .env.example con loadConfig no produce errores', () => {
    expect(() => loadConfig(values)).not.toThrow();
  });

  it('RF-D2 (v): DB_NAME y DB_NAME_TEST cumplen [a-z0-9_]{1,63} y DB_NAME_TEST termina en _test', () => {
    expect(values['DB_NAME']).toMatch(/^[a-z0-9_]{1,63}$/);
    expect(values['DB_NAME_TEST']).toMatch(/^[a-z0-9_]{1,63}$/);
    expect(values['DB_NAME_TEST']).toMatch(/_test$/);
  });

  it('RF-S1: .env.example incluye PORT, HOST y SHUTDOWN_TIMEOUT_MS por defecto y avisa de 0.0.0.0', () => {
    expect(values['PORT']).toBe('3000');
    expect(values['HOST']).toBe('127.0.0.1');
    expect(values['SHUTDOWN_TIMEOUT_MS']).toBe('10000');
    const comment = /((?:^#.*\r?\n)+)HOST=/m.exec(raw)?.[1] ?? '';
    expect(comment).toContain('0.0.0.0');
    expect(comment).toContain('red interna de un contenedor');
  });
});
