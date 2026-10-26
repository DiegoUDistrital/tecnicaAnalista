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
- helmet 8.3.0 (cabeceras de seguridad)
- PostgreSQL
- Next.js 15+ (App Router)
- Prisma
- TypeScript
- Tailwind CSS
- Vitest
- ESLint y Prettier
- Docker

## Estructura del repositorio

- `backend/`: paquete del backend con TypeScript; contiene Prisma (esquema y migraciones) y el servicio HTTP con Express con la API de tareas (leer, crear, actualizar y borrar), protegido por API key.
- `frontend/`: aplicación Next.js con TypeScript y Tailwind (próximamente).
- `docker-compose.dev.yml` y `docker/postgres/init/`: PostgreSQL de desarrollo y script de roles y bases.
- `docker-compose.yml`: orquestación de los servicios (próximamente).
- `backend/queries.sql`: consultas SQL de la prueba.

## Backend (estado actual)

El paquete del backend usa TypeScript estricto, ESLint, Prettier y Vitest con cobertura mínima del 95 %, y Prisma está
configurado para las migraciones. Express construye la aplicación con `createApp` y el servicio se arranca con
`npm start`.
Hay cuatro endpoints, `GET /api/tasks` (lectura), `POST /api/tasks` (creación), `PUT /api/tasks/:id` (actualización) y
`DELETE /api/tasks/:id` (borrado) (ver «API de tareas»). La API está protegida por API key (ver «Seguridad: API key») y las respuestas llevan cabeceras de `helmet` y
`Cache-Control: no-store` (ver «Seguridad: cabeceras»). Todavía NO tiene límites por IP, CORS ni tope de la lista: no
debe exponerse hasta que se añadan.

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
`timeoutMs`): nunca contraseñas, URL de conexión, API key, cabecera `Authorization`, cuerpos de petición ni datos de usuario. De un error se
registra la clase, el SQLSTATE (o el código de sistema, como `EPIPE`) y una traza construida solo con marcos de pila,
sin el texto del mensaje. El mensaje solo se registra en los errores propios del proyecto y en los de base de datos
fuera de la clase 22 (datos inválidos), cuyo mensaje puede contener el valor enviado por el usuario. Lo que se lance y
no sea un `Error` solo deja su tipo.

Límite conocido: si un componente modificara el mensaje de un error DESPUÉS de crearlo, la traza podría conservar un
valor que imite un marco de pila completo (ruta absoluta, línea y columna). No ocurre con `pg`.

## Rutas del servicio

`GET /api/tasks` se describe en «API de tareas». `GET /health` responde `200 {"status":"ok"}`. Solo indica que el proceso responde: NO consulta la base de datos, así
que no detecta una base de datos caída. Ignora el cuerpo, las cabeceras (`Content-Type`, `Content-Encoding`,
`Authorization`, `If-None-Match`...) y la cadena de consulta (`/health?x=1` también da 200). El servicio no envía ETag
ni `X-Powered-By`, y nunca responde `304`.

`/health` es la única ruta que no pide API key (ver «Seguridad: API key»); todas las demás, existan o no, dan `401`
si la petición no trae la key.

Las rutas se distinguen exactamente: `/Health` y `/health/` no existen y, con key válida, dan `404 NOT_FOUND`, igual que
cualquier ruta desconocida (con cualquier método; una codificación porcentual inválida en una ruta inexistente también
es 404, no 400); sin key dan `401`. Un método no permitido en una ruta que sí existe da `405 METHOD_NOT_ALLOWED` con la cabecera `Allow` (por
ejemplo `Allow: GET` en `/health`). Esto incluye HEAD y OPTIONS: el servicio no los responde por su cuenta. Los 404 y
405 usan el mismo sobre JSON del contrato de errores y no se registran en el log.

## Seguridad: API key

Toda petición, salvo `GET /health`, debe traer `Authorization: Bearer <key>` con la key configurada en `API_KEY`
(ver «Variables del servicio»). Si falta, está mal formada o no coincide, la respuesta es siempre la misma:
`401 {"error":{"code":"UNAUTHORIZED","message":"No autorizado.","details":[]}}` con `WWW-Authenticate: Bearer`. El
texto es idéntico para todas las causas, para no dar pistas a quien prueba claves.

- **Formato estricto.** La cabecera debe aparecer una sola vez, con el esquema `Bearer` (sin distinguir mayúsculas), un
  único espacio y una key de 1 a 128 caracteres de `A-Za-z0-9_-`. Dos cabeceras `Authorization` (aunque sean iguales),
  otros esquemas, dos espacios, un tabulador o la key en la URL o en una cookie dan `401`. `Proxy-Authorization` se
  ignora. Node ya recorta los espacios al principio y al final del valor de una cabecera.
- **Denegar por defecto.** `/health` se registra antes de la guarda y la guarda se aplica a todo lo que se registra
  después, sin comparar rutas: la exención la decide el mismo enrutador que despacha `/health`. Así `/health;x`,
  `//health`, `/%68ealth`, `/Health` y `/health/` no están exentas (dan `401` sin key y `404` con ella) y una ruta nueva
  nace protegida. `/health` sigue su tabla de métodos: `HEAD /health` da `405` con `Allow: GET`, no `401`.
- **Antes de todo lo demás.** La guarda es la etapa 0 de la tubería (ver «Orden de comprobación de una petición»): sin
  key, un `PATCH /api/tasks` da `401` (no `405`), una ruta inexistente da `401` (no `404`), y no se lee el cuerpo ni se
  consulta la base de datos. Así quien no está autorizado no averigua qué rutas ni métodos existen ni gasta recursos
  del servicio. Si la petición trae cuerpo (aunque sea de 20 KB, que con key daría `413`), el `401` lleva
  `Connection: close` y la conexión se cierra al responder; sin cuerpo la conexión se conserva.
