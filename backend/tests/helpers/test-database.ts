import { Client } from 'pg';
import { assertSafeTestDatabase } from './database-guard';

export interface TestDatabase {
  ownerClient(): Promise<Client>;
  writerClient(): Promise<Client>;
  readerClient(): Promise<Client>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Falta ${name} en el entorno: copie .env.example a .env en la raíz del repositorio.`);
  }
  return value;
}

// Cada función devuelve un Client ya conectado; quien lo pide debe cerrarlo con end().
async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch {
    // El error del driver puede incluir el host: se sustituye por un texto fijo sin URL.
    throw new Error('No se pudo conectar a la base de pruebas: ¿está arriba el contenedor de PostgreSQL?');
  }
  return client;
}

/** Lee las tres URL TEST_*, aplica la guarda y devuelve conexiones directas de cada rol. */
export function getTestDatabase(): TestDatabase {
  const writerUrl = requireEnv('TEST_DATABASE_URL');
  const ownerUrl = requireEnv('TEST_OWNER_DATABASE_URL');
  const readerUrl = requireEnv('TEST_READER_DATABASE_URL');
  assertSafeTestDatabase([writerUrl, ownerUrl, readerUrl], {
    databaseUrl: process.env['DATABASE_URL'],
    dbName: process.env['DB_NAME'],
  });
  return {
    ownerClient: () => connect(ownerUrl),
    writerClient: () => connect(writerUrl),
    readerClient: () => connect(readerUrl),
  };
}

/** Deja la base de pruebas sin tablas: recrea el esquema public con el rol owner. */
export async function resetSchema(): Promise<void> {
  const owner = await getTestDatabase().ownerClient();
  try {
    await owner.query('DROP SCHEMA public CASCADE');
    await owner.query('CREATE SCHEMA public AUTHORIZATION pg_database_owner');
  } finally {
    await owner.end();
  }
}

/** Vacía la tabla tasks entre pruebas; no hace nada mientras la tabla no exista. */
export async function truncateTasks(): Promise<void> {
  const owner = await getTestDatabase().ownerClient();
  try {
    const exists = await owner.query(`SELECT to_regclass('public.tasks') IS NOT NULL AS found`);
    if ((exists.rows[0] as { found: boolean }).found) {
      await owner.query('TRUNCATE TABLE public.tasks');
    }
  } finally {
    await owner.end();
  }
}
