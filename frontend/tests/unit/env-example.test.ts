import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/server/config/frontend-config';

const frontendRaw = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
const frontendValues = parseEnv(frontendRaw);
const rootRaw = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
const rootValues = parseEnv(rootRaw);

/** Una key con el formato válido, en lugar del ejemplo. */
const GENERATED_KEY = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV'.slice(0, 43);

describe('frontend/.env.example', () => {
  it('RF-F24: frontend/.env.example tiene exactamente BACKEND_URL, API_KEY y READER_DATABASE_URL y ALLOWED_HOSTS comentada, ninguna NEXT_PUBLIC_', () => {
    expect(Object.keys(frontendValues).sort()).toEqual(['API_KEY', 'BACKEND_URL', 'READER_DATABASE_URL']);
    expect(frontendRaw).toMatch(/^# ALLOWED_HOSTS=localhost:3001,127\.0\.0\.1:3001$/m);
    expect(frontendRaw).not.toContain('NEXT_PUBLIC_');
  });

  it('RF-F24: el ejemplo de API_KEY sigue siendo inválido para parseConfig; BACKEND_URL y READER_DATABASE_URL de ejemplo son válidos', () => {
    const example = { ...frontendValues, API_KEY: GENERATED_KEY };

    expect(() => parseConfig(example)).not.toThrow();
    expect(() => parseConfig(frontendValues)).toThrow(/API_KEY\.$/);
    expect(frontendValues['BACKEND_URL']).toBe('http://127.0.0.1:3000');
    expect(frontendValues['READER_DATABASE_URL']).toMatch(/^postgresql:\/\/reader:/);
  });

  it('RF-F24: frontend/.env.example avisa de que la API_KEY debe ser la del backend y de cómo generarla', () => {
    expect(frontendRaw).toContain('randomBytes(32)');
    expect(frontendRaw).toMatch(/EXACTAMENTE la (misma|del backend)/);
    expect(frontendRaw).toContain('bloquea');
  });
});

describe('.env.example de la raíz', () => {
  it('RF-F24: el CORS_ORIGIN del .env.example de la raíz es http://localhost:3001', () => {
    expect(rootValues['CORS_ORIGIN']).toBe('http://localhost:3001');
  });

  it('RF-F24: el .env.example de la raíz comenta los cupos de demostración sin cambiar los valores reales', () => {
    expect(rootValues['RATE_LIMIT_MAX']).toBe('100');
    expect(rootValues['RATE_LIMIT_POST_MAX']).toBe('20');
    expect(rootRaw).toMatch(/^# RATE_LIMIT_MAX=1000$/m);
    expect(rootRaw).toMatch(/^# RATE_LIMIT_POST_MAX=200$/m);
    expect(rootRaw).toContain('comparten');
  });

  it('RF-F24: el bloque Frontend del .env.example de la raíz remite a frontend/.env.example', () => {
    expect(rootRaw).toContain('frontend/.env.example');
    expect(rootRaw).not.toContain('se completa en la spec correspondiente');
  });
});