- **Sin registro.** Un `401` no escribe nada en el log (no es un fallo del servicio) y la key, buena o mala, nunca
  aparece en los logs ni en las respuestas.
- **Comparación.** Se compara el resumen SHA-256 de la key recibida con el de la configurada, ambos de 32 bytes, con
  `crypto.timingSafeEqual`: ninguna longitud distinta lanza error y el tiempo no depende del contenido.
- **Entropía no verificada.** El servicio comprueba el formato de `API_KEY` y que no sea trivial, pero NO mide su
  entropía. La garantía real viene de generarla con `randomBytes(32)` (comando en «Variables del servicio»).
- **Rotación.** Para cambiar la key se modifica `API_KEY` en el `.env` y se reinicia el servicio. Desde el reinicio, la
  key anterior da `401`. No hace falta tocar nada más.
- **Limitaciones.** La key autentica a la aplicación, no a las personas: quien la tenga puede usar toda la API. El
  servicio no habla HTTPS: el tráfico entre quien llama y el servicio viaja sin cifrar, así que debe ir solo por una
  red interna. No hay login de usuarios (ver «Trabajo futuro»).

## Seguridad: cabeceras

Toda respuesta de la aplicación (también `/health`, los `204` y los errores `401`, `404`, `405`, `413`, `415` y `500`)
lleva las cabeceras de [`helmet`](https://helmetjs.github.io/) 8.3.0 con sus valores por defecto:
`Content-Security-Policy` (`default-src 'self'`, `frame-ancestors 'self'`, `object-src 'none'`, entre otras),
`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`,
`Cross-Origin-Resource-Policy: same-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Origin-Agent-Cluster`,
`Strict-Transport-Security`, `X-DNS-Prefetch-Control: off`, `X-Download-Options: noopen`,
`X-Permitted-Cross-Domain-Policies: none` y `X-XSS-Protection: 0`. `X-Powered-By` no se envía.

- **Por qué valores por defecto.** Son suficientes para una API que solo devuelve JSON y son fáciles de explicar.
  Alternativa descartada: ajustar cada política una a una, que obliga a justificar cada valor y arriesga romper algo
  sin beneficio.
- **`Cache-Control: no-store`.** Lo llevan todas las respuestas salvo `/health`, incluido el `401`: los datos son por
  usuario y no deben guardarse en cachés del navegador ni intermedias. `/health` no es una ruta de la API y no devuelve
  datos, por eso queda fuera.
- **HSTS sin efecto en HTTP simple.** `Strict-Transport-Security` solo lo aplican los navegadores sobre HTTPS; con HTTP
  simple se ignora. Se deja porque es el valor por defecto y no perjudica.
- **`Cross-Origin-Resource-Policy: same-origin`.** Impide que otro origen incruste las respuestas en modo `no-cors`;
  esta API no está pensada para incrustarse, y el frontend la llama desde su servidor.
- **Limitación.** Las respuestas que Node genera antes de que la petición llegue a Express (por ejemplo `431` por
  cabeceras demasiado grandes o una petición mal formada) no pasan por la aplicación y no llevan estas cabeceras.

## IP real del cliente y proxies de confianza

El servicio calcula una «clave de cliente» a partir de la IP de quien llama. Todavía no la usa para limitar
peticiones (eso llega después); este apartado explica cómo se obtiene y cómo se configura.

- **Por qué hace falta.** El navegador no llama a Express: lo hace el servidor del frontend. Para Express, todas las
  peticiones vienen de ese servidor. Si el límite contara su IP, un solo usuario agotaría el cupo de todos. Por eso el
  frontend debe pasar la IP del usuario en `X-Forwarded-For` y Express debe leerla, pero solo cuando se puede creer.
- **Cuándo se cree `X-Forwarded-For`.** Solo si la conexión TCP viene de una dirección de la lista
  `TRUSTED_PROXIES`. Si viene de otra, la cabecera se ignora y cuenta la dirección de la conexión: quien falsifique
  la cabecera desde fuera no evade nada. `Forwarded` y `X-Real-IP` no se leen nunca.
- **Por qué una lista de direcciones.** Alternativas descartadas: `true` (creer a cualquiera: cualquiera falsifica su
  IP) y un número de saltos (depende de cuántos proxies haya y de que ninguno falle). Una lista dice exactamente de
  quién se fía el servicio. Tampoco se usa `req.ip` de Express, que devuelve la última entrada no confiable aunque sea
  basura; el servicio tiene su propio cálculo, con reglas escritas y probadas.
- **Regla de la última entrada no confiable.** Con la conexión de confianza se recorre `X-Forwarded-For` de derecha a
  izquierda, se saltan las direcciones de confianza y decide la primera que no lo es: `X, A` cuenta `A` (cambiar `X`
  no sirve para evadir). Si esa entrada no es una IP válida (`A, basura`), o todas son de confianza
  (`127.0.0.1, 127.0.0.1`), cuenta la dirección de la conexión: falla del lado estricto (un cupo compartido) y nunca
  del permisivo. Una cabecera de más de 512 caracteres se trata como basura.
- **Qué es una IP válida.** Una IP literal en forma canónica: sin zona (`fe80::1%eth0`), sin ceros a la izquierda
  (`010.0.0.1`), sin puerto ni corchetes. Las IPv6 se escriben abreviadas y en minúsculas (la forma larga y la corta
  son la misma) y una IPv4-mapeada (`::ffff:203.0.113.7`) cuenta como la IPv4 (`203.0.113.7`). Un valor mal formado no
  crea claves nuevas: cae en la dirección de la conexión.
- **IPv6 por /64.** Las direcciones IPv6 se agrupan por sus 4 primeros grupos (el /64): quien tiene una red IPv6
  dispone de millones de direcciones y, si cada una contara aparte, evadiría el límite cambiando de dirección.
- **`TRUSTED_PROXIES`.** Lista separada por comas, con espacios opcionales alrededor de cada entrada. Cada entrada es
  un nombre, una IP o una `IP/prefijo`:
  - `loopback`: `127.0.0.0/8` y `::1`.
  - `linklocal`: `169.254.0.0/16` y `fe80::/10`.
  - `uniquelocal`: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` y `fc00::/7`.
  - Prefijo mínimo `/8` en IPv4 y `/7` en IPv6 (así una lista no puede confiar en medio Internet); la máscara larga
    (`10.0.0.0/255.0.0.0`) no se admite. Los nombres distinguen mayúsculas.
  - `none` (solo, en minúsculas) significa que nadie es de confianza: ninguna cabecera influye y cuenta siempre la
    dirección de la conexión.
  - Ausente equivale a `loopback`. Vacía, con entradas vacías (`a,,b`), `true`, `/0`, `None`, `NONE` o cualquier otro
    texto es inválida y el servicio no arranca (el error nombra la variable, nunca su valor).
- **Contrato para el frontend.** Su servidor debe enviar UNA sola IP en `X-Forwarded-For`, la de quien le llama, y
  SOBRESCRIBIR la cabecera (no copiar ni anteponer lo que traiga el navegador).
- **Riesgo.** Si el frontend no envía la cabecera, o `TRUSTED_PROXIES` no incluye la red desde la que se conecta, todos
  los usuarios comparten una misma clave y un solo usuario podría agotar el cupo de todos.

## Contrato de errores

Todo error sale como `{"error":{"code","message","details"}}` con `Content-Type: application/json; charset=utf-8`.
`details` es siempre un arreglo: vacío salvo en el 400, donde lleva entradas `{field, message}`.

| Estado | `code`                   | `message`                                         |
| ------ | ------------------------ | ------------------------------------------------- |
| 400    | `VALIDATION_ERROR`       | Datos inválidos.                                  |
| 401    | `UNAUTHORIZED`           | No autorizado.                                    |
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
| `API_KEY` | 43 a 128 caracteres de `A-Za-z0-9_-`, al menos 10 distintos | (obligatoria) | Clave de la API (secreta). |
| `TRUSTED_PROXIES` | lista de `loopback`, `linklocal`, `uniquelocal`, IP o `IP/prefijo`; o `none` | `loopback` | Direcciones de las que se cree `X-Forwarded-For` (ver «IP real del cliente y proxies de confianza»). |

`API_KEY` se genera con 32 bytes aleatorios, que dan 43 caracteres:

```
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

El servicio comprueba el formato y que la clave no sea trivial (una letra repetida, por ejemplo), pero NO verifica su
entropía: la garantía real viene de generarla con el comando anterior. El valor de ejemplo de `.env.example`
(`change-me-use-randomBytes-32`) no es un secreto y el servicio lo rechaza al arrancar, para que nadie deje la clave
sin cambiar. El `.env` necesita `API_KEY` antes de `npm start`. La clave se valida al arrancar y la API la exige en
cada petición (ver «Seguridad: API key»).

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

## Cómo guarda y lee tareas el backend

Esta es la capa de datos que usa la API (`backend/src/repositories/task-repository.ts`): `GET /api/tasks` lista,
`POST /api/tasks` inserta, `PUT /api/tasks/:id` actualiza y `DELETE /api/tasks/:id` borra.

- Todas las consultas son parametrizadas: los valores (título, descripción, filtro) viajan en el arreglo de parámetros
  de `pg` y nunca se concatenan al texto SQL. Un título como `'); DROP TABLE tasks;--` se guarda tal cual.
- La lista va de la tarea más reciente a la más antigua y desempata por `id` ascendente. El orden usa la marca de tiempo
  completa de la base de datos (con microsegundos), no el texto que se muestra al cliente.
- `createdAt` se entrega en ISO 8601 UTC con milisegundos (`2026-03-04T05:06:07.123Z`). Los microsegundos se truncan
  (no se redondean) en la propia consulta, para que la hora mostrada nunca sea posterior a la almacenada, y no depende
  de la zona horaria de la sesión.
- Hay dos consultas de lista (con y sin filtro `completed`) en lugar de una con condición opcional, para que
  PostgreSQL pueda usar el índice sobre `completed`.
- La lista no tiene paginación: devuelve todas las tareas.
- Actualizar y borrar una tarea son UNA sola sentencia SQL cada una, sin consulta previa. La existencia se decide por las
  filas afectadas: un `DELETE` que borra una fila es un éxito y uno que no encuentra nada es «no existe». Por eso dos
  borrados simultáneos de la misma tarea dan un éxito y un «no existe», y una actualización concurrente con un borrado
  da «actualizada» o «no existe», pero nunca un error del servidor (con un `SELECT` previo habría una carrera entre
  la lectura y la escritura).
- El `UPDATE` solo escribe las columnas enviadas y no reescribe las demás, así que dos actualizaciones simultáneas de
  campos distintos (por ejemplo, título desde una pestaña y estado desde otra) conservan ambos cambios. Los nombres de
  columna salen de una lista fija del código, nunca del cliente; los valores y el identificador viajan solo como
  parámetros. La fila devuelta lleva las mismas cinco columnas y el mismo formato de `createdAt` que la lectura.

## API de tareas

> **Aviso de seguridad.** La API exige API key (cabecera `Authorization: Bearer`, ver «Seguridad: API key»); todavía NO
> tiene límites por IP, CORS ni tope de la lista, y escucha por defecto solo en 127.0.0.1: no debe exponerse a
> ninguna red hasta que se añadan los límites y CORS. Quien tenga la key puede crear, modificar y
> borrar tareas sin límite. Existen la lectura y la creación (`GET` y `POST` en `/api/tasks`), la actualización (`PUT` en
> `/api/tasks/:id`) y el borrado (`DELETE` en `/api/tasks/:id`). Los ejemplos de esta sección omiten la cabecera
> `Authorization` por brevedad: sin ella, todas las rutas dan `401`.

### `GET /api/tasks`

Devuelve `200` con un arreglo JSON de todas las tareas, de la más reciente a la más antigua (con desempate por `id`),
o `[]` si no hay ninguna. No hay paginación. Cada tarea tiene exactamente cinco campos:

```json
{
  "id": "3f1c2d5e-8a0b-4c7d-9e1f-0a2b3c4d5e6f",
  "title": "Comprar pan",
  "description": "",
  "completed": false,
  "createdAt": "2026-03-04T05:06:07.123Z"
}
```

`createdAt` es ISO 8601 UTC con milisegundos (truncados, no redondeados). La respuesta de una lectura correcta es siempre
`200`: el ETag está desactivado y el servicio nunca responde `304`, aunque la petición traiga `If-None-Match`.

Filtro opcional `?completed=true` (solo completadas) o `?completed=false` (solo pendientes):

- Solo se admite el parámetro `completed`, una sola vez y con el valor exacto `true` o `false` (en minúsculas). Repetido,
  vacío, sin valor, en mayúsculas, con otro valor o usado como arreglo (`completed[]=true`) da `400` con `field`
  `completed` («Debe ser true o false.»).
- Cualquier otro parámetro (`?filter=pending`, `?__proto__=x`, `?a[b]=1`...) da `400` con `field` `query` («Parámetros de
  consulta no permitidos.»). El nombre del parámetro nunca se refleja en la respuesta. Si coinciden ambos problemas,
  `details` lleva las dos entradas (`query` primero).
- El nombre y el valor se decodifican una sola vez (porcentaje y `+`): `?completed=%74rue` y `?%63ompleted=true` son
  válidos; `?completed=true%20`, `?completed=%2574rue` y un valor que no se puede decodificar son `400 completed`
  (nunca `500`). `GET /api/tasks?` equivale a no enviar consulta.
- La cadena de consulta se evalúa CRUDA, sin el intérprete de consulta de Express (desactivado): ese intérprete
  descarta claves como `__proto__` y trunca a 1 000 parámetros, así que se podrían colar parámetros sin verlos. Se miran
  todos los parámetros, también más allá del 1 000. Alternativa descartada: usar la consulta ya interpretada (falsos
  negativos silenciosos).
- `GET` no admite cuerpo (400 `body`) y se aplican las reglas de «Entrada de la API».

### `POST /api/tasks`

Crea una tarea. Cuerpo JSON `{ "title": "...", "description": "..." }`: `title` es obligatorio y `description` opcional
(cadena vacía si se omite; `null` no vale). Las reglas de longitud, recorte y caracteres están en «Validación de título
y descripción», y las del cuerpo y las cabeceras en «Entrada de la API». Responde `201` con la tarea creada, con
exactamente los cinco campos y `completed` en `false` (`id` y `createdAt` los genera la base de datos):

```json
{
  "id": "3f1c2d5e-8a0b-4c7d-9e1f-0a2b3c4d5e6f",
  "title": "Comprar pan",
  "description": "",
  "completed": false,
  "createdAt": "2026-03-04T05:06:07.123Z"
}
```

- Se permiten títulos duplicados.
- Cualquier clave que no sea `title` o `description` (`id`, `createdAt`, `completed`, `__proto__`, `constructor`...) da
  `400` con `field` `body` («El cuerpo contiene campos no permitidos.»), sin nombrar los campos.
- `POST` no admite NINGÚN parámetro de consulta, tampoco `completed`: `POST /api/tasks?x=1` da `400` con `field`
  `query`. `POST /api/tasks?` equivale a no enviar consulta.
- Una violación de restricción de la base de datos o una base de datos caída dan `500` genérico (ver abajo).

### `PUT /api/tasks/:id`

Actualiza una tarea. Cuerpo JSON con al menos una de las claves `title`, `description` y `completed` (booleano real).
Solo se escribe lo que se envía; lo que se omite no se toca. Responde `200` con la tarea completa (los mismos cinco
campos; `id` en minúsculas y `createdAt` sin cambios). Las reglas de `title` y `description` son las de «Validación de
título y descripción» (`description` puede ser la cadena vacía) y las del identificador, las de «Reglas del
identificador y del cuerpo de `PUT`».

```
PUT /api/tasks/3f1c2d5e-8a0b-4c7d-9e1f-0a2b3c4d5e6f
{ "completed": true }
```

```json
{
  "id": "3f1c2d5e-8a0b-4c7d-9e1f-0a2b3c4d5e6f",
  "title": "Comprar pan",
  "description": "",
  "completed": true,
  "createdAt": "2026-03-04T05:06:07.123Z"
}
```

- **Actualización parcial.** Es un `PUT` parcial, una desviación consciente del `PUT` puro (reemplazo completo):
  permite completar una tarea enviando solo `{"completed":true}` y evita que una pestaña con datos viejos pise los
  cambios hechos desde otra. Alternativa descartada: exigir el reemplazo completo, que obligaría a reenviar todos los
  campos y pisaría cambios ajenos.
- Un `PUT` idéntico a lo almacenado responde `200`.
- Un identificador con formato válido que no existe da `404 NOT_FOUND` (incluido el UUID nulo).
- El identificador se comprueba antes que la consulta y los campos: si no es un UUID válido la respuesta lleva SOLO la
  entrada `id`, aunque el resto también esté mal. El cuerpo se lee y valida como JSON antes que el identificador
  (un JSON roto da `body`, no `id`).
- `{}` da una entrada `body` («Debe enviar al menos title, description o completed.»); una clave ajena da una sola
  entrada `body` («El cuerpo contiene campos no permitidos.»). Con parámetros de consulta se añade `query`
  (`PUT /api/tasks/<id>?x=1`, incluido `?completed=true`).
- Si el cuerpo es válido pero la tarea no existe y además los campos son inválidos, gana el `400`: la existencia se
  comprueba después de validar.
- Una base de datos caída o una restricción violada dan `500` genérico.
- La ruta de identificador no deja que Express decodifique el segmento: lo lee crudo el código y lo valida una vez. Así
  `GET /api/tasks/%E0%A4%A` da `405` y `PUT /api/tasks/%E0%A4%A` da `400` con `id`, en lugar de un `500`.

### `DELETE /api/tasks/:id`

Borra una tarea. Responde `204` sin cuerpo (ni `Content-Type` ni `Content-Length`). No admite cuerpo ni parámetros de
consulta, y el identificador sigue las reglas de «Reglas del identificador y del cuerpo de `PUT`».

```
DELETE /api/tasks/3f1c2d5e-8a0b-4c7d-9e1f-0a2b3c4d5e6f
```

- Un identificador con formato válido que no existe da `404 NOT_FOUND` (incluido el UUID nulo). Borrar dos veces la
  misma tarea da `204` y luego `404`: el borrado no es idempotente a propósito, para que el cliente sepa si había algo
  que borrar.
- Con cuerpo, el `400` lleva la entrada `body` («Esta ruta no admite cuerpo.»); con `Content-Encoding` distinto de
  `identity` o con cuerpo sin `Content-Type` JSON, `415`; con más de 10 240 bytes, `413`. Con parámetros de consulta
  (`?x=1`) la entrada es `query`. Un identificador inválido da SOLO la entrada `id` (si no hay cuerpo ni problema
  de entrada antes), como en `PUT`.
- **Concurrencia.** La existencia se decide por las filas afectadas de la propia sentencia `DELETE`, sin consulta
  previa. Dos borrados simultáneos de la misma tarea dan exactamente un `204` y un `404`, y un `PUT` concurrente con un
  `DELETE` da `200` o `404`, nunca `500`. Alternativa descartada: consultar primero y borrar después, que tendría una
  carrera entre ambas operaciones.
- Una base de datos caída da `500` genérico. El log no registra el identificador ni ningún dato de la petición.

### Errores 400: formato de `details`

Un `400` lleva `details` con una entrada `{ field, message }` por problema, siempre en el orden `body`, `id`, `query`,
`title`, `description`, `completed` (`id` nunca coincide con otras entradas). Cada campo inválido aporta solo su primer problema (tipo, caracteres, longitud). Los
mensajes son los de la tabla de «Validación de título y descripción», más «El cuerpo debe ser un objeto JSON válido.»,
«Esta ruta no admite cuerpo.» y «El cuerpo no coincide con la longitud declarada.» para `body`. Nunca se refleja el valor
enviado ni el nombre de campos o parámetros desconocidos. Ejemplo, `POST /api/tasks?x=1` con
`{"foo":1,"title":"","description":5}`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Datos inválidos.",
    "details": [
      { "field": "body", "message": "El cuerpo contiene campos no permitidos." },
      { "field": "query", "message": "Parámetros de consulta no permitidos." },
      { "field": "title", "message": "Debe tener entre 1 y 100 caracteres." },
      { "field": "description", "message": "Debe ser una cadena de texto." }
    ]
  }
}
```

Solo la etapa de consulta y campos acumula problemas; las anteriores (ruta y método, tamaño, codificación y tipo,
cuerpo, identificador) devuelven un único error.

### Orden de comprobación de una petición

0. API key (`401`), salvo en `/health`. Va antes que todo lo demás, también que el `404` y el `405`.
1. Ruta y método (`404` si la ruta no existe, `405` con `Allow` si el método no está permitido).
2. Tamaño del cuerpo (`413`).
3. Codificación y tipo de contenido (`415`).
4. Cuerpo: lectura, UTF-8, JSON y objeto raíz (`400` `body`).
5. Identificador, solo en `/api/tasks/:id` (`400` `id`, SOLA).
6. Consulta y campos, acumulando todos los problemas (`400`).
7. Existencia de la tarea, solo en `/api/tasks/:id` (`404`).
8. Base de datos (`500` genérico si falla).

Un error de una etapa anterior gana siempre a los posteriores (los ejemplos siguientes suponen una key válida): un
`PATCH` con 20 KB da `405` (no `413`), 20 KB con
`text/plain` dan `413` (no `415`), `text/plain` con JSON roto da `415`, un `PUT` con identificador inválido y JSON roto
da `body` (no `id`), con identificador inválido y campos inválidos da solo `id`, con identificador inexistente y campos
inválidos da `400` (no `404`), y un cuerpo con campos inválidos con la base de datos caída da `400` (no `500`, porque
la base de datos no llega a consultarse).

### Rutas y errores de base de datos

Rutas y métodos: cualquier otro método en `/api/tasks` (incluidos HEAD, OPTIONS, PUT, DELETE, PATCH...) da `405` con
`Allow: GET, POST`. En `/api/tasks/<id>` solo existen `PUT` y `DELETE`: cualquier otro método (también `GET`) da `405` con
`Allow: PUT, DELETE` (`GET` no está permitido porque no se pidió leer una tarea por identificador); el método se
evalúa antes que el identificador, así que `GET /api/tasks/%E0%A4%A` da `405` y no `400`. `/api/tasks/`, `/api/tasks//`, `/api/%74asks`, `/api/tasks/<id>/`,
`/api/tasks/<id>/x` y cualquier ruta desconocida dan `404`. Si la base de datos falla (inalcanzable o
con una restricción violada), la respuesta es un `500` genérico y el log registra solo la clase del error y su
SQLSTATE, nunca datos de la petición (ni título, ni descripción, ni cuerpo, ni consulta).

