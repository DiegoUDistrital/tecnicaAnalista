# To-Do App

Prueba Técnica para Analista de Desarrollo.

Estado: en construcción

## Descripción

Aplicación de lista de tareas (To-Do) con backend en Express, base de datos PostgreSQL y frontend en Next.js.
Permite crear, listar, editar, completar y eliminar tareas, y filtrarlas por estado (todas, completadas, pendientes).
El énfasis del proyecto está en la seguridad y en el mínimo privilegio.

## Tecnologías utilizadas

Las versiones se fijan al crear cada proyecto.

- Node.js
- Express
- PostgreSQL
- Next.js 15+ (App Router)
- Prisma
- TypeScript
- Tailwind CSS
- Vitest
- ESLint y Prettier
- Docker

## Estructura del repositorio

- `backend/`: paquete del backend con TypeScript; contiene Prisma (esquema y migraciones) y, en los siguientes PR, el servicio HTTP con Express.
- `frontend/`: aplicación Next.js con TypeScript y Tailwind (próximamente).
- `docker-compose.dev.yml` y `docker/postgres/init/`: PostgreSQL de desarrollo y script de roles y bases.
- `docker-compose.yml`: orquestación de los servicios (próximamente).
- `backend/queries.sql`: consultas SQL de la prueba.

## Backend (estado actual)

Este PR deja el paquete del backend preparado (TypeScript estricto, ESLint, Prettier, Vitest con cobertura mínima
del 95 %) y Prisma configurado para las migraciones. Express ya está instalado y existe la función que construye la aplicación; el servicio se arranca con `npm start`.

Comandos disponibles (dentro de `backend/`):

- `npm run lint`: ESLint y comprobación de formato con Prettier.
- `npm run format`: aplica Prettier a los archivos.
- `npm run typecheck`: comprobación de tipos con `tsc` sin generar archivos.
- `npm test`: tests con Vitest y cobertura (falla por debajo del 95 %).
- `npm run build`: compila a `backend/dist`.
- `npm start`: compila y arranca el servicio con el `.env` de la raíz (ver «Cómo ejecutar»).
- `npm run db:deploy`: aplica las migraciones y los permisos (ver «Migrar y aplicar permisos»).

## Base de datos de desarrollo

PostgreSQL 16 se levanta con Docker (`docker-compose.dev.yml`, solo para desarrollo y pruebas; el despliegue se
documenta más adelante). Hace falta Docker Desktop en marcha.

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

## Logs

El backend escribe los logs como una línea JSON por registro (`level`, `event`, `time` y, si procede, campos de
contexto). Solo se escriben campos de una lista permitida y de valor simple (`host`, `port`, `signal`, `exitCode` y
`timeoutMs`): nunca contraseñas, URL de conexión, API key, cuerpos de petición ni datos de usuario. De un error se
registra la clase, el SQLSTATE (o el código de sistema, como `EPIPE`) y una traza construida solo con marcos de pila,
sin el texto del mensaje. El mensaje solo se registra en los errores propios del proyecto y en los de base de datos
fuera de la clase 22 (datos inválidos), cuyo mensaje puede contener el valor enviado por el usuario. Lo que se lance y
no sea un `Error` solo deja su tipo.

Límite conocido: si un componente modificara el mensaje de un error DESPUÉS de crearlo, la traza podría conservar un
valor que imite un marco de pila completo (ruta absoluta, línea y columna). No ocurre con `pg`.

## Rutas del servicio

`GET /health` responde `200 {"status":"ok"}`. Solo indica que el proceso responde: NO consulta la base de datos, así
que no detecta una base de datos caída. Ignora el cuerpo, las cabeceras (`Content-Type`, `Content-Encoding`,
`Authorization`, `If-None-Match`...) y la cadena de consulta (`/health?x=1` también da 200). El servicio no envía ETag
ni `X-Powered-By`, y nunca responde `304`.

Las rutas se distinguen exactamente: `/Health` y `/health/` no existen y dan `404 NOT_FOUND`, igual que cualquier ruta
desconocida (con cualquier método; una codificación porcentual inválida en una ruta inexistente también es 404, no
400). Un método no permitido en una ruta que sí existe da `405 METHOD_NOT_ALLOWED` con la cabecera `Allow` (por
ejemplo `Allow: GET` en `/health`). Esto incluye HEAD y OPTIONS: el servicio no los responde por su cuenta. Los 404 y
405 usan el mismo sobre JSON del contrato de errores y no se registran en el log.

## Contrato de errores

