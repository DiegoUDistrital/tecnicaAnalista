import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { getConfig } from '../config/frontend-config';
import { PrismaClient } from '../../generated/prisma/client';
import type { ReaderDatabase } from './counters';

// `next dev` vuelve a evaluar los módulos al recargar: el cliente se guarda en `globalThis` para no abrir un pool
// nuevo en cada recarga.
const holder = globalThis as typeof globalThis & { __todoReaderDatabase?: ReaderDatabase };

/**
 * Cliente de Prisma del rol `reader`, creado en la primera lectura (nunca al importar ni en `next build`) con
 * `READER_DATABASE_URL` de la configuración. `log: []` evita que Prisma escriba consultas o errores con datos.
 */
export function getReaderDatabase(): ReaderDatabase {
  holder.__todoReaderDatabase ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: getConfig().readerDatabaseUrl }),
    log: [],
  });
  return holder.__todoReaderDatabase;
}