Capas: ruta (`backend/src/routes`) → controlador (`controllers`) → servicio (`services`) → repositorio
(`repositories`), con SQL parametrizado de `pg`. La aplicación recibe la base de datos al construirse
(`createApp({ logger, database, security })`), así que no existe una aplicación sin base de datos ni sin key.

## Validación de título y descripción

Estas son las reglas de `title` y `description` que aplican `POST /api/tasks` (al crear) y `PUT /api/tasks/:id` (al
actualizar) (`backend/src/validation/`). Las del identificador y las del cuerpo de `PUT` están en la subsección siguiente.

- `title` es obligatorio y tiene de 1 a 100 caracteres; `description` es opcional, de 0 a 500 (cadena vacía por
  defecto, nunca nula). Se miden en caracteres Unicode (puntos de código: un emoji cuenta como uno) después de
  recortar los espacios de los extremos, y se guarda el valor ya recortado.
- Los espacios que se recortan son los de `String.prototype.trim()`: U+0009 a U+000D, U+0020, U+00A0, U+1680,
  U+2000 a U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 y U+FEFF. U+0085, U+180E y U+200B no se recortan.
- Se rechazan el carácter NUL (U+0000) y los sustitutos UTF-16 sueltos (por ejemplo `"\ud800"`), que PostgreSQL o
  UTF-8 no admiten. El resto de caracteres de control o invisibles se aceptan. Limitación conocida: un título formado
  solo por U+200B se acepta y se vería vacío.