Todo error sale como `{"error":{"code","message","details"}}` con `Content-Type: application/json; charset=utf-8`.
`details` es siempre un arreglo: vacío salvo en el 400, donde lleva entradas `{field, message}`.

| Estado | `code`                   | `message`                                         |
| ------ | ------------------------ | ------------------------------------------------- |
| 400    | `VALIDATION_ERROR`       | Datos inválidos.                                  |
| 404    | `NOT_FOUND`              | Recurso no encontrado.                            |
| 405    | `METHOD_NOT_ALLOWED`     | Método no permitido.                              |
| 413    | `PAYLOAD_TOO_LARGE`      | El cuerpo de la petición supera el tamaño máximo. |
| 415    | `UNSUPPORTED_MEDIA_TYPE` | Tipo de contenido no admitido.                    |
| 500    | `INTERNAL_ERROR`         | Error interno del servidor.                       |

Un error no previsto (una excepción, una promesa rechazada o cualquier valor lanzado, aunque no sea un `Error`)
devuelve siempre el 500 genérico: nunca SQL, traza, rutas ni valores enviados. El detalle va solo al log como evento
`request_error`, con las reglas de «Logs». Los errores 4xx conocidos no se registran. Si la respuesta ya había empezado
cuando ocurre el fallo, no se escribe una segunda respuesta: se registra el error y se cierra la conexión.

## Conexión a la base de datos

El backend se conecta con un Pool de `pg` y el rol `writer`. El Pool se configura con `max` (conexiones simultáneas),
`idleTimeoutMillis` (cuánto vive una conexión inactiva) y `connectionTimeoutMillis` (cuánto se espera para obtener una
conexión). Los valores por defecto son 10, 30000 y 5000 ms y se cambian en el `.env` (`DB_POOL_MAX`,
`DB_POOL_IDLE_TIMEOUT_MS` y `DB_POOL_CONNECTION_TIMEOUT_MS`). Si una conexión inactiva falla (por ejemplo, el servidor
la cierra), el error se registra en el log y NO tumba el proceso. Los fallos de conexión (servidor caído, plazo
agotado, credenciales rechazadas, sesión terminada o Pool cerrado) se convierten en un error de mensaje fijo, «Base de
datos no disponible.», que no revela host, URL ni texto del driver; los errores de SQL de una consulta (por ejemplo,
una restricción violada) llegan sin cambios. El cierre del Pool espera a que terminen las consultas en curso.

## Variables del servicio

| Variable | Valores | Por defecto | Descripción |
| --- | --- | --- | --- |
| `PORT` | entero 1-65535 | `3000` | Puerto en el que escuchará el servicio. |
| `HOST` | dirección IP literal | `127.0.0.1` | Dirección en la que escuchará el servicio. |
| `SHUTDOWN_TIMEOUT_MS` | entero 1000-120000 | `10000` | Plazo máximo, en milisegundos, del cierre ordenado. |

`0.0.0.0` y `::` escuchan en todas las interfaces y solo deben usarse dentro de la red interna de un contenedor. No
se admiten nombres de host, corchetes ni zonas como `%eth0`. El servicio valida estas variables junto con las de la
base de datos y, si alguna es inválida, no arranca y las nombra todas a la vez, sin mostrar sus valores.

## Esquema y migraciones

La tabla `tasks` se define en `backend/prisma/schema.prisma` y se crea con la migración
`backend/prisma/migrations/<fecha>_create_tasks/migration.sql`. Esa migración NO se generó con `prisma migrate dev`: se
escribió a mano sobre la salida de `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` y se
completó con lo que Prisma no modela (las restricciones `CHECK` y los comentarios del catálogo). El motivo es el mínimo
privilegio: `migrate dev` necesita una base «sombra» temporal, y para crearla el rol `owner` tendría que poder crear
bases de datos, algo que no se le concede.

Restricciones en la base (defensa en profundidad; la API ya valida): título de 1 a 100 caracteres y no formado solo por
espacios (`tasks_title_length`, `tasks_title_not_blank`) y descripción de hasta 500 (`tasks_description_length`).

Nota sobre emojis: la base cuenta caracteres como puntos de código Unicode. Un emoji simple cuenta como 1, pero uno
compuesto (con modificadores o uniones) puede contar como varios.

Detección de deriva (que la base migrada y `schema.prisma` no se desvíen), con la URL de `owner` en la variable de
entorno `OWNER_DATABASE_URL`: `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`
(código 0 = sin diferencias, 2 = hay deriva). Los tests lo ejecutan contra la base de pruebas ya migrada y comprueban
con una columna añadida a mano que la deriva se detecta.

