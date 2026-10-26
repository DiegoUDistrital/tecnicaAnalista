# Desarrollo local

[← README](../README.md)

## Instalación

Esta sección es para desarrollar (para solo ver la aplicación, ver «Arranque rápido»). Requisitos: Node.js con npm
(versiones en «Versiones usadas») y Docker Desktop (en Linux, Docker Engine con el plugin de Compose). Con la base de
datos de desarrollo arriba (ver «Base de datos de desarrollo») y el `.env` creado:

```powershell
cd backend
npm ci
```

La raíz del repositorio tiene su propio `package.json`, solo con herramientas de desarrollo (Vitest, ESLint, Prettier,
TypeScript y `@types/node`, todas con versión exacta). Sirve para escribir y comprobar los scripts de la raíz
(`scripts/`) con las mismas garantías que el resto. Desde la raíz se ejecutan:

- `npm run dev`: arranque conjunto (ver «Arranque conjunto»).
- `npm run lint`, `npm run format`, `npm run typecheck` y `npm test` (con cobertura mínima del 95 % sobre `scripts/`).
- `npm run test:integration`: pruebas con procesos reales (un Express sustituto y `next start`, y el arranque conjunto
  con un `.env` inválido); no usan la base de datos.

Se instala con `npm ci` en la raíz.

Por qué un `package.json` propio: una sola forma de comprobar los scripts y ninguna herramienta extra para lanzar
procesos (no se usa `concurrently`). Alternativa descartada: reutilizar las herramientas del frontend, porque ataría los
scripts de la raíz a un paquete que no les pertenece.

## Arranque conjunto

Un solo comando desde la raíz levanta la base de datos, el backend y el frontend:

```powershell
npm run dev
```

Qué hace, en este orden:

1. Comprueba que existen `.env`, `frontend/.env` y las dependencias de `backend/` y `frontend/`, y que los puertos 3000
   y 3001 están libres. Si algo falta o está ocupado, lo dice (con el nombre del archivo o del puerto, nunca valores) y
   termina con código 1 sin lanzar nada.
2. Levanta PostgreSQL con `docker compose -f docker-compose.dev.yml up -d --wait` (el puerto de la base de datos es el
   5433). Si ya está levantado, no lo recrea.
3. Compila el backend.
4. Arranca el backend en `127.0.0.1:3000` y el frontend (`next dev`) en `127.0.0.1:3001`. Los puertos son fijos: el
   backend recibe `PORT` y `HOST` desde el script y estos mandan sobre lo que diga el `.env`.

La salida de cada proceso lleva un prefijo (`[db]`, `[backend]`, `[frontend]`; el propio script usa `[dev]`). Si algún
proceso termina o falla, se detiene el otro y el código es 1. Con Ctrl+C se detienen el backend y el frontend y el
código es 0.

Lo que NO hace, y por qué:

- **No instala dependencias** y no copia los `.env`: son pasos de la primera vez (ver abajo), y mezclar instalación y
  ejecución hace el arranque lento e imprevisible.
- **No migra la base de datos.** La migración exige el rol `owner`, que no se usa en ejecución (mínimo privilegio): se
  hace aparte con `npm run db:deploy`.
- **No ejecuta `down -v`:** nunca borra el contenedor ni el volumen; las tareas guardadas sobreviven a Ctrl+C.
- **No pasa secretos a los procesos.** Cada hijo recibe un entorno cerrado (solo `PATH` y, en Windows, `SystemRoot`,
  `TEMP` y `TMP`, que Windows necesita para ejecutar programas; ninguna es secreta). El backend lee el `.env` de la
  raíz con `--env-file` y Next lee `frontend/.env` por sí mismo; ningún valor viaja en los argumentos. No se usa shell:
  los hijos son procesos directos de Node.

Decisiones:

- **Un script de Node en la raíz** (`scripts/dev.js`). Alternativas descartadas: `concurrently` (una dependencia más
  para lanzar tres procesos) y tres terminales a mano (se olvidan pasos y puertos).
- **Hijos sin shell**, para que ningún valor se interprete ni quede en una línea de comandos visible.

### Primera vez

Con Docker Desktop en marcha, desde la raíz del repositorio:

