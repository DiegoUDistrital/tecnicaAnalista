import { describe, expect, it } from 'vitest';
import { retryAfterSeconds } from '../../src/security/rate-limit-response';

const WINDOW_MS = 900000;

describe('RF-G10: retryAfterSeconds', () => {
  it.each([
    ['0 ms restantes dan 1', 1000, 1000, 1],
    ['un instante ya pasado da 1', 1000, 5000, 1],
    ['1 ms restante da 1', 1001, 1000, 1],
    ['1000 ms restantes dan 1', 2000, 1000, 1],
    ['1001 ms restantes dan 2', 2001, 1000, 2],
    ['2000 ms restantes dan 2', 3000, 1000, 2],
    ['la ventana completa da ceil(ventana/1000)', 1000 + WINDOW_MS, 1000, 900],
  ])('RF-G10: retryAfterSeconds = max(1, ceil(restante/1000)): %s', (_name, resetAtMs, nowMs, expected) => {
    expect(retryAfterSeconds(resetAtMs, nowMs)).toBe(expected);
  });
});
