import 'server-only';
import { getConfig } from '../config/frontend-config';
import { createLogger } from '../logging/logger';
import type { HandlerDeps } from './handlers';

/** Dependencias reales de las rutas: la configuración del proceso, el registro por `stderr` y el `fetch` global. */
export function defaultDeps(): HandlerDeps {
  return { getConfig, logger: createLogger() };
}
