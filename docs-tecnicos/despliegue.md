# Despliegue

[← README](../README.md)

## Despliegue con Docker Compose

Esta sección explica cómo se empaqueta y se ejecuta la aplicación completa con Docker: PostgreSQL, una tarea de un
solo uso que migra la base (`migrate`), el backend y el frontend. Reúne las imágenes del backend y del frontend, el
script de inicio de la base, las variables, la composición (`docker-compose.yml`) que las une, el endurecimiento con
el cierre ordenado y la comprobación manual. Para levantarla con pocos comandos, ver «Arranque rápido».

Aviso para quien ejecute comandos: en esta carpeta conviven dos archivos de Compose, el de desarrollo
(`docker-compose.dev.yml`, solo PostgreSQL) y el de despliegue (`docker-compose.yml`). Por eso TODOS los comandos de
despliegue llevan `-f docker-compose.yml` de forma explícita: sin él, Compose elegiría un archivo por su cuenta y
podría tocar el contenedor equivocado.

### Imagen del backend

El archivo `backend/Dockerfile` construye la imagen en varias etapas. Cada etapa parte de una imagen limpia y solo
se lleva a la siguiente lo que esa necesita; lo que no se copia no está en la imagen final.

| Etapa       | Para qué sirve                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------- |
| `deps`      | Instala todas las dependencias (con las de desarrollo: el compilador de TypeScript y Prisma).      |
| `build`     | Compila TypeScript a `dist/`.                                                                       |
| `prod-deps` | Instala solo las dependencias de ejecución (`express`, `helmet`, `pg`, `express-rate-limit`).       |
| `runtime`   | Imagen del servicio: `dist/`, las dependencias de ejecución y `package.json`. Nada más.             |
| `migrate`   | Imagen de la tarea de migración: añade las dependencias completas (la herramienta de Prisma) y `prisma/`. |

Decisiones y su porqué:

- **Varias etapas.** La imagen que se ejecuta no lleva el código fuente, las pruebas, el compilador ni las
  dependencias de desarrollo: menos peso y menos cosas que un atacante pueda aprovechar si entra al contenedor.
  Alternativa descartada: una sola etapa que compila y ejecuta (la imagen final arrastraría todo lo anterior).
- **`migrate` es la excepción.** La herramienta que aplica las migraciones (Prisma) es una dependencia de desarrollo
  y necesita los archivos de `prisma/` (migraciones y script de permisos). Por eso vive en su propia etapa, que se usa
  solo para la tarea de un solo uso y nunca para el servicio expuesto. Alternativa descartada: instalar Prisma en la
  imagen del servicio (herramientas innecesarias en lo que escucha peticiones).
- **Un único `Dockerfile` con `migrate` como etapa.** Un archivo que explicar y Compose elige la etapa con `target`.
  Alternativa descartada: un `Dockerfile` aparte para migrar.
- **Usuario sin privilegios.** Las dos imágenes finales declaran `USER 10001:10001`. Se usa un número y no un nombre
  para poder comprobar que no es `root` sin resolver nombres dentro de la imagen; Node no necesita que el usuario
  exista en `/etc/passwd`. Los archivos se copian con `--chown` para que ese usuario pueda leerlos.
- **Debian «slim» y no Alpine.** Prisma incluye programas nativos compilados para la biblioteca de C habitual de
  Debian; en Alpine (otra biblioteca de C) pueden fallar de maneras difíciles de explicar. Alternativa descartada:
  Alpine, más pequeña pero con ese riesgo. Nota: al migrar, Prisma avisa de que no detecta OpenSSL en la imagen
  «slim» y usa su motor por defecto; el aviso es informativo y la migración se comprobó contra un PostgreSQL real.
- **Versión de Node fija.** Todas las etapas usan `node:26.1.0-bookworm-slim`: la etiqueta completa (mayor, menor y
  parche) y la misma versión mayor con la que se desarrolló y se probó, que además figura en el campo `engines` de
  los dos paquetes. Nunca `latest` ni solo `26`: así, reconstruir la imagen mañana da lo mismo que hoy. Alternativa
  descartada: una etiqueta flotante (un cambio externo podría romper la construcción sin que nadie toque el código).
