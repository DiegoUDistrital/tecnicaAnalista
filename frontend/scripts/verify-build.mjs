// Comprueba dos cosas sobre `next build`.
// 1) Que NO depende de la configuración de ejecución (RF-F5, RF-F23): compila pisando las cuatro variables con
//    cadenas vacías (los valores presentes en el entorno del proceso mandan sobre `frontend/.env`, así que el
//    resultado no depende de que exista un `.env` real). Si la compilación validara la configuración o abriera una
//    conexión, fallaría.
// 2) Que nada secreto llega al navegador (RF-F21): vuelve a compilar con valores centinela de formato válido y recorre
//    `.next/static` (lo único que se envía al navegador): falla si encuentra un centinela o el NOMBRE de una variable
//    del servidor (señal de que un archivo del navegador la lee).
// Sale con el código de `next build` si falla, y con 1 si encuentra hallazgos.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import process from 'node:process';

const VARIABLES = ['BACKEND_URL', 'API_KEY', 'READER_DATABASE_URL', 'ALLOWED_HOSTS'];
const SENTINELS = {
  BACKEND_URL: 'http://verify-build-backend.sentinel:4000',
  API_KEY: 'verifyBuildSentinelKey0123456789abcdefghijklmnopqrstuvw',
  READER_DATABASE_URL: 'postgresql://reader:verifyBuildSentinelPass@verify-build-db.sentinel:5432/todo',
  ALLOWED_HOSTS: 'verify-build-host.sentinel:3001',
};
const BROWSER_DIRECTORY = join('.next', 'static');

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');

function build(overrides) {
  return spawnSync(process.execPath, [nextBin, 'build'], { env: { ...process.env, ...overrides }, stdio: 'inherit' });
}

function fail(message, code = 1) {
  process.stderr.write(`verify:build: FALLO, ${message}\n`);
  process.exit(code);
}

/** Todos los archivos de una carpeta, de forma recursiva. */
function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesIn(join(directory, entry.name)) : [join(directory, entry.name)],
  );
}

const empty = build(Object.fromEntries(VARIABLES.map((name) => [name, ''])));
if (empty.error) {
  fail('no se pudo ejecutar next build');
}
if (empty.status !== 0) {
  fail('next build no termina sin las variables de configuración', empty.status ?? 1);
}

const withSentinels = build(SENTINELS);
if (withSentinels.error || withSentinels.status !== 0) {
  fail('next build no termina con las variables centinela', withSentinels.status ?? 1);
}

const searched = [...Object.values(SENTINELS), ...VARIABLES.filter((name) => name !== 'ALLOWED_HOSTS')];
const findings = [];
const files = filesIn(BROWSER_DIRECTORY);
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const needle of searched) {
    if (text.includes(needle)) {
      findings.push(`${file}: contiene un valor o nombre de variable del servidor`);
    }
  }
}
if (findings.length > 0) {
  fail(`hay datos del servidor en lo que se envía al navegador:\n${[...new Set(findings)].join('\n')}`);
}
process.stdout.write(
  `verify:build: OK, next build termina sin ninguna variable de configuración y ${files.length} archivos de ` +
    `${BROWSER_DIRECTORY} no contienen centinelas ni nombres de variables\n`,
);