La vista `task_counts` (conteo de tareas por estado) se crea con una segunda migración,
`backend/prisma/migrations/<fecha>_create_task_counts_view/migration.sql`, también escrita a mano. No se modela en
`schema.prisma` (en Prisma las vistas siguen siendo una función en preview) y, aun así, la detección de deriva no
muestra diferencias. La vista se ejecuta con los privilegios de su propietario (`owner`), sin `security_invoker`: así el
rol `reader` podrá leer los conteos sin acceso a la tabla `tasks`. Devuelve `completed` y `total` (entero de 32 bits) y
solo tiene fila para los estados que tienen tareas.

## Consultas SQL (`backend/queries.sql`)

El archivo contiene las dos consultas pedidas por la prueba:

1. Tareas filtradas por estado (`completed`), de la más reciente a la más antigua (desempate por `id`).
2. Cantidad de tareas por estado.

La consulta 2 no lleva parámetros: se pega tal cual en `psql`. La consulta 1 usa el parámetro `$1` (el mismo patrón
parametrizado que utiliza la API, nunca se concatena el valor), por lo que `psql -f backend/queries.sql` no puede
ejecutarla tal cual. Para probarla, abra `psql` dentro del contenedor y use `\bind` (disponible desde `psql` 16, que es
la versión de la imagen):

```
docker compose -f docker-compose.dev.yml exec postgres psql -U owner -d todo_app
todo_app=> SELECT id, title, description, completed, "createdAt" FROM tasks WHERE completed = $1 ORDER BY "createdAt" DESC, id ASC \bind true \g
```

Cambie `true` por `false` para ver las pendientes. Dentro del contenedor, `psql` entra por el socket local sin pedir
contraseña. La base de desarrollo debe estar migrada antes de probarlas.

## Roles y permisos

Hay tres roles de PostgreSQL, cada uno con el mínimo privilegio para su trabajo:

| Rol | Qué puede hacer | Qué NO puede hacer |
|---|---|---|
| `owner` | Es el dueño de la base y de los objetos: migra el esquema y aplica los permisos. | Crear bases ni roles. |
| `writer` | Es el que usa el servicio: `SELECT`, `INSERT`, `UPDATE` y `DELETE` sobre `tasks`. | Leer la vista `task_counts` o `_prisma_migrations`; crear, alterar, eliminar o vaciar objetos. |
| `reader` | Lo usará el frontend: solo `SELECT` sobre la vista `task_counts`. | Leer ni escribir `tasks`; leer `_prisma_migrations`; crear, alterar o eliminar objetos. |

Otras decisiones:

- **PUBLIC (cualquier rol) no tiene ningún privilegio** en la base (ni `CONNECT`, ni `TEMPORARY`, ni `CREATE`) ni en el
  esquema `public`. Solo `writer` y `reader` reciben `CONNECT` y `USAGE`, y nada más. Alternativa descartada: dejar
  `CONNECT` a PUBLIC (el valor por defecto de PostgreSQL), que permitiría conectarse a cualquier rol que se cree en el
  futuro.
- **`reader` lee los conteos sin ver las tareas** porque la vista `task_counts` se ejecuta con los privilegios de su
  propietario (`owner`), no con los de quien la consulta. Alternativa descartada: dar `SELECT` sobre `tasks` a `reader`.
- Las funciones nuevas que cree `owner` no son ejecutables por PUBLIC (se revoca el privilegio por defecto) y no hay
  privilegios por defecto para `writer` ni `reader` sobre objetos futuros: un objeto nuevo es inaccesible hasta que se
  conceda por nombre.
- Los permisos viven en `backend/prisma/permissions.sql`, separado de las migraciones: ni uno ni otras contienen
  contraseñas. El script revoca y concede **por nombre de objeto** (nunca «a todo el esquema»), es idempotente y va en
  una sola transacción: si una sentencia falla, no queda ningún cambio a medias.

Qué se verifica con tests contra PostgreSQL real: el estado final de la base y del esquema por rol (consultas al
catálogo), que `owner` cree una tabla y una función nuevas y `writer` y `reader` no accedan a ellas, cada operación
permitida y cada operación prohibida de `writer` y `reader` (las prohibidas fallan con `42501`), que el catálogo de
todas las tablas y vistas (incluida `_prisma_migrations`) coincida exactamente con lo anterior, que ejecutar el script
dos veces deje los privilegios idénticos, que un script que falla a mitad no deje cambios, y que un SQL versionado
no contenga contraseñas.