- **`node` directo y no `npm`.** El comando de la imagen es `node dist/index.js`. `npm` no reenvía bien las señales
  de parada (`SIGTERM`) al programa y, con `npm start`, recompilaría en cada arranque. Con `node` como proceso
  principal, el backend recibe la señal y puede cerrar ordenadamente. `migrate` ejecuta `node dist/db/migrate-cli.js`,
  el mismo comando de despliegue de la migración, y recibe las variables de Compose (no lee ningún `.env`).
- **Contexto recortado y sin `COPY . .`.** `backend/.dockerignore` deja fuera `.env` (y `.env.*` salvo
  `.env.example`), `node_modules`, `.git`, `dist`, `coverage` y las pruebas. Además, cada `COPY` del `Dockerfile`
  nombra exactamente lo que copia: aunque un archivo sensible llegara al contexto, no entraría en la imagen.
- **Sin secretos en las capas.** Ninguna contraseña, URL ni key se escribe con `ARG` o `ENV`: las entrega Compose al
  ejecutar. Riesgo residual declarado: las variables de un contenedor son visibles con `docker inspect` para quien
  tenga acceso al socket de Docker, lo que equivale a ser administrador de la máquina. Alternativa descartada:
  `secrets` de Docker o Swarm (más piezas, las aplicaciones leen variables y no archivos, y los orquestadores quedan
  fuera de alcance).

Construcción manual de una etapa (solo para probar; Compose lo hará por ti):

```powershell
docker build --target runtime -t todo-backend-runtime backend
docker build --target migrate -t todo-backend-migrate backend
```

Los Dockerfiles no se prueban con Vitest: se validan construyendo la imagen (`docker compose build`) y con la
comprobación manual (usuario numérico, etiqueta de Node, ausencia de credenciales y de `COPY . .`).

### Imagen del frontend

El archivo `frontend/Dockerfile` tiene tres etapas, con la misma etiqueta de Node que el backend
(`node:26.1.0-bookworm-slim`):

| Etapa    | Para qué sirve                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------- |
| `deps`   | Instala las dependencias (`npm ci`) y genera el cliente de Prisma (lo hace el `postinstall`).            |
| `build`  | Compila la aplicación de Next.js en dos pasos (ver abajo).                                               |
| `runner` | Imagen del servicio: solo el servidor independiente de Next y los archivos estáticos. Corre como 10001. |

Decisiones y su porqué:

- **Salida independiente (`output: 'standalone'`).** Next copia a `.next/standalone` solo los módulos que la
  aplicación usa de verdad, junto con un `server.js` que se arranca con `node server.js`. La imagen final pesa mucho
  menos y no lleva el código fuente ni las herramientas de desarrollo. Alternativa descartada: `next start` con todos
  los `node_modules` dentro de la imagen (más peso y más superficie). Aviso: con esta opción, `next start` imprime un
  aviso indicando que ya no es la forma recomendada de arrancar; en desarrollo (`npm run dev`) y en la prueba de
  integración se sigue usando `next dev`/`next start` y funcionan igual.
- **Compilación en dos pasos.** `npm run verify:build` compila con las variables de configuración vacías (demuestra
  que la compilación no necesita secretos) y con valores falsos (y busca esos valores en los archivos que van al
  navegador, para detectar fugas). Después `npm run build` compila de nuevo en limpio y ese resultado es el que se
  copia. Costo: la construcción tarda más. Alternativa descartada: copiar el resultado del paso con valores falsos
  (el artefacto saldría de una compilación hecha con un entorno falso).
- **Sin variables de ejecución en la imagen.** La construcción no recibe `ARG` ni `ENV` de `BACKEND_URL`, `API_KEY`,
  `READER_DATABASE_URL` ni `ALLOWED_HOSTS`: los secretos no deben quedar escritos en las capas de la imagen. Tampoco
  se fijan `PORT` ni `HOSTNAME`: no pertenecen a la configuración del frontend y los entrega Compose al ejecutar.
- **Cliente de Prisma siempre generado en la imagen.** `frontend/.dockerignore` excluye `src/generated`, `.next`,
  `node_modules`, las pruebas, `.env` (y `.env.*` salvo `.env.example`), de modo que el cliente de Prisma sale de
  `prisma generate` dentro de la construcción y no del equipo de quien construye. Cada `COPY` nombra lo que copia
  (no hay `COPY . .`).
