import { defineConfig } from 'prisma/config';

/**
 * Configuración del CLI de Prisma del frontend (solo `db pull` y `generate`; el frontend no migra).
 * La URL del rol `reader` llega por entorno. Se lee directamente de `process.env` y no con el ayudante `env()`:
 * `env()` lanza si falta la variable y `prisma generate` (que corre en `postinstall` y en el `build`) no la necesita.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: process.env['READER_DATABASE_URL'] ?? '' },
});