## Migrar y aplicar permisos

Un único comando, dentro de `backend/`:

```
npm run db:deploy
```

Compila el backend, lee `OWNER_DATABASE_URL` del `.env` de la raíz, ejecuta las migraciones de Prisma y, **solo si
terminan bien**, ejecuta `prisma/permissions.sql`. Termina con código distinto de cero si cualquiera de los dos pasos
falla. Se puede repetir sin riesgo: sin migraciones pendientes no cambia nada.

- El archivo `.env` de la raíz es obligatorio para `npm run db:deploy`: el script usa `node --env-file=../.env` y, si
  el archivo no existe, Node termina con código 9 y no se aplica nada.
- Se usa siempre este comando: para desplegar y también en los tests (el preparador de la base de pruebas llama al
  mismo código).
- Si una migración futura añade una tabla o una vista, hay que ampliar `prisma/permissions.sql` con su revocación y su
  concesión por nombre; si no, ningún rol salvo `owner` podrá usarla.
- Este comando es la única vía donde se usa `owner`. El servicio usa `writer`, y el frontend, `reader`.

## Instalación

Requisitos: Node.js con npm y Docker Desktop. Con la base de datos de desarrollo arriba (ver «Base de datos de
desarrollo») y el `.env` creado:

```powershell
cd backend
npm ci
```

## Arranque

La función de arranque del servicio sigue siempre el mismo orden:

1. Valida la configuración (las variables de «Variables del servicio» y las de la base de datos).
2. Abre el Pool y comprueba la base de datos con una consulta trivial (`SELECT 1`), antes de aceptar peticiones.
3. Escucha en `HOST` y `PORT`.

El servicio «falla rápido»: si la configuración es inválida, la base de datos no responde o no se puede escuchar (puerto
ocupado, permiso denegado), registra el evento `startup_failed` y termina con código 1. Si el Pool ya estaba abierto,
se cierra antes de terminar, dentro del plazo `SHUTDOWN_TIMEOUT_MS`; si el cierre no termina a tiempo se registra
además `shutdown_timeout` y el código sigue siendo 1. Si el cierre del Pool falla, se registra como
`uncaught_exception` y el código sigue siendo 1.

Eventos de log del arranque (con las reglas de «Logs»: nunca contraseñas ni URL de conexión): `startup` (con `host` y
`port`, solo cuando el servidor ya escucha), `startup_failed` (con la clase del error y, si es un error propio como
una configuración inválida, su mensaje con los nombres de las variables, nunca sus valores) y `shutdown_timeout` (con
`timeoutMs`).

Una señal (`SIGTERM` o `SIGINT`) durante el arranque (antes de escuchar, durante la comprobación de la base de datos
o justo al escuchar) aborta el arranque sin aceptar peticiones: si ya se había pedido escuchar, cierra el servidor de
inmediato; después cierra el Pool y termina con código 0, porque es una parada pedida por el operador. Registra
`shutdown_started` y `shutdown_completed`, y no `startup_failed` ni `startup`. Si la base de datos falla por una causa
propia (por ejemplo un error de SQL) mientras se aborta, se registra además `startup_failed` y el código es 1. Una
segunda señal durante el aborto, o tras un fallo de arranque, termina de inmediato con código 1.

Límite conocido: una base de datos caída y una señal casi simultánea terminan con código 0, porque ese fallo es
indistinguible del que provoca el cierre del Pool. Con la base de datos caída y sin señal, el código es 1.

El punto de entrada (`backend/src/index.ts`) solo conecta la función de arranque con el proceso: aplica su código de
salida con `process.exit`. El comando es `npm start` (ver «Cómo ejecutar»).

## Cierre ordenado

Con el servicio en funcionamiento, `SIGTERM` o `SIGINT` inician un único cierre ordenado:

1. El servidor deja de aceptar conexiones nuevas y cierra las conexiones ociosas (keep-alive).
2. Las peticiones en curso terminan con normalidad; su respuesta lleva `Connection: close`, así que su conexión se
   cierra al acabar (también `/health`).
3. Cuando ya no quedan conexiones, se cierra el Pool de la base de datos.

Todo ocurre dentro del plazo `SHUTDOWN_TIMEOUT_MS`. Si el cierre es completo, el servicio registra
`shutdown_started` (con la señal) y `shutdown_completed` (con `exitCode`) y termina con código 0. Si el plazo se
agota (una petición que no termina o un Pool que no cierra), registra `shutdown_timeout`, corta las conexiones que
queden y termina con código 1. Una segunda señal mientras el cierre sigue en curso termina de inmediato con código 1.

