import 'server-only';
import { getConfig } from './frontend-config';

/** Valida la configuración al arrancar el servidor: lanza `ConfigError` (solo nombres de variables) si es inválida. */
export function validateStartupConfig(): void {
  getConfig();
}