- En `POST` solo se permiten las claves `title` y `description`; cualquier otra clave propia del JSON (`id`,
  `createdAt`, `completed`, `__proto__`, `constructor`...) es un campo no permitido. En `PUT` también se permite
  `completed`.
- Cada campo inválido produce una entrada `{ field, message }` con su primer problema (tipo, caracteres, longitud);
  nunca se refleja el valor enviado ni el nombre de campos desconocidos:

| Campo | Causa | Mensaje |
|---|---|---|
| `body` | claves no permitidas | El cuerpo contiene campos no permitidos. |
| `body` | `PUT` sin ningún campo | Debe enviar al menos title, description o completed. |
| `id` | no es un UUID válido | El identificador no es un UUID válido. |
| `query` | parámetros no admitidos | Parámetros de consulta no permitidos. |
| `title` | falta o no es cadena | Debe ser una cadena de texto. |
| `title` | NUL o sustituto suelto | Contiene caracteres no permitidos. |
| `title` | longitud | Debe tener entre 1 y 100 caracteres. |
| `description` | no es cadena | Debe ser una cadena de texto. |
| `description` | NUL o sustituto suelto | Contiene caracteres no permitidos. |
| `description` | longitud | Debe tener como máximo 500 caracteres. |
| `completed` | valor no booleano | Debe ser true o false. |