En Windows, `SIGTERM` mata el proceso sin ejecutar manejadores; `Ctrl+C` (`SIGINT`) sí los ejecuta. La señal real
se comprueba a mano en Linux; los tests la simulan con un proceso falso.

## Códigos de salida y eventos

Resumen de las once causas de terminación, con su código y los eventos de log que emiten (en orden cronológico):

| Causa | Código | Eventos |
|---|---|---|
| 1. Configuración inválida | 1 | `startup_failed` |
| 2. Base de datos no disponible al arrancar | 1 | `startup_failed` (y `shutdown_timeout` si el Pool no cierra a tiempo) |
| 3. Fallo al escuchar (puerto ocupado, permisos) | 1 | `startup_failed` (y `shutdown_timeout` si el Pool no cierra a tiempo) |
| 4. Señal durante el arranque | 0 | `shutdown_started`, `shutdown_completed` (`exitCode` 0) |
| 5. Señal durante el arranque con fallo propio de la base de datos | 1 | `shutdown_started`, `startup_failed`, `shutdown_completed` (`exitCode` 1) |
| 6. Señal en funcionamiento | 0 | `shutdown_started`, `shutdown_completed` (`exitCode` 0) |
| 7. Plazo de cierre excedido | 1 | `shutdown_started`, `shutdown_timeout` |
| 8. Segunda señal con un cierre en curso | 1 | ninguno adicional |
| 9. Excepción o rechazo en funcionamiento | 1 | `uncaught_exception` o `unhandled_rejection`, `shutdown_started`, `shutdown_completed` (`exitCode` 1) |
| 10. Excepción o rechazo durante el arranque | 1 | `uncaught_exception` o `unhandled_rejection`, `shutdown_started`, `shutdown_completed` (`exitCode` 1) |
| 11. Excepción o rechazo durante un cierre | 1 | `uncaught_exception` o `unhandled_rejection`; el cierre sigue y termina con `shutdown_completed` (`exitCode` 1) |

Si concurren varias causas prevalece el código distinto de cero. Un cierre ordenado iniciado por una causa de código 1
termina con 1 aunque acabe a tiempo.

Una excepción no capturada deja el proceso en un estado incierto: se registra, se cierra de forma ordenada y se
termina con código 1. Las promesas rechazadas dentro de una petición NO llegan aquí: se responden como 500. Durante un
cierre en curso, una excepción o un rechazo solo se registra: el cierre continúa, no cuenta como segunda señal y fuerza
el código final a 1. Lo que se registra de lo lanzado sigue las reglas de «Logs»: si no es un `Error`, solo su tipo.

El frontend se documentará cuando exista.

## Cómo ejecutar

Con el contenedor de PostgreSQL arriba y el `.env` creado (ver «Base de datos de desarrollo»), dentro de `backend/`:

```
npm start
```

`npm start` compila el backend y lo arranca con el `.env` de la raíz (si ese archivo no existe, Node termina con
código 9 y no arranca). Por defecto escucha solo en `127.0.0.1:3000`. `GET /health` responde `{"status":"ok"}`; se
detiene con Ctrl+C (cierre ordenado, código 0).

`/health` solo indica que el proceso responde: no consulta la base de datos, así que no detecta una BD caída. Un
healthcheck de contenedor debe usar GET (HEAD no está permitido).

Aviso de seguridad: por ahora el servicio solo responde `/health`, escucha solo en loopback y NO tiene seguridad (ni
API key, ni límite de peticiones, ni CORS, ni cabeceras de seguridad): la seguridad llega en un PR posterior. No debe
exponerse a ninguna red hasta entonces.

La base de datos se prepara con `npm run db:deploy` (dentro de `backend/`). La aplicación completa se documentará
cuando exista el frontend.

## Pruebas

- Cobertura mínima del 95 % sobre el código propio (backend y frontend).
- Además de los tests se comprueban `lint` y `typecheck`.
- Backend, dentro de `backend/`: `npm test` (con cobertura), `npm run lint`, `npm run typecheck` y `npm run build`.
  Los tests de base de datos necesitan el contenedor arriba y el `.env` (ver «Base de datos de desarrollo»).
  Los tests de proceso compilan el backend en `backend/dist` y lanzan el punto de entrada como proceso hijo. En
  Windows la señal real (SIGTERM) no se prueba: Node no ejecuta manejadores de señal en esa plataforma; se verifica
  a mano en Linux.