```powershell
Copy-Item .env.example .env
Copy-Item frontend/.env.example frontend/.env
```

En Linux o macOS se usa `cp` en lugar de `Copy-Item`. A diferencia del «Arranque rápido» (Docker, un solo `.env`), el
desarrollo usa también `frontend/.env`.

1. Edite `.env` (contraseñas de los roles y `API_KEY`) y `frontend/.env` (`API_KEY` y la contraseña de
   `READER_DATABASE_URL`). La `API_KEY` debe ser **la misma `API_KEY` en los dos archivos**. Genérela una vez con:
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Si no coincide, el backend
   rechaza al frontend y, tras 10 rechazos, bloquea a todos hasta que termina la ventana.
2. Instale las dependencias en los tres paquetes:

   ```powershell
   npm ci
   cd backend; npm ci; cd ..
   cd frontend; npm ci; cd ..
   ```

3. Levante la base de datos: `docker compose -f docker-compose.dev.yml up -d --wait`.
4. Migre y aplique los permisos con el rol `owner` (dentro de `backend/`): `npm run db:deploy`.
5. Solo si cambia el esquema de la base de datos, regenere el del frontend con `prisma db pull` (ver «Contadores y
   Prisma en el frontend»).
6. Desde la raíz: `npm run dev`, y abra `http://127.0.0.1:3001` (el backend queda en `127.0.0.1:3000`).

### Avisos y limitaciones del arranque conjunto

- **Windows: cierre del backend.** Windows no entrega `SIGTERM` a los procesos hijos, así que el script termina el
  árbol de procesos con `taskkill /T /F` y el backend no hace su cierre ordenado (en otras plataformas se envía
  `SIGTERM` y, si no sale a tiempo, `SIGKILL`). Compruebe en el
  Administrador de tareas que no queda ningún proceso `node` huérfano.
- **`next build` y `next dev` comparten carpeta** (`.next`): no ejecute `next build` mientras corre `npm run dev`.
- **Sin login ni HTTPS.** No exponga estos puertos a una red: el frontend y el backend escuchan solo en `127.0.0.1`.
- **Cupo compartido.** Todos los usuarios del frontend comparten el cupo del backend (ver «Cupo compartido por diseño
  (desviación declarada)»).
- **La `API_KEY` distinta** entre `.env` y `frontend/.env` bloquea a todos los usuarios (la IP de la conexión del
  frontend) durante la ventana.

## Cómo ejecutar

Esta sección ejecuta solo el backend. Para la aplicación completa en desarrollo, ver «Arranque conjunto»; en Docker,
«Arranque rápido». Con el contenedor de PostgreSQL arriba y el `.env` creado (ver «Base de datos de desarrollo»), dentro de `backend/`:

```
npm start
```

`npm start` compila el backend y lo arranca con el `.env` de la raíz (si ese archivo no existe, Node termina con
código 9 y no arranca). El `.env` debe tener `API_KEY`; sin ella, o con el valor de ejemplo, el servicio no arranca
(ver «Variables del servicio» para generarla). Por defecto escucha solo en `127.0.0.1:3000`. `GET /health` responde `{"status":"ok"}`; la
API de tareas está en `GET` y `POST` de `/api/tasks` y `PUT` y `DELETE` de `/api/tasks/:id` (ver «API de tareas»). Se detiene con Ctrl+C (cierre ordenado,
código 0).

`/health` solo indica que el proceso responde: no consulta la base de datos, así que no detecta una BD caída. Un
healthcheck de contenedor debe usar GET (HEAD no está permitido).

Aviso de seguridad: el servicio escucha solo en loopback y la API exige API key (`API_KEY` en el `.env`, ver
«Seguridad: API key»). Limita las peticiones por IP (ver «Límite de peticiones»), bloquea la IP tras demasiados fallos
de key (ver «Bloqueo por intentos fallidos») y aplica CORS a un solo origen (`CORS_ORIGIN`, ver «CORS»). `GET /api/tasks`
devuelve como máximo `TASKS_LIST_LIMIT` tareas (ver «Tope de la lista»). Aun así, no debe exponerse a internet: no tiene
HTTPS propio ni login de usuarios. Quien tenga la key puede crear, modificar y borrar tareas.