- **Caché escribible.** Next escribe en `.next/cache` mientras funciona. La imagen crea ese directorio con dueño
  `10001:10001`; así, si más adelante el sistema de archivos del contenedor se declara de solo lectura, basta con
  montar ahí un directorio temporal.
- **Sin `public/`.** El frontend no tiene la carpeta `public`, así que no se copia. Si algún día se crea, hay que
  añadir su `COPY` a la etapa `runner` (si se olvida, la imagen no arranca).
- **Usuario y arranque.** `USER 10001:10001` numérico, como en el backend, y `CMD ["node", "server.js"]` en forma de
  lista: `node` es el proceso principal y recibe directamente las señales de parada.

Construcción manual (solo para probar; Compose lo hará por ti):

```powershell
docker build -t todo-frontend frontend
```

El Dockerfile del frontend se valida igual, construyendo la imagen y con la comprobación manual (etapas, usuario,
etiqueta de Node común con el backend, ausencia de variables de ejecución en la construcción, `output: 'standalone'`
y comando de arranque).

### Base de datos de despliegue: roles y bases

El script `docker/postgres/init/01-roles-and-databases.sh` crea los tres roles (`owner`, `writer` y `reader`) y la base
de datos (`DB_NAME`). PostgreSQL lo ejecuta solo la primera vez, cuando el volumen de datos está vacío. En un arranque
posterior el volumen ya tiene datos y el script no se repite.

- **Base de pruebas opcional.** La base de pruebas (`DB_NAME_TEST`) se crea solo si la variable está definida y no
  vacía. En desarrollo sí, porque su `.env` la define. En el despliegue no se define, así que no hay base de pruebas
  junto a los datos de la aplicación. Alternativa descartada: crear siempre la base de pruebas (datos de prueba junto a
  los de despliegue) o mantener un script distinto para el despliegue (dos scripts que mantener).
- **Contraseñas fuera de la migración.** Las contraseñas de los roles llegan como variables de entorno y nunca se
  escriben en una migración ni en un archivo versionado. Solo se aceptan caracteres `A-Za-z0-9._~-`, que no rompen las
  URL de conexión; el script nombra la variable que falla, nunca su valor.
- **Cambiar una contraseña en el `.env` no cambia el rol.** Como el script corre solo con el volumen vacío, editar la
  contraseña después no la modifica en PostgreSQL. Para rotarla hay dos caminos: ejecutar `ALTER ROLE` dentro de la base
  o recrear el volumen de despliegue (lo que borra sus datos).
- **Aviso de orden.** Si `DB_NAME_TEST` está definida pero no es válida, el script falla después de crear los roles y la
  base principal. Como el volumen ya no está vacío, un nuevo arranque no repite el script: hay que corregir la variable
  y recrear el volumen de la base afectada.
- **Finales de línea LF.** El archivo `.gitattributes` obliga a guardar los `.sh` con finales de línea LF. Con CRLF (lo
  que Windows puede introducir por su configuración de Git), el script no se ejecuta dentro del contenedor Linux.

### Variables del despliegue

El `.env` de la raíz sirve al desarrollo y al despliegue: es un único archivo, copiado de `.env.example`. La
composición no le pasa a cada servicio el archivo entero: cada servicio recibe solo sus variables, declaradas una a
una en `environment` (sin `env_file`).

| Servicio   | Variables que recibe                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `postgres` | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `OWNER_PASSWORD`, `WRITER_PASSWORD`, `READER_PASSWORD` y `DB_NAME`.                  |
| `migrate`  | `OWNER_DATABASE_URL`, construida con el rol `owner` y el host `postgres`.                                                  |
| `backend`  | `DATABASE_URL` (rol `writer`), `API_KEY`, `CORS_ORIGIN`, `HOST`, `PORT`, `TRUSTED_PROXIES`, `SHUTDOWN_TIMEOUT_MS` y los cuatro `RATE_LIMIT_*`. |
| `frontend` | `BACKEND_URL` (`http://backend:3000`), `API_KEY`, `READER_DATABASE_URL` (rol `reader`), `ALLOWED_HOSTS`, `PORT` y `HOSTNAME`. |