Las entradas van siempre en el orden `body`, `id`, `query`, `title`, `description`, `completed`.

### Reglas del identificador y del cuerpo de `PUT`

Son funciones puras; las usan `PUT /api/tasks/:id` (identificador y cuerpo) y `DELETE /api/tasks/:id` (solo el identificador).

- Identificador: un UUID completo de 8-4-4-4-12 dígitos hexadecimales ASCII, en mayúsculas o minúsculas, y se
  devuelve normalizado a minúsculas. No valen llaves, prefijos como `urn:uuid:`, guiones ausentes, dígitos de anchura
  completa ni un salto de línea final. El segmento de la URL se decodifica una sola vez (`%2D` equivale a `-`, pero
  `%252D` no); un porcentaje mal formado es un identificador inválido, no un error. El UUID nulo
  (`00000000-0000-0000-0000-000000000000`) tiene formato válido. Un identificador inválido da `id`.
- Cuerpo de `PUT`: objeto con al menos uno de `title`, `description` y `completed`; cada campo ausente no se toca.
  `title` y `description` siguen las reglas de arriba (`description` puede ser la cadena vacía) y `completed` debe ser
  `true` o `false` reales (ni `"true"`, ni `1`, ni `null`). `{}` da una entrada `body` («Debe enviar al menos title,
  description o completed.»); cualquier clave propia ajena (`id`, `createdAt`, `__proto__`...) da una única entrada
  `body` de campos no permitidos, sin añadir la de «ningún campo».