La base de datos se prepara con `npm run db:deploy` (dentro de `backend/`). Para arrancar la aplicación completa con un
solo comando, ver «Arranque conjunto».

## Base de datos de desarrollo

PostgreSQL 16 se levanta con Docker (`docker-compose.dev.yml`, solo para desarrollo y pruebas; el despliegue completo
está en «Despliegue con Docker Compose»). Hace falta Docker Desktop en marcha.

```powershell
Copy-Item .env.example .env
docker compose -f docker-compose.dev.yml up -d --wait
```

- La primera vez, con el volumen vacío, el script `docker/postgres/init/01-roles-and-databases.sh` crea los roles
  `owner`, `writer` y `reader` (sin pertenencias entre ellos y sin privilegios especiales) y las bases de desarrollo
  y de pruebas (UTF8, propietario `owner`). Los permisos de cada rol se aplican con `npm run db:deploy` (ver «Roles y permisos»).
- **Reinicio de volumen.** El script de roles solo se ejecuta la primera vez, con el volumen vacío. Para empezar de
  cero: `docker compose -f docker-compose.dev.yml down -v` (borra los datos).
- **Contraseñas.** Solo se admiten los caracteres `[A-Za-z0-9._~-]`: otros (`@ : / ' %` y espacios) rompen las URL de
  conexión o el SQL de creación de roles, y el script de inicio se detiene nombrando la variable (nunca su valor).
  Para generar una aleatoria: `node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"`.
  `change-me` es solo un valor de ejemplo. La contraseña de cada rol debe coincidir en su variable `*_PASSWORD` y en
  sus URL de conexión.
- **Solo en tu máquina.** PostgreSQL escucha únicamente en `127.0.0.1` (puerto `DB_LOCAL_PORT`, por defecto 5433):
  no es accesible desde la red.
- **Tests de base de datos.** Necesitan el contenedor arriba y el `.env` presente; si falta algo, fallan con un
  mensaje claro (nunca se omiten en silencio). Una guarda aborta si la base de pruebas no es local o no termina en
  `_test`, para no tocar nunca la base de desarrollo.

### Lista de comprobación manual

La ejecuta quien implementa y la revisa quien revisa; el resto se cubre con tests automáticos.

1. **`.env` ausente.** Crear un archivo vacío (`New-Item $env:TEMP\vacio.env -Force`) y ejecutar
   `docker compose --env-file $env:TEMP\vacio.env -f docker-compose.dev.yml config --quiet`. Debe fallar nombrando
   una variable obligatoria que falta. Si hay variables de PostgreSQL definidas en la sesión la comprobación queda
   falseada: mirar solo los NOMBRES con
   `Get-ChildItem Env: | Where-Object Name -match 'POSTGRES|OWNER|WRITER|READER|DB_' | Select-Object Name`.
   No usar `config` sin `--quiet` con el `.env` real: imprimiría las contraseñas.
2. **Volumen vacío.** `docker compose -f docker-compose.dev.yml down -v`, luego `up -d --wait`, luego
   `docker compose -f docker-compose.dev.yml exec postgres psql -U postgres -c "select rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls from pg_roles where rolname in ('owner','writer','reader')"`
   y `\l` (propietario y codificación de las dos bases). Usar el valor real de `POSTGRES_USER` si no es `postgres`.
3. **Reinicio con volumen existente.** `docker compose -f docker-compose.dev.yml down` (SIN `-v`), `up -d --wait` y
   `docker compose -f docker-compose.dev.yml logs postgres`: no debe volver a ejecutarse el script de inicio
   (aparece el aviso de que el directorio ya contiene una base de datos).

## Base de datos

Incluye: migración documentada de la tabla `tasks` (ver «Esquema y migraciones»), `backend/queries.sql` con
dos consultas escritas a mano (filtro por `completed` y conteo agrupado por estado; ver «Consultas SQL») e índice
sobre `completed` (`tasks_completed_idx`). Justificación honesta del índice: con pocas filas aporta poco beneficio;
se justifica por el patrón de consulta (casi todas las lecturas filtran por estado) y por el crecimiento esperado
de la tabla.

## Detalle de las pruebas