- Frontend: se documentará cuando exista.

## Base de datos

Ya implementado: migración documentada de la tabla `tasks` (ver «Esquema y migraciones»), `backend/queries.sql` con
dos consultas escritas a mano (filtro por `completed` y conteo agrupado por estado; ver «Consultas SQL») e índice
sobre `completed` (`tasks_completed_idx`). Justificación honesta del índice: con pocas filas aporta poco beneficio;
se justifica por el patrón de consulta (casi todas las lecturas filtran por estado) y por el crecimiento esperado
de la tabla.

## Despliegue en Ubuntu

Pendiente.

## Decisiones técnicas

Estas decisiones describen el diseño previsto mientras el proyecto está en construcción.

**a) Monorepo con `backend/` y `frontend/`.** Un solo repositorio facilita revisar y versionar todo junto y
mantener coherentes los cambios que afectan a ambas partes. Alternativa descartada: dos repositorios, que
complicarían la revisión y la coordinación sin aportar nada a un proyecto de este tamaño.

**b) Express es el único con permiso de escritura y dueño de las reglas.** Toda escritura pasa por Express, que
valida y aplica las reglas de negocio en un solo lugar. Alternativa descartada: que el frontend escriba en la base
de datos, lo que repartiría las reglas y ampliaría la superficie de ataque.

**c) Tres roles de base de datos con mínimo privilegio.** `owner` ejecuta las migraciones y solo se usa al
desplegar; `writer` (Express) tiene SELECT, INSERT, UPDATE y DELETE solo sobre `tasks`; `reader` solo puede leer
una vista de conteos por estado, sin acceso a `tasks`. Si una credencial se filtra, el daño queda acotado.
Alternativa descartada: un único usuario con todos los permisos.

**d) Prisma en backend y frontend, con papeles distintos.** En el backend, Prisma es dueño del esquema y las
migraciones. En el frontend solo lee los contadores (todas, completadas, pendientes) desde una vista de conteos con
el rol `reader`; su esquema se obtiene con `prisma db pull` y no ejecuta migraciones. Aun con la credencial
filtrada, solo se verían tres números. Express consulta con `pg` y `Pool` y no con Prisma porque se pidieron un
pool explícito y SQL escrito a mano. Alternativa descartada: usar Prisma también para las consultas de Express.

**e) Sin Server Actions.** Las escrituras van desde el cliente a API Routes de Next y de ahí a Express. Hay menos
conceptos que explicar y el recorrido de cada petición es explícito. Alternativa descartada: Server Actions.

**f) API key entre Next y Express.** Las API Routes de Next se autentican ante Express con una clave aleatoria de
32 bytes o más, enviada en la cabecera `Authorization: Bearer`, comparada con `crypto.timingSafeEqual` y con
respuesta `401` genérica. Es solo de servidor (nunca llega al navegador) y se rota cambiando la variable de
entorno. Limitación: autentica a la aplicación, no a las personas. Es una segunda barrera tras el aislamiento de
red.

**g) Rate limiting.** Con `express-rate-limit` y valores configurables por variables de entorno, protege frente a
abuso y a intentos repetidos con una API key inválida. El contador está en memoria, por lo que solo es válido para
una instancia de Express.

**h) Redis descartado.** No hay un problema de carga que lo justifique y añade un servicio, una credencial y más
superficie de ataque. Se mide la necesidad antes de añadir infraestructura; el `Pool` y el índice cubren la carga
prevista. Queda como trabajo futuro.

**i) Login de usuarios fuera de alcance.** Un login a medias sería peor que ninguno: solo tendría sentido completo
(hash de contraseñas, expiración de tokens, protección CSRF). Queda como trabajo futuro.

**j) Riesgos residuales.** Hay dos credenciales de base de datos en la aplicación (`writer` y `reader`; el daño
posible con `reader` es muy limitado). Además hay dos caminos de lectura: los contadores vía Prisma y la lista vía
Express, que pueden diferir un instante tras una escritura; se resuelve refrescando tras cada acción.

**Nota sobre el historial.** El commit "backend setup con Express y Prisma" abre el backend: Prisma se usa allí para
el esquema y las migraciones, mientras que las consultas de la API se hacen con `pg` y `Pool`.

## Trabajo futuro

- Redis para caché y para un contador de rate limiting compartido entre varias instancias.
- Login de usuarios, implementado de forma completa.
