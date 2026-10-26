/** Estado de una clave: cuántos fallos lleva en su ventana y cuándo termina (ms desde la época). */
export interface WindowEntry {
  readonly count: number;
  readonly resetAt: number;
}

/**
 * Contador de ventana fija por clave. Recibe el instante como parámetro (en producción, `Date.now()`), así que se
 * prueba con un reloj simulado.
 */
export interface WindowCounter {
  /** Entrada vigente de la clave, o `count` 0 si no hay o ya caducó (la caducada se borra). No crea nada. */
  peek(key: string, nowMs: number): WindowEntry;
  /** Suma uno; la primera suma de una ventana la abre y fija su fin (`ahora + ventana`), que ya no se mueve. */
  hit(key: string, nowMs: number): void;
  /** Número de claves guardadas (vigentes o caducadas aún sin barrer); permite comprobar que la memoria se libera. */
  size(): number;
}

const EMPTY: WindowEntry = { count: 0, resetAt: 0 };

/**
 * Crea un contador sin temporizadores: la caducidad es perezosa (`peek` borra la entrada vencida que consulta) y, al
 * sumar, se barren las vencidas de las demás claves como máximo una vez por ventana. Por eso no necesita `shutdown()`
 * ni mantiene vivo el proceso.
 */
export function createWindowCounter(windowMs: number): WindowCounter {
  const entries = new Map<string, { count: number; resetAt: number }>();
  let lastSweepAt = Number.NEGATIVE_INFINITY;

  function sweep(nowMs: number): void {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= nowMs) {
        entries.delete(key);
      }
    }
    lastSweepAt = nowMs;
  }

  return {
    peek(key, nowMs) {
      const entry = entries.get(key);
      if (entry === undefined) {
        return EMPTY;
      }
      if (entry.resetAt <= nowMs) {
        entries.delete(key);
        return EMPTY;
      }
      return { count: entry.count, resetAt: entry.resetAt };
    },
    hit(key, nowMs) {
      if (nowMs - lastSweepAt >= windowMs) {
        sweep(nowMs);
      }
      const entry = entries.get(key);
      if (entry === undefined || entry.resetAt <= nowMs) {
        entries.set(key, { count: 1, resetAt: nowMs + windowMs });
      } else {
        entry.count += 1;
      }
    },
    size: () => entries.size,
  };
}