Las URL de conexión de la composición apuntan a `postgres:5432`, dentro de la red interna. Por eso las URL de
desarrollo del `.env` (`DATABASE_URL`, `OWNER_DATABASE_URL`, `READER_DATABASE_URL` y las `TEST_*`, que apuntan a
`127.0.0.1:5433`) no se usan en el despliegue, y `DB_NAME_TEST` no se pasa (así el script de inicio no crea la base de
pruebas). `HOST`, `PORT`, `TRUSTED_PROXIES` y `SHUTDOWN_TIMEOUT_MS` tampoco se pasan desde el `.env`: la composición los
fija. Las cuatro variables del backend que no aparecen en la tabla (`TASKS_LIST_LIMIT` y las tres `DB_POOL_*`) toman el
valor por defecto del esquema de configuración.

Decisiones y su porqué:

- **Cada servicio ve solo lo suyo.** El frontend no conoce la contraseña de `owner` ni la de `writer`, y el backend no
  conoce la de `owner`. Alternativa descartada: un `env_file` con el `.env` completo para todos los servicios (el
  frontend vería la contraseña de `owner`).
- **URL construidas en la composición.** Dentro de un contenedor, `127.0.0.1` es el propio contenedor, no el
  anfitrión; por eso la composición arma sus URL contra el servicio `postgres`. Alternativa descartada: reutilizar las
  URL de desarrollo del `.env` (no conectarían con la base del despliegue).
- **Un solo `.env` y un solo `.env.example`.** Alternativa descartada: un `.env` por servicio (más archivos que
  mantener y riesgo de que la `API_KEY` del backend y la del frontend difieran) o un `.env.example` de despliegue aparte
  (dos plantillas con las mismas contraseñas y riesgo de que difieran).

Hosts y origen (son independientes y cada uno tiene su función):

- `ALLOWED_HOSTS` (por defecto `localhost:3001,127.0.0.1:3001`) lo usa el frontend para aceptar escrituras solo si el
  `Host` de la petición está en la lista. Si la aplicación se publica con otro nombre, hay que añadirlo aquí.
- `CORS_ORIGIN` (por defecto `http://localhost:3001`) lo usa el backend. El navegador solo habla con el frontend, que
  llama a la API desde el servidor; por eso el CORS del backend solo cierra el acceso directo de un navegador a la API.
  Si el nombre de publicación cambia, se cambian también `ALLOWED_HOSTS` y `CORS_ORIGIN`.

Cupos de demostración: la composición usa 1000 peticiones generales y 200 de escritura por cada 15 minutos
(`RATE_LIMIT_MAX` y `RATE_LIMIT_POST_MAX`), para que una demostración no se agote pronto. Esos valores solo se aplican
si el `.env` no define las dos variables. Una copia literal de `.env.example` las define en 100 y 20 (los cupos de
desarrollo), y esos valores ganan: hay que borrar esas dos líneas o ponerlas en 1000 y 200. Todos los usuarios
comparten un único cupo (cupo único compartido por diseño): el frontend no envía la IP del usuario al backend, así que
el backend cuenta a todos como un solo cliente.

Límites de recursos: `BACKEND_MEM_LIMIT` (512m), `BACKEND_CPUS` (1.0), `BACKEND_PIDS_LIMIT` (200), `FRONTEND_MEM_LIMIT`
(768m), `FRONTEND_CPUS` (1.0) y `FRONTEND_PIDS_LIMIT` (300). Evitan que un proceso agote la máquina. Son valores
generosos para que una demostración no falle. La composición los aplica al backend y al frontend (ver «Endurecimiento y
cierre ordenado»), y los valores descomentados en el `.env` sustituyen a los de la composición.

Generación de valores propios (en la terminal; el resultado se pega solo en el `.env`, nunca en un archivo que se
versione):

```powershell
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

La primera línea sirve para cada contraseña (`POSTGRES_PASSWORD`, `OWNER_PASSWORD`, `WRITER_PASSWORD`, `READER_PASSWORD`)
y la segunda para `API_KEY`. Las contraseñas solo pueden tener los caracteres `[A-Za-z0-9._~-]`, que es lo que produce
`base64url`; con otros caracteres (`@ : / ' %` y espacios) la URL de conexión o el script de inicio fallan. Los valores
`change-me` de `.env.example` son de ejemplo, no son secretos, y los servicios rechazan la `API_KEY` de ejemplo.