## Entrada de la API: tamaño y tipo de contenido

Estas son las reglas de entrada que se aplican a las rutas de `/api/*` (`backend/src/http/input/`); `/health` queda
fuera de ellas.

- El cuerpo de una petición no puede superar 10 240 bytes, sea cual sea su tipo. Se lee con un lector propio que corta
  al pasar el límite y responde 413 (`PAYLOAD_TOO_LARGE`). Tras un 413 el servidor cierra la conexión, para no seguir
  recibiendo un cuerpo que ya no se va a leer. Si el cliente declara un `Content-Length` mayor que el límite, el 413 se
  responde sin leer nada.
- El tamaño se comprueba antes que el tipo: un cuerpo de 20 KB con `text/plain` o con `Content-Encoding: gzip` da 413,
  no 415.
- `Content-Encoding` solo puede faltar o ser `identity` (da igual la capitalización). Cualquier otro valor, una lista, un
  valor vacío o la cabecera repetida da 415. El servidor nunca descomprime nada, así que no hay riesgo de bomba de
  descompresión.
- Si hay cuerpo, `Content-Type` debe ser `application/json` o `application/json; charset=utf-8` (415 en cualquier otro
  caso: `charset=utf8`, comillas, parámetros extra, `;` final, `+json`, vacío o cabecera repetida). Las cabeceras
  repetidas se detectan sobre las cabeceras crudas, porque Node oculta los duplicados en su vista normal.