Complementa la sección «Pruebas» del README.

Detalle por paquete:

- Cobertura mínima del 95 % sobre el código propio (backend y frontend).
- Además de los tests se comprueban `lint` y `typecheck`.
- Backend, dentro de `backend/`: `npm test` (con cobertura), `npm run lint`, `npm run typecheck` y `npm run build`.
  Los tests de base de datos y de la API (`backend/tests/api`) usan PostgreSQL real, necesitan el contenedor arriba y el
  `.env` (ver «Base de datos de desarrollo») y reinician el esquema: no se ejecutan a la vez que otro proceso.
  Los tests de proceso compilan el backend en `backend/dist` y lanzan el punto de entrada como proceso hijo. En
  Windows la señal real (SIGTERM) no se prueba: Node no ejecuta manejadores de señal en esa plataforma; se verifica
  a mano en Linux.
- Seguridad: los tests envían una key de prueba (`TEST_API_KEY`, una constante pública definida en
  `backend/tests/helpers/security.ts`) en toda petición que llega a la aplicación, así que los que no tratan de la
  seguridad no la escriben. Para probar una petición sin key se usa el marcador `X-Test-Omit-Key`, que el ayudante
  retira antes de que la vea la aplicación. Los cupos de peticiones de la aplicación de pruebas son altos (10000) y
  `TRUSTED_PROXIES` vale `none`, así que ningún test que no trate de los límites puede recibir un `429`; los que sí
  tratan de ellos (`backend/tests/http/rate-limits.test.ts`) piden cupos pequeños explícitos. Los tests de la
  protección (401, sin registro en el log e inyección SQL con la pila completa) están en
  `backend/tests/http/auth-guard.test.ts`, `backend/tests/http/security-logs.test.ts` y
  `backend/tests/api/sql-injection-stack.test.ts`. El orden de las etapas
  de seguridad con todos los mecanismos activos a la vez (cada par de etapas contiguas) está en
  `backend/tests/http/security-order.test.ts`.
- Cierre ordenado: `backend/tests/process/graceful-exit.test.ts` arranca el servicio compilado en un proceso hijo con un
  proceso falso (un emisor de eventos en lugar del proceso real). El hijo recibe dos `401` y un `429` (el segundo fallo bloquea la IP), emite la señal a
  mano y debe terminar solo, con código 0, sin llamar a `process.exit`. Si quedara un temporizador vivo, el hijo no
  acabaría y el test fallaría por el plazo de 20 segundos.
- Concurrencia: `backend/tests/db/task-repository-write.test.ts` lanza 10 borrados simultáneos de la misma fila (debe
  haber un éxito y nueve «no existe»), y `backend/tests/api/tasks-delete.test.ts` y `tasks-put.test.ts` lanzan dos
  `DELETE` a la vez, dos `PUT` de campos distintos y 50 iteraciones de `PUT` y `DELETE` simultáneos con un Pool de 2
  conexiones (nunca debe haber un `500`). Las pruebas de concurrencia y las de socket crudo dependen del reparto de
  turnos del sistema, así que conviene repetirlas varias veces seguidas
  (`npx vitest run tests/api/tasks-delete.test.ts tests/api/tasks-put.test.ts`, tres veces) para ver que son estables.
- La prueba de humo HTTP (`backend/tests/api/node-http-smoke.test.ts`) envía por socket crudo cabeceras o URL enormes,
  un método desconocido, una petición mal formada, `Content-Length` junto a `Transfer-Encoding` y una ráfaga de 413, y
  comprueba que Node los rechaza (o cierra la conexión) y que el servicio sigue respondiendo después. Es una prueba de
  caracterización: documenta lo que hace Node, no código propio.
- Frontend (`npm test` dentro de `frontend/`): pruebas de las cabeceras de seguridad, de los scripts de `package.json`,
  de la página, de las funciones puras de la interfaz y del cliente interactivo (componentes con Testing Library), con
  Vitest en entorno Node (jsdom solo en las de componentes). Las reglas de ESLint propias (`react/no-danger`, las de
  `@next/next`, las de hooks y la prohibición de importar el servidor desde `src/client/`) se comprobaron una vez con
  archivos de ejemplo que deben fallar y que se borraron después.
