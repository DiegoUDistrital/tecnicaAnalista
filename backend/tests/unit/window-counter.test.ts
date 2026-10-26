import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWindowCounter } from '../../src/security/window-counter';

const WINDOW_MS = 1000;
const T0 = new Date('2026-03-01T10:00:00.000Z').getTime();

afterEach(() => {
  vi.useRealTimers();
});

describe('RF-G9: contador de ventana fija', () => {
  it('RF-G9: peek devuelve 0 en una clave nueva y no la crea', () => {
    const counter = createWindowCounter(WINDOW_MS);

    expect(counter.peek('a', T0).count).toBe(0);
    expect(counter.size()).toBe(0);
  });

  it('RF-G9: hit abre la ventana en su primera llamada y las siguientes suman sin moverla', () => {
    const counter = createWindowCounter(WINDOW_MS);

    counter.hit('a', T0);
    counter.hit('a', T0 + 400);
    counter.hit('a', T0 + 900);

    expect(counter.peek('a', T0 + 900)).toEqual({ count: 3, resetAt: T0 + WINDOW_MS });
  });

  it('RF-G9: cada clave tiene su ventana, que empieza con su primer hit', () => {
    const counter = createWindowCounter(WINDOW_MS);

    counter.hit('a', T0);
    counter.hit('b', T0 + 500);

    expect(counter.peek('a', T0 + 500)).toEqual({ count: 1, resetAt: T0 + WINDOW_MS });
    expect(counter.peek('b', T0 + 500)).toEqual({ count: 1, resetAt: T0 + 500 + WINDOW_MS });
  });

  it('RF-G9: la entrada caduca al llegar resetAt y un hit posterior abre una ventana nueva', () => {
    const counter = createWindowCounter(WINDOW_MS);
    counter.hit('a', T0);
    counter.hit('a', T0);

    expect(counter.peek('a', T0 + WINDOW_MS - 1).count).toBe(2);
    expect(counter.peek('a', T0 + WINDOW_MS).count).toBe(0);

    counter.hit('a', T0 + 1500);
    expect(counter.peek('a', T0 + 1500)).toEqual({ count: 1, resetAt: T0 + 1500 + WINDOW_MS });
  });

  it('RF-G9: peek borra la entrada caducada que consulta', () => {
    const counter = createWindowCounter(WINDOW_MS);
    counter.hit('a', T0);

    counter.peek('a', T0 + WINDOW_MS);

    expect(counter.size()).toBe(0);
  });

  it('RF-G9: el barrido elimina las caducadas como máximo una vez por ventana', () => {
    const counter = createWindowCounter(WINDOW_MS);
    counter.hit('a', T0);
    counter.hit('b', T0 + 500);
    expect(counter.size()).toBe(2);

    // 1000 ms después del último barrido: 'a' (caduca en T0+1000) se elimina; 'b' sigue vigente.
    counter.hit('c', T0 + 1000);
    expect(counter.size()).toBe(2);

    // Solo 500 ms desde el último barrido: 'b' ya caducó (T0+1500) pero no se barre todavía.
    counter.hit('d', T0 + 1500);
    expect(counter.size()).toBe(3);

    // Un barrido más (1000 ms): caen 'b' y 'c'.
    counter.hit('e', T0 + 2000);
    expect(counter.size()).toBe(2);
  });

  it('RF-G9: un hit sobre una entrada caducada aún sin barrer abre una ventana nueva con la cuenta en 1', () => {
    const counter = createWindowCounter(WINDOW_MS);
    counter.hit('x', T0); // barrido en T0
    counter.hit('b', T0 + 500); // b vence en T0+1500
    counter.hit('b', T0 + 600);
    counter.hit('y', T0 + 1000); // barrido en T0+1000: b sigue vigente

    // 600 ms desde el último barrido: no se barre, y b (vencida en T0+1500) se reabre en vez de sumar.
    counter.hit('b', T0 + 1600);

    expect(counter.peek('b', T0 + 1600)).toEqual({ count: 1, resetAt: T0 + 1600 + WINDOW_MS });
  });

  it('RF-G9: con el reloj simulado de Date no usa temporizadores (vi.getTimerCount() == 0)', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'setInterval'], now: T0 });
    const counter = createWindowCounter(WINDOW_MS);

    counter.hit('a', Date.now());
    vi.setSystemTime(T0 + 5000);
    counter.hit('b', Date.now());
    counter.peek('a', Date.now());

    expect(vi.getTimerCount()).toBe(0);
  });
});