- «Hay cuerpo» se decide solo por las cabeceras (`Content-Length` mayor que 0, o `Transfer-Encoding`), nunca por los
  bytes recibidos: un cuerpo de solo espacios cuenta como presente, y `Content-Length: 0` no. Sin cuerpo, el
  `Content-Type` se ignora.
- Un 415 con `Content-Length` se responde sin esperar al cuerpo y no cierra la conexión: Node descarta lo no leído y la
  misma conexión sigue sirviendo la petición siguiente.

### Cuerpo JSON

Una vez superados el tamaño y el tipo, el cuerpo se interpreta así (el primer fallo gana, y siempre es un 400 con
`field` `body`):

- `GET` y `DELETE` no admiten cuerpo: si traen algún byte (sea o no UTF-8 válido) el mensaje es «Esta ruta no admite
  cuerpo.». Sin `Content-Type` JSON, el 415 va antes.
- En `POST` y `PUT` el cuerpo no puede estar vacío (un cuerpo de solo espacios no cuenta como vacío: falla después como
  JSON mal formado).
- Debe ser UTF-8 bien formado y sin BOM. Un byte que no forma UTF-8 nunca se sustituye por U+FFFD: se guardarían datos
  distintos de los enviados. (Un U+FFFD legítimo, que llega como `EF BF BD`, sí es válido y se conserva.)
- Debe ser JSON bien formado y su raíz un objeto (no `[]`, `null`, una cadena, un número ni un booleano). Con claves
  repetidas gana la última.
- Si el cliente declara más bytes de los que envía (o corta un `chunked` a mitad) y cierra su lado de escritura, la
  respuesta es 400 «El cuerpo no coincide con la longitud declarada.» y el servidor cierra la conexión. Si se va del
  todo, no hay a quién responder: no se envía nada, no se registra como error del servidor y el servicio sigue.
  Limitación: un cuerpo lento (declara más de lo que envía y deja el socket abierto) lo resuelve el plazo de Node, fuera
  de este contrato.

#### Por qué existe un manejador de `clientError`

En el caso de «menos bytes de los declarados», Node se adelanta a la aplicación: su analizador HTTP detecta el final
de la conexión con el cuerpo incompleto (código `HPE_INVALID_EOF_STATE`), emite el evento `clientError` ANTES de que
nuestro lector de cuerpo vea nada y, por defecto, contesta él mismo `400 Bad Request` sin JSON. Eso rompería el contrato
de errores. Por eso `backend/src/server/client-error.ts` registra un manejador de `clientError` (en `startServer`) que
escribe el sobre JSON del contrato (400 `body`, `Content-Type: application/json; charset=utf-8`, `Connection: close`
y `Content-Length` exacto) solo para ese código y cierra el socket. Para cualquier otro error de cliente reproduce lo
que Node haría por defecto (400, 431 o 408 sin cuerpo, con `Connection: close`). Si el socket ya no es escribible, o ya
se había enviado una respuesta por esa conexión (por ejemplo un 415 temprano), solo lo destruye, sin escribir ni
lanzar. No registra nada en el log: es un fallo del cliente y la lista cerrada de eventos no incluye uno para esto.
Alternativa descartada: aceptar el 400 de Node sin JSON (incumple el contrato). Limitación: en una conexión
keep-alive que ya envió alguna respuesta, un cuerpo incompleto posterior cierra la conexión sin respuesta.

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
código 9 y no arranca). El `.env` debe tener `API_KEY`; sin ella, o con el valor de ejemplo, el servicio no arranca
(ver «Variables del servicio» para generarla). Por defecto escucha solo en `127.0.0.1:3000`. `GET /health` responde `{"status":"ok"}`; la
API de tareas está en `GET` y `POST` de `/api/tasks` y `PUT` y `DELETE` de `/api/tasks/:id` (ver «API de tareas»). Se detiene con Ctrl+C (cierre ordenado,
código 0).

`/health` solo indica que el proceso responde: no consulta la base de datos, así que no detecta una BD caída. Un
healthcheck de contenedor debe usar GET (HEAD no está permitido).

Aviso de seguridad: el servicio escucha solo en loopback y la API exige API key (`API_KEY` en el `.env`, ver
«Seguridad: API key»); todavía NO tiene límites por IP, CORS ni tope de la lista. No debe
exponerse a ninguna red hasta que se añadan. `GET /api/tasks` devuelve la lista completa, que crece sin cota,
y quien tenga la key puede crear, modificar y borrar tareas.

La base de datos se prepara con `npm run db:deploy` (dentro de `backend/`). La aplicación completa se documentará
cuando exista el frontend.

## Pruebas

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
  retira antes de que la vea la aplicación. Los tests de la protección (401, sin registro en el log e inyección SQL con
  la pila completa) están en `backend/tests/http/auth-guard.test.ts`, `backend/tests/http/security-logs.test.ts` y
  `backend/tests/api/sql-injection-stack.test.ts`.
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
red. Se usa `Authorization: Bearer` y no una cabecera propia porque es el estándar para
enviar credenciales y no la URL, que queda en historiales y registros de proxies.
Se compara el SHA-256 de la key y no la key directa porque `timingSafeEqual` exige longitudes iguales: con el resumen
siempre son 32 bytes, sin lanzar errores ni revelar la longitud. Alternativas descartadas: comparar con `===` (el
tiempo depende de dónde falla) y comprobar la longitud antes (la revela). La guarda se aplica con `app.use` tras
registrar `/health`, y no con una comparación de rutas, porque dos lógicas distintas podrían discrepar (`/health;x`,
`//health`) y dejar una ruta sin proteger.

**g) Rate limiting (pendiente).** Se añadirá con `express-rate-limit` y valores configurables por variables de entorno,
para frenar el abuso y los intentos repetidos con una API key inválida. Todavía NO existe: el servicio no limita las
peticiones. El contador en memoria será válido solo para una instancia de Express.