### Composición

El archivo `docker-compose.yml` define el proyecto `todo-app-deploy` con cuatro servicios:

| Servicio   | Para qué sirve                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| `postgres` | La base de datos (imagen `postgres:16.15`, etiqueta exacta). Guarda los datos en el volumen `todo_app_deploy_pgdata`. |
| `migrate`  | Tarea de un solo uso: aplica las migraciones y los permisos con el rol `owner` y termina.               |
| `backend`  | La API de Express (imagen `runtime`), con el rol `writer`.                                              |
| `frontend` | La interfaz de Next.js (imagen `runner`), con el rol `reader` solo para los contadores.                 |

**Orden de arranque.** `postgres` arranca primero. `migrate` espera a que esté sano. El backend espera a que
`postgres` esté sano y a que `migrate` haya terminado con éxito. El frontend espera a que el backend esté sano y a que
`postgres` esté sano (la página lee los contadores de la base). Porqué: la API no debe aceptar peticiones antes de que
exista el esquema, y si la migración falla, ni el backend ni el frontend arrancan. Alternativa descartada: migrar al
arrancar Express (el servicio expuesto necesitaría las credenciales y las herramientas del rol `owner`).

**Credenciales por servicio.** Solo `migrate` recibe la URL del rol `owner`; el backend recibe la de `writer` y el
frontend la de `reader`. Cada servicio ve únicamente lo suyo (ver «Variables del despliegue»). Alternativa descartada:
`env_file` con el `.env` completo para todos.

**Dos redes.**

- `internal` (`todo_app_deploy_internal`) está marcada como interna: sus contenedores no tienen salida a internet y el
  anfitrión no puede llegar a ellos. Están en ella los cuatro servicios. Docker le asigna la subred; no hay subred
  asignada a mano.
- `publish` (`todo_app_deploy_publish`) existe solo para publicar el puerto del frontend en el equipo. Sin una red
  normal no se puede publicar un puerto. Honestidad: por estar en `publish`, el frontend SÍ tiene salida a internet;
  la base de datos, el backend y `migrate` no.

**Puertos.** Solo el frontend publica un puerto: `127.0.0.1:3001`, es decir, accesible desde este equipo y no desde
otras máquinas. La base y la API no publican nada. Si el 3001 está ocupado, hay que liberarlo (el puerto está fijado
también en el `ALLOWED_HOSTS` y en `CORS_ORIGIN`); si se cambia el puerto publicado, se mantiene `127.0.0.1` y se
cambian esos dos valores. Para aceptar otro nombre de acceso, se añade a `ALLOWED_HOSTS` (y se ajusta `CORS_ORIGIN`).

**Cupo compartido y `TRUSTED_PROXIES=none`.** El backend se configura con `TRUSTED_PROXIES=none` (valor fijo en la
composición, no sobrescribible desde el `.env`): el frontend no envía cabeceras con la IP del usuario, así que Express
no debe creerlas de nadie y ve a todos como un único cliente, el contenedor del frontend. Riesgo aceptado: un usuario
puede agotar el cupo de todos y los fallos de la key bloquean a todos. Si algún día hubiera un proxy de confianza delante
del frontend, se pondría su dirección en `TRUSTED_PROXIES`. `HOST` es `0.0.0.0` porque dentro de la red interna el
backend debe aceptar conexiones de otro contenedor.

**Comprobaciones de salud.** `postgres` usa `pg_isready` por TCP. El backend y el frontend usan un pequeño programa de
Node que hace un `GET` (la imagen no lleva `curl` ni `wget`): al `/health` del backend y a `/` del frontend con un
`Host` permitido. Limitaciones: `/health` no consulta la base, así que el backend sigue «sano» si la base cae; el
frontend sí depende de la base y pasa a «no sano» sin reiniciarse.

**Arranque.**

```powershell
docker compose -f docker-compose.yml up -d --build --wait
```

