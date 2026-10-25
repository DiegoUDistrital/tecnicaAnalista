import { describe, expect, it } from 'vitest';
import { assertSafeTestDatabase } from '../helpers/database-guard';

const SENTINEL = 'sentinel-pw-9';
const url = (user: string, host: string, db: string): string => `postgresql://${user}:${SENTINEL}@${host}/${db}`;
const valid = (host = '127.0.0.1:5433', db = 'todo_app_test'): string[] => [
  url('writer', host, db),
  url('owner', host, db),
  url('reader', host, db),
];
const development = { databaseUrl: url('writer', '127.0.0.1:5433', 'todo_app'), dbName: 'todo_app' };

describe('RNF-4: guarda de la base de pruebas', () => {
  it('RNF-4: acepta tres URL locales con la misma base terminada en _test', () => {
    expect(() => assertSafeTestDatabase(valid(), development)).not.toThrow();
  });

  it('RNF-4: acepta localhost y [::1]', () => {
    expect(() => assertSafeTestDatabase(valid('localhost:5433'), development)).not.toThrow();
    expect(() => assertSafeTestDatabase(valid('[::1]:5433'), development)).not.toThrow();
  });

  it('RNF-4: acepta que no estén definidos DATABASE_URL ni DB_NAME', () => {
    expect(() => assertSafeTestDatabase(valid(), {})).not.toThrow();
  });

  it('RNF-4: rechaza una base sin el sufijo _test', () => {
    expect(() => assertSafeTestDatabase(valid('127.0.0.1:5433', 'todo_app'), {})).toThrow();
  });

  it('RNF-4: rechaza una base igual a la de DATABASE_URL', () => {
    const dev = { databaseUrl: url('writer', '127.0.0.1:5433', 'todo_app_test') };
    expect(() => assertSafeTestDatabase(valid(), dev)).toThrow();
  });

  it('RNF-4: rechaza una base igual a DB_NAME', () => {
    expect(() => assertSafeTestDatabase(valid(), { dbName: 'todo_app_test' })).toThrow();
  });

  it('RNF-4: rechaza un host remoto en cualquiera de las tres URL', () => {
    for (let index = 0; index < 3; index += 1) {
      const urls = valid();
      urls[index] = url('writer', 'db.example.com:5432', 'todo_app_test');
      expect(() => assertSafeTestDatabase(urls, development)).toThrow();
    }
  });

  it('RNF-4: rechaza bases distintas entre las tres URL', () => {
    const urls = valid();
    urls[2] = url('reader', '127.0.0.1:5433', 'otra_test');
    expect(() => assertSafeTestDatabase(urls, development)).toThrow();
  });

  it('RNF-4: rechaza una URL malformada', () => {
    const urls = valid();
    urls[1] = 'esto no es una url';
    expect(() => assertSafeTestDatabase(urls, development)).toThrow();
  });

  it('RNF-4: rechaza una URL sin nombre de base', () => {
    const urls = valid();
    urls[0] = `postgresql://writer:${SENTINEL}@127.0.0.1:5433`;
    expect(() => assertSafeTestDatabase(urls, development)).toThrow();
  });

  it('RNF-4: el mensaje de error es fijo y no contiene ninguna URL ni la contraseña', () => {
    const attempts: [string[], { databaseUrl?: string; dbName?: string }][] = [
      [valid('127.0.0.1:5433', 'todo_app'), {}],
      [valid('db.example.com:5432'), development],
      [valid(), { dbName: 'todo_app_test' }],
      [['esto no es una url', ...valid().slice(1)], development],
    ];
    for (const [urls, dev] of attempts) {
      let message = '';
      try {
        assertSafeTestDatabase(urls, dev);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe('');
      expect(message).not.toContain(SENTINEL);
      expect(message).not.toContain('postgresql://');
      expect(message).not.toContain('example.com');
      expect(message).not.toContain('todo_app');
    }
  });
});
