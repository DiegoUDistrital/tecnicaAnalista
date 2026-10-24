import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Carga el .env de la raíz del repositorio (Vitest se ejecuta desde backend/).
// loadEnvFile no pisa variables ya definidas, así que una CI puede inyectarlas sin .env.
const envFile = resolve(process.cwd(), '..', '.env');

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