**h) Redis descartado.** No hay un problema de carga que lo justifique y añade un servicio, una credencial y más
superficie de ataque. Se mide la necesidad antes de añadir infraestructura; el `Pool` y el índice cubren la carga
prevista. Queda como trabajo futuro.

**i) Login de usuarios fuera de alcance.** Un login a medias sería peor que ninguno: solo tendría sentido completo
(hash de contraseñas, expiración de tokens, protección CSRF). Queda como trabajo futuro.

**j) Riesgos residuales.** Hay dos credenciales de base de datos en la aplicación (`writer` y `reader`; el daño
posible con `reader` es muy limitado). Además hay dos caminos de lectura: los contadores vía Prisma y la lista vía
Express, que pueden diferir un instante tras una escritura; se resuelve refrescando tras cada acción.

**k) Entrada estricta en `/api`.** El tamaño (10 240 bytes) se comprueba antes que el tipo, y `Content-Encoding` solo
puede ser `identity`: así un cuerpo enorme o comprimido se corta sin leerlo ni descomprimirlo (no hay bomba de
descompresión). El cuerpo debe ser UTF-8 bien formado y nunca se sustituyen bytes inválidos por U+FFFD, para no guardar
datos distintos de los enviados. Se usa un lector de cuerpo propio y no `express.json`, que acepta otros tipos y
codificaciones y no permite fijar este orden. Alternativa descartada: `express.json` con sus opciones.

**l) Consulta cruda.** `?completed=` se evalúa sobre la cadena sin interpretar (el intérprete de consulta de Express
está desactivado), porque ese intérprete descarta claves como `__proto__` y trunca a 1 000 parámetros, lo que dejaría
pasar parámetros sin verlos. Alternativa descartada: usar `req.query`.

**m) Fecha truncada en SQL.** `createdAt` sale ya formateado de la consulta, con los microsegundos truncados a
milisegundos y en UTC, y la lista se ordena por la marca completa. Así la hora mostrada nunca es posterior a la
guardada y el orden no depende de la zona horaria ni del redondeo. Alternativa descartada: formatear en JavaScript
con `Date` (redondea y pierde el orden fino).

**n) Orden fijo de validación.** Ocho etapas, tras la etapa 0 de la API key (ver más abajo): ruta y método, tamaño, codificación y tipo, cuerpo, identificador,
consulta y campos, existencia de la tarea, base de datos (ver «Orden de comprobación de una petición»): el resultado
de una petición con varios fallos es siempre el mismo, un `400` gana a un `404` y una base de datos caída nunca tapa un
error de validación. Solo la etapa de consulta y campos acumula problemas.

**o) `PUT` parcial.** `PUT /api/tasks/:id` escribe solo los campos enviados. Es una desviación consciente del `PUT`
puro: el cliente puede completar una tarea enviando únicamente `{"completed":true}`, y una pestaña con datos viejos no
pisa los cambios hechos desde otra. Alternativa descartada: reemplazo completo, que obligaría a reenviar todos los
campos y sobrescribiría cambios ajenos.
**p) Existencia por filas afectadas.** `UPDATE` y `DELETE` son una sola sentencia y la tarea «no existe» si afectaron
cero filas. Así no hay carrera entre comprobar y escribir: dos borrados simultáneos dan un `204` y un `404`, y un `PUT`
concurrente con un `DELETE` da `200` o `404`, nunca `500`. Alternativa descartada: un `SELECT` previo, que dejaría una
ventana en la que otra petición borra la fila y la escritura falla o miente.

**q) Identificador estricto, anclado y decodificado una vez; ruta sin decodificación automática de Express.** El
identificador debe ser un UUID completo (anclado de principio a fin, sin salto de línea final) y se decodifica una sola
vez. La ruta `/api/tasks/<id>` se registra con una expresión regular sin grupos de captura y el código lee el segmento
crudo de `req.path`, porque con un parámetro `:id` Express decodifica el segmento al enrutar y, si tiene un `%` roto,
falla con un `500` antes de decidir el método. Con esto un identificador mal formado da `400` en `PUT` y `DELETE`, y
`405` con otro método. Alternativa descartada: la ruta `/api/tasks/:id` con `req.params.id`, que da `500` ante `%E0%A4%A`.

**Limitaciones conocidas de la API actual.**

- Seguridad incompleta: hay API key y cabeceras de `helmet`, pero todavía no hay límite de peticiones por IP, CORS ni
  tope de la lista. No debe exponerse a ninguna red hasta que se añadan. La key autentica a la aplicación, no a las
  personas.
- `GET /api/tasks` devuelve todas las tareas (sin paginación ni cota) y `POST`, `PUT` y `DELETE` no tienen límite de uso.
- No se puede leer una tarea por su identificador: `GET /api/tasks/<id>` da `405`, porque nadie lo ha pedido.
- Los errores de nivel HTTP que resuelve Node antes de Express (cabeceras o URL enormes, método desconocido, petición
  mal formada) los contesta Node con sus propios códigos (400, 414 o 431, a veces sin cuerpo JSON) o cierra la
  conexión; el servicio sigue atendiendo.
- Un cuerpo lento (declara más bytes de los que envía y deja el socket abierto) lo resuelve el plazo de Node.
- Los caracteres invisibles se aceptan (un título solo con U+200B se guarda y se vería vacío).

**Nota sobre el historial.** El commit "backend setup con Express y Prisma" abre el backend: Prisma se usa allí para
el esquema y las migraciones, mientras que las consultas de la API se hacen con `pg` y `Pool`.

## Trabajo futuro

- Redis para caché y para un contador de rate limiting compartido entre varias instancias.
- Login de usuarios, implementado de forma completa.
