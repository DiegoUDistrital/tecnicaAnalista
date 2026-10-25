import type http from 'node:http';
import type { AppConfig } from '../config/config';
import type { Database } from '../db/pool';
import type { Logger } from '../logging/logger';

/** Lo mínimo que se usa de un servidor HTTP; permite inyectar uno falso (un `EventEmitter`). */
export type ServerLike = Pick<
  http.Server,
  'listen' | 'once' | 'off' | 'on' | 'prependListener' | 'close' | 'closeAllConnections'
>;

/** Lo mínimo que se usa del proceso; permite inyectar un `EventEmitter` en los tests. */
export type ProcessLike = Pick<NodeJS.Process, 'on' | 'off'>;

/** Temporizador inyectable: `setTimer` devuelve la función que lo cancela. */
export interface Timers {
  setTimer(callback: () => void, ms: number): () => void;
}

/** Dependencias del arranque. Los valores por defecto son los reales; los tests inyectan dobles. */
export interface ServerDeps {
  env: Readonly<Record<string, string | undefined>>;
  logger: Logger;
  createDatabase: (config: AppConfig, logger: Logger) => Database;
  createServer: (logger: Logger) => ServerLike;
  process: ProcessLike;
  timers: Timers;
}
