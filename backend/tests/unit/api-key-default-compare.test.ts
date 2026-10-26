import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

// Se sustituye `timingSafeEqual` por un espía que delega en el real: un import ESM con nombre no se puede espiar
// con `vi.spyOn`, pero `vi.mock` sí intercepta el binding que usa `api-key.ts`.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

import * as crypto from 'node:crypto';
import { createKeyChecker } from '../../src/security/api-key';

describe('RF-G4: comparador por defecto', () => {
  it('RF-G4: sin comparador inyectado se usa crypto.timingSafeEqual con dos Buffer de 32 bytes', () => {
    const key = randomBytes(32).toString('base64url');
    const spy = vi.mocked(crypto.timingSafeEqual);
    spy.mockClear();

    const check = createKeyChecker(key);

    expect(check(key)).toBe(true);
    expect(check(randomBytes(32).toString('base64url'))).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
    for (const [candidate, expected] of spy.mock.calls) {
      expect(Buffer.isBuffer(candidate) && candidate.length).toBe(32);
      expect(Buffer.isBuffer(expected) && expected.length).toBe(32);
    }
  });
});
