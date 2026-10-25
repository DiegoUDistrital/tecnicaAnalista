const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];

export interface DevelopmentDatabase {
  databaseUrl?: string | undefined;
  dbName?: string | undefined;
}

// Devuelve el nombre de la base de una URL o undefined si no es una URL de conexión válida.
function databaseOf(url: string): { host: string; name: string } | undefined {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.slice(1));
    // new URL devuelve los hosts IPv6 entre corchetes: se normalizan.
    const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1');
    return name === '' ? undefined : { host, name };
  } catch {
    return undefined;
  }
}

function developmentNameOf(databaseUrl: string | undefined): string | undefined {
  return databaseUrl === undefined || databaseUrl === '' ? undefined : databaseOf(databaseUrl)?.name;
}

/**
 * Aborta si las URL de pruebas pueden apuntar a una base que no sea la de pruebas local.
 * Los mensajes son fijos: nunca incluyen la URL, el host ni la contraseña.
 */
export function assertSafeTestDatabase(testUrls: readonly string[], development: DevelopmentDatabase): void {
  const databases = testUrls.map(databaseOf);
  if (databases.some((database) => database === undefined)) {
    throw new Error('Guarda de pruebas: una URL TEST_* no es una URL de conexión válida con nombre de base.');
  }
  const valid = databases as { host: string; name: string }[];
  if (valid.some((database) => !LOCAL_HOSTS.includes(database.host))) {
    throw new Error('Guarda de pruebas: las URL TEST_* deben apuntar a un host local.');
  }
  const name = valid[0]?.name;
  if (name === undefined || valid.some((database) => database.name !== name)) {
    throw new Error('Guarda de pruebas: las tres URL TEST_* deben usar la misma base.');
  }
  if (!name.endsWith('_test')) {
    throw new Error('Guarda de pruebas: el nombre de la base de pruebas debe terminar en _test.');
  }
  if (name === development.dbName || name === developmentNameOf(development.databaseUrl)) {
    throw new Error('Guarda de pruebas: la base de pruebas no puede ser la de desarrollo.');
  }
}
