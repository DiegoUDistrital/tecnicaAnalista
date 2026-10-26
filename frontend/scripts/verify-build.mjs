// Comprueba que `next build` NO depende de la configuración de ejecución (RF-F5, RF-F23).
// Ejecuta la compilación pisando las cuatro variables con cadenas vacías: los valores presentes en el entorno del
// proceso mandan sobre `frontend/.env`, así que el resultado no depende de que exista un `.env` real. Si la compilación
// validara la configuración o abriera una conexión, fallaría. Sale con el mismo código que `next build`.
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { createRequire } from 'node:module';

const VARIABLES = ['BACKEND_URL', 'API_KEY', 'READER_DATABASE_URL', 'ALLOWED_HOSTS'];

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const env = { ...process.env, ...Object.fromEntries(VARIABLES.map((name) => [name, ''])) };

const result = spawnSync(process.execPath, [nextBin, 'build'], { env, stdio: 'inherit' });

if (result.error) {
  process.stderr.write('verify:build: no se pudo ejecutar next build\n');
  process.exit(1);
}
const code = result.status ?? 1;
process.stdout.write(
  code === 0
    ? 'verify:build: OK, next build termina sin ninguna variable de configuración\n'
    : 'verify:build: FALLO, next build no termina sin las variables de configuración\n',
);
process.exit(code);