`--wait` espera a que los servicios estén sanos; `migrate` es de un solo uso y termina con salida 0. Versión de Compose
comprobada: v5.3.1 (Docker 29.6.2). La primera vez crea el volumen de datos; `down` sin `-v` lo conserva.

### Datos de ejemplo

El servicio `seed` de `docker-compose.yml` pertenece al perfil `seed`: `docker compose -f docker-compose.yml up -d`
NO lo crea ni lo ejecuta. Para cargar 15 tareas de ejemplo (ids fijos, pendientes y completadas, con y sin descripción):

```powershell
docker compose -f docker-compose.yml --profile seed run --rm seed
```

- **Dependencias.** Con `run`, Compose levanta `postgres` y `migrate` si hacen falta (sirve también como primer
  arranque de una base nueva). Usa la imagen `runtime` del backend; si cambió el código, añada `--build`.
- **Rol.** Recibe la URL del rol `writer` (como el backend), no la de `owner`. No publica puertos y corre en la red
  `internal`.
- **Repetible.** No duplica ni pisa ediciones; una tarea de ejemplo borrada se vuelve a crear.
- **Salida.** Una línea JSON del logger con el resumen en `event`: la primera vez
  `Datos de ejemplo: 15 insertadas, 0 ya existían`; las siguientes `Datos de ejemplo: 0 insertadas, 15 ya existían`.
- **Por qué no es una migración.** Una migración corre una sola vez, es del esquema y llenaría de datos de prueba un
  despliegue real. Alternativa descartada: sembrar dentro de `migrate`.

### Endurecimiento y cierre ordenado

El backend y el frontend (los dos servicios que ejecutan código de la aplicación) llevan estas opciones:

| Opción                                   | Qué hace y por qué                                                                                                                                                                  | Alternativa descartada                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `cap_drop: [ALL]`                        | Quita al proceso todas las capacidades especiales de Linux (cambiar propietarios, abrir puertos bajos, etc.). Ninguno las necesita: escuchan en puertos altos y corren como 10001. | Dejar las capacidades por defecto de Docker (más superficie sin necesidad).      |
| `no-new-privileges:true`                 | Impide que un proceso gane privilegios con un binario especial (`setuid`). Si alguien entra al contenedor, no puede escalar.                                                        | No ponerlo.                                                                      |
| `read_only: true` y `tmpfs`              | El sistema de archivos del contenedor es de solo lectura: un atacante no puede dejar archivos. Solo se escribe en `/tmp` y, en el frontend, en la caché de Next (`/app/.next/cache`), ambos en memoria y con el usuario 10001. | Dejar el disco escribible (más fácil, pero cualquier fallo permite persistir código). |
| `mem_limit`, `cpus`, `pids_limit`        | Tope de memoria, CPU y procesos por servicio: un servicio fuera de control no se come toda la máquina.                                                                              | Sin límites (un error podría tumbar el equipo).                                  |
| `restart: unless-stopped`                | Si el proceso cae, Docker lo levanta de nuevo; solo se queda parado si alguien lo detuvo a mano.                                                                                    | `always` (reinicia también tras una parada manual al reiniciar Docker) o ningún reinicio. |

Valores por defecto de los límites: backend 512m, 1.0 CPU y 200 procesos; frontend 768m, 1.0 CPU y 300 procesos. Para
cambiarlos, se descomenta la variable correspondiente en el `.env` (`BACKEND_MEM_LIMIT`, `BACKEND_CPUS`,
`BACKEND_PIDS_LIMIT`, `FRONTEND_MEM_LIMIT`, `FRONTEND_CPUS`, `FRONTEND_PIDS_LIMIT`) y se ejecuta de nuevo
`docker compose -f docker-compose.yml up -d`. Con la aplicación en reposo, el backend usa unos 25 MiB y el frontend
unos 85 MiB, así que los valores dejan mucho margen.

**Qué queda fuera.** `postgres` y `migrate` no llevan `cap_drop` ni `read_only`: la imagen oficial de PostgreSQL cambia
de propietario y escribe en su directorio de datos al arrancar, y `migrate` es una tarea que termina sola. `postgres`
sí lleva `no-new-privileges:true` (arrancó y quedó sano con ella) y `restart: unless-stopped`. `migrate` lleva
`restart: "no"`: si la migración falla, debe verse el fallo y no repetirse en bucle. Excepciones aplicadas por fallo
de arranque: ninguna (`no-new-privileges` en `postgres` y `read_only` en el frontend funcionaron en Docker Desktop).

