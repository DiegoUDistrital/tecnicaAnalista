import { defineConfig, env } from 'prisma/config';

/**
 * Configuración del CLI de Prisma (v7: la URL ya no va en schema.prisma).
 * La URL llega por entorno; el CLI no lee ningún .env por sí solo.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('OWNER_DATABASE_URL') },
});