**Plazos de cierre.** Al parar un servicio, Docker envía `SIGTERM` y, pasado `stop_grace_period`, fuerza la parada con
`SIGKILL`. El backend cierra de forma ordenada en `SHUTDOWN_TIMEOUT_MS`, que en la composición es el literal `10000`
(10 s); su `stop_grace_period` es de 20 s, es decir, al menos 5 s más que el cierre, para que Express termine solo antes
de que Docker lo fuerce. El frontend tiene 15 s y `postgres` 30 s. `SHUTDOWN_TIMEOUT_MS` y los plazos no se pueden
sobrescribir desde el `.env`: la relación entre ellos debe mantenerse y `docker compose config --quiet` valida la sintaxis. No se cambia
`stop_signal`: cada imagen usa el suyo (la de PostgreSQL envía `SIGINT`, que provoca su cierre rápido y seguro).
Observado al parar uno a uno: el backend y `postgres` terminan con código 0; el frontend termina con 143 (128 + 15,
es decir, `SIGTERM` sin salida propia de Next.js). Es una limitación conocida del servidor de Next y no pierde datos:
el frontend no escribe en la base.

**Datos y volumen.** Los datos viven en el volumen `todo_app_deploy_pgdata`, distinto del de desarrollo.
`docker compose -f docker-compose.yml down` conserva los datos. `down -v` los **BORRA**. Para reiniciar solo el
despliegue, y nunca el proyecto de desarrollo, el comando de borrado se escribe siempre con el archivo y el proyecto
explícitos, tras comprobar con `docker compose ls` cuál es cuál:

```powershell
docker compose -f docker-compose.yml -p todo-app-deploy down -v
```

**Rotación y mantenimiento.**

- Contraseñas de roles: cambiarlas en el `.env` no cambia la del rol dentro de la base (el script de inicio solo corre
  con el volumen vacío); se rota con `ALTER ROLE` o recreando el volumen de despliegue, y después se recrean los
  servicios afectados.
- `API_KEY`: se cambia en el `.env` y se recrean el backend y el frontend a la vez
  (`docker compose -f docker-compose.yml up -d --force-recreate backend frontend`); si solo se recrea uno, la
  aplicación recibe 401.
- Base que cae con la aplicación en marcha: `postgres` se reinicia solo; el frontend pasa a «no sano» mientras tanto y
  las peticiones a la API devuelven un error genérico 500; al volver la base se recuperan sin reiniciar nada.
- Reconstrucción tras cambiar código: `docker compose -f docker-compose.yml up -d --build`.

## Despliegue en Ubuntu

Esta sección explica cómo desplegar la aplicación en un servidor Ubuntu con Docker Engine y el plugin de Compose. Todos
los pasos de esta sección están documentados, no probados: no hubo una máquina Ubuntu donde ejecutarlos. Lo que sí se
probó es la misma composición en Docker Desktop de Windows (ver «Comprobación manual»). Los comandos usan el mismo
`docker-compose.yml`, así que se espera que se comporten igual, pero eso no está comprobado.

### Requisitos

- Un servidor Ubuntu con acceso a internet para descargar las imágenes y construirlas (la red de la aplicación no tiene
  salida, pero la construcción sí la necesita).
- Un usuario con permisos para ejecutar `sudo` y para usar Docker.
- Git, Docker Engine y el plugin de Compose (se usa como `docker compose`). No hace falta
  instalar Node ni PostgreSQL: todo corre en contenedores.

En una máquina nueva solo hace falta Docker (Engine y Compose). Node y PostgreSQL no se instalan en el sistema: llegan
como imágenes de Docker al ejecutar `docker compose -f docker-compose.yml up -d --build --wait`. La imagen de Node
construye y ejecuta el backend y el frontend, y la imagen de PostgreSQL guarda los datos. Por eso este README no
documenta una instalación de Node ni de PostgreSQL sin Docker: esos comandos no se han probado y la composición ya lo
resuelve.

### Instalar Docker

Siga la guía oficial de Docker para Ubuntu (https://docs.docker.com/engine/install/ubuntu/), que incluye el plugin de
Compose. Este README no copia sus comandos ni fija versiones: cambian con el tiempo y la guía oficial es la fuente
correcta. Al terminar, compruebe que `docker --version` y `docker compose version` responden. Las versiones con las que
se comprobó la composición en Windows están en «Versiones usadas»; en Ubuntu no se probó ninguna.

### Clonar y configurar

```
git clone <url-del-repositorio>
cd <carpeta-del-repositorio>
cp .env.example .env
```

Genere los secretos y péguelos solo en el `.env` (nunca en un archivo que se suba al repositorio): una contraseña por
cada variable `POSTGRES_PASSWORD`, `OWNER_PASSWORD`, `WRITER_PASSWORD` y `READER_PASSWORD`, y la clave en `API_KEY`.

```
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Si el servidor no tiene Node, genere los valores en otra máquina y péguelos en el `.env` del servidor. Ponga
`RATE_LIMIT_MAX` en `1000` y `RATE_LIMIT_POST_MAX` en `200`, o borre esas dos líneas (los valores de la plantilla se
agotan pronto con la interfaz). Revise «Variables del despliegue». Ningún comando de esta sección imprime el `.env`.

### Levantar y comprobar

```
docker compose -f docker-compose.yml up -d --build --wait
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs --tail 50 backend
```

Esperado: `postgres`, `backend` y `frontend` sanos, y `migrate` terminado con código 0. Después, `curl -I http://127.0.0.1:3001`
desde el propio servidor debe responder `200`. Por defecto el puerto se publica solo en el propio servidor
(`127.0.0.1:3001:3001` en la composición), así que desde otra máquina no responde: es lo esperado.

### Actualizar

```
git pull
docker compose -f docker-compose.yml up -d --build --wait
```

Reconstruye las imágenes, y `migrate` aplica las migraciones nuevas antes de arrancar el backend (es idempotente).
Los datos se conservan en el volumen. Una migración que falle impide que el resto arranque; se revisa con
`docker compose -f docker-compose.yml logs migrate`.

### Parar

```
docker compose -f docker-compose.yml down
```

Detiene y elimina los contenedores y conserva el volumen con los datos. No se documenta ninguna opción que borre el
volumen: borrar los datos no forma parte del uso normal.

### Copia de seguridad

Un comando, desde la raíz del repositorio, que guarda un volcado en un archivo del servidor (`respaldo.sql`; contiene
las tareas, así que no debe subirse a git ni compartirse):

```
docker compose -f docker-compose.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$DB_NAME"' > respaldo.sql
```

El servicio es `postgres`; el usuario y la base salen de las variables `POSTGRES_USER` y `DB_NAME` que la composición ya
da a ese contenedor, así que no hace falta escribirlas ni imprimir el `.env`. La restauración no se documenta ni se
probó.

### Antes de exponer a una red

La aplicación sale configurada para uso local. Antes de publicarla a una red o a internet hace falta, como mínimo:

- **TLS:** poner delante un proxy inverso con HTTPS. La aplicación no trae HTTPS propio.
- **Login:** no existe; quien alcance la página puede crear, editar y borrar tareas (ver «Riesgos residuales y
  limitaciones»).
- **`ALLOWED_HOSTS`:** añadir el nombre público (con puerto si lo lleva); si no, las escrituras reciben 403.
- **`CORS_ORIGIN`:** cambiarlo al origen público exacto, por ejemplo `https://nombre-publico`.
- **Dirección de publicación:** la composición publica el puerto solo en `127.0.0.1`; para que lo alcance el proxy
  externo hay que cambiar esa publicación en `docker-compose.yml` o poner el proxy en el mismo servidor apuntando a
  `127.0.0.1:3001`. Ese cambio es del operador y no se probó.
- **`TRUSTED_PROXIES`:** la composición lo fija a `none`. Aun con un proxy delante, el frontend no reenvía la IP real, así
  que el cupo sigue siendo compartido (ver «Cupo compartido por diseño (desviación declarada)»).
- Cortafuegos del servidor: solo deben quedar abiertos los puertos del proxy.
