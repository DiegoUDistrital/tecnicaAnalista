# To-Do App

Prueba Técnica para Analista de Desarrollo.

## Resumen y alcance

Aplicación de lista de tareas (To-Do) con backend en Express, base de datos PostgreSQL y frontend en Next.js.
Permite crear, listar, editar, completar y eliminar tareas, y filtrarlas por estado (todas, completadas, pendientes).
El énfasis del proyecto está en la seguridad y en el mínimo privilegio: tres roles de base de datos, una API protegida
por key, límites de peticiones y un frontend que nunca expone secretos al navegador.

Qué incluye:

- Un backend (`backend/`) que hace todo el CRUD y el filtro, y es dueño del esquema y de las migraciones.
- Un frontend (`frontend/`) con la interfaz, que solo habla con su propio servidor.
- Una base de datos PostgreSQL con los roles `owner`, `writer` y `reader`.
- Una composición de Docker que levanta todo con un comando, y un arranque conjunto para desarrollar.

Fuera de alcance: login de usuarios, HTTPS, pruebas en una máquina Ubuntu (los pasos se documentan, no se probaron),
Redis y límites por persona (ver «Trabajo futuro» y «Cupo compartido por diseño (desviación declarada)»).

## Índice

- [Resumen y alcance](#resumen-y-alcance)
- [Arranque rápido](#arranque-rápido), [Desarrollo local](#desarrollo-local) y
  [Despliegue en Ubuntu (resumen)](#despliegue-en-ubuntu-resumen)
- [Arquitectura](#arquitectura) y [Recorrido de una petición](#recorrido-de-una-petición)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Versiones usadas](#versiones-usadas)
- [Seguridad (resumen)](#seguridad-resumen)
- [Cupo compartido por diseño (desviación declarada)](#cupo-compartido-por-diseño-desviación-declarada)
- [Pruebas](#pruebas)
- [Decisiones técnicas](#decisiones-técnicas)
- [Riesgos residuales y limitaciones](#riesgos-residuales-y-limitaciones)
- [Trabajo futuro](#trabajo-futuro)
- [Documentación técnica](#documentación-técnica): [desarrollo](docs-tecnicos/desarrollo.md),
  [backend](docs-tecnicos/backend.md), [API](docs-tecnicos/api.md), [frontend](docs-tecnicos/frontend.md),
  [despliegue](docs-tecnicos/despliegue.md), [comprobación manual](docs-tecnicos/comprobacion-manual.md) y
  [decisiones](docs-tecnicos/decisiones.md)

## Arranque rápido

Ruta más corta para ver la aplicación funcionando: todo dentro de Docker, sin instalar Node ni PostgreSQL. Requisitos:
Docker Desktop en marcha (Windows) o Docker Engine con el plugin de Compose (Linux).

1. Clone el repositorio y entre en la carpeta:

   ```
   git clone <url-del-repositorio>
   cd <carpeta-del-repositorio>
   ```

2. Cree el `.env` a partir de la plantilla (un solo archivo sirve al despliegue; el frontend de Docker no necesita
   `frontend/.env`):

   ```powershell
   Copy-Item .env.example .env
   ```

   En Linux o macOS: `cp .env.example .env`.

3. Genere los secretos y péguelos solo en el `.env` (nunca en un archivo que se suba al repositorio). Una contraseña por
   cada variable `POSTGRES_PASSWORD`, `OWNER_PASSWORD`, `WRITER_PASSWORD` y `READER_PASSWORD`, y la clave en `API_KEY`:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

   La primera línea genera cada contraseña; la segunda, la `API_KEY`. Las URL de conexión del `.env` son de desarrollo y
   el despliegue no las usa. Además, la plantilla define `RATE_LIMIT_MAX=100` y `RATE_LIMIT_POST_MAX=20`, que se agotan
   pronto con la interfaz: póngalos en `1000` y `200`, o borre esas dos líneas.

4. Construya y levante todo:

   ```powershell
   docker compose -f docker-compose.yml up -d --build --wait
   ```

5. Abra `http://127.0.0.1:3001`.

6. Para apagar (los datos se conservan en un volumen):

   ```powershell
   docker compose -f docker-compose.yml down
   ```

Todos los comandos de despliegue llevan `-f docker-compose.yml` porque la carpeta tiene también el archivo de
desarrollo. Detalles, límites y comprobaciones en [Despliegue con Docker Compose](docs-tecnicos/despliegue.md#despliegue-con-docker-compose).
Para desarrollar con recarga, ver [Instalación](docs-tecnicos/desarrollo.md#instalación) y
[Arranque conjunto](docs-tecnicos/desarrollo.md#arranque-conjunto).

## Desarrollo local

Para desarrollar con recarga (requiere Node.js y Docker). Desde la raíz, con `.env` y `frontend/.env` ya creados desde
sus `.env.example` y la misma `API_KEY` en ambos:

```powershell
npm ci
cd backend; npm ci; cd ..
cd frontend; npm ci; cd ..
docker compose -f docker-compose.dev.yml up -d --wait
cd backend; npm run db:deploy; cd ..
npm run dev
```

Luego abra `http://127.0.0.1:3001`. Detalle (variables, límites y avisos) en
[Desarrollo local](docs-tecnicos/desarrollo.md#primera-vez).

## Despliegue en Ubuntu (resumen)

Se interpreta el despliegue en Ubuntu como despliegue con Docker: Node y PostgreSQL van dentro de las imágenes y no se
instalan en el servidor. Porqué: es el mismo entorno que en desarrollo y no hay que instalar versiones a mano.
Alternativa descartada: instalación nativa con `apt` (versiones del sistema distintas de las probadas, más pasos
manuales y sin probar). **No se probó en Ubuntu**; los pasos están documentados.

1. Instale Docker Engine con el plugin de Compose siguiendo la
   [guía oficial para Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
2. Clone el repositorio y cree el `.env`:

   ```
   git clone <url-del-repositorio>
   cd <carpeta-del-repositorio>
   cp .env.example .env
   ```

3. Edite el `.env`: contraseñas de los roles y `API_KEY` (comandos de generación en «Arranque rápido»), y
   `RATE_LIMIT_MAX=1000` y `RATE_LIMIT_POST_MAX=200` (o borre esas dos líneas).
4. Levante y compruebe:

   ```
   docker compose -f docker-compose.yml up -d --build --wait
   docker compose -f docker-compose.yml ps
   ```

Detalle en [Despliegue en Ubuntu](docs-tecnicos/despliegue.md#despliegue-en-ubuntu).

## Arquitectura

Tres piezas, cada una con un solo trabajo:

```
navegador -> servidor de Next (puerto 3001) -> Express (puerto 3000) -> PostgreSQL
                       |
                       +-> Prisma (rol reader) -> vista de conteos
```

- **Navegador:** solo habla con el servidor de Next. No ve la API key, ni la URL de Express ni la base de datos.
- **Servidor de Next (frontend):** sirve la página, lee los contadores con el rol `reader` y reenvía las operaciones a
  Express con la API key, que solo existe en el servidor.
- **Express (backend):** valida, aplica los límites y hace todo el CRUD con el rol `writer`.
- **PostgreSQL:** guarda las tareas; `owner` solo migra, `writer` escribe y `reader` solo lee la vista de conteos.

### Recorrido de una petición

Ejemplo: el usuario completa una tarea.

1. El navegador envía `PUT /api/tasks/<id>` al servidor de Next (su propio origen).
2. La ruta de Next comprueba el origen (rechaza con 403 un `Origin` ajeno) y valida lo que recibe.
3. La ruta llama a Express con `Authorization: Bearer <API key>`; la key viaja solo entre servidores.
4. Express comprueba la API key, aplica los límites de peticiones, valida el cuerpo y el identificador, y ejecuta un
   `UPDATE` con SQL parametrizado usando el rol `writer`.
5. PostgreSQL responde, Express devuelve la tarea (o un error sin detalles internos) y Next la entrega al navegador.
6. La página vuelve a leer la lista y los contadores: estos últimos salen de una vista de PostgreSQL, con el rol
   `reader`, que no tiene acceso a la tabla `tasks`.

## Estructura del repositorio

- `backend/`: Express con TypeScript y la API de tareas protegida por API key; contiene Prisma (esquema y migraciones).
- `frontend/`: Next.js (App Router) con TypeScript y Tailwind: página con filtro y contadores, y lista interactiva. Su
  plantilla de variables es `frontend/.env.example`.
- `docker-compose.dev.yml` y `docker/postgres/init/`: PostgreSQL de desarrollo y script de roles y bases.
- `docker-compose.yml`: despliegue completo con Docker Compose.
- `backend/queries.sql`: consultas SQL de la prueba.
- `scripts/`: arranque conjunto (`npm run dev`) y sus ayudantes.
- `integration/`: pruebas con procesos reales (`npm run test:integration`).
- `tests/` (raíz): solo la prueba del entorno cerrado (`closed-env`). Las pruebas de integración están en `integration/`.
- `docs-tecnicos/`: referencia técnica enlazada desde este README (ver «Documentación técnica»).
- `.env.example`: plantilla de variables de entorno (el `.env` real no se sube).

## Versiones usadas

Leídas de los `package.json` (raíz, `backend/` y `frontend/`, todas exactas), de `docker-compose.yml` y de los
Dockerfile.

- Node.js: `^22.12.0 || ^24.0.0 || >=26.0.0` (campo `engines`); las imágenes usan node:26.1.0-bookworm-slim.
- PostgreSQL: postgres:16.15 (imagen de la composición).
- Docker 29.6.2 y Compose v5.3.1 (las versiones con las que se comprobó el despliegue).
- Backend: express 5.3.0, helmet 8.3.0, express-rate-limit 8.7.1, pg 8.23.1, prisma 7.10.1 (migraciones), supertest 7.3.1.
- Frontend: next 16.4.3 (App Router), react 19.3.1, react-dom 19.3.1, prisma 7.10.1 y @prisma/adapter-pg 7.10.1
  (solo lectura), tailwindcss 4.3.3 con @tailwindcss/postcss 4.3.3 y postcss 8.5.31, jsdom 30.1.3 y
  @testing-library/react 16.3.3 (pruebas de componentes).
- Herramientas comunes: typescript 6.0.3, vitest 5.0.5, eslint 10.13.0, typescript-eslint 8.72.0 y prettier 3.9.10.

## Seguridad (resumen)

El detalle de cada punto está en [backend](docs-tecnicos/backend.md) y en
[defensa de origen](docs-tecnicos/frontend.md#defensa-de-origen-y-de-host).

- **API key:** Express exige `Authorization: Bearer` en toda ruta salvo `/health`; la compara con
  `crypto.timingSafeEqual` y responde un `401` genérico. Solo existe en el servidor de Next, nunca en el navegador.
- **Cabeceras:** `helmet` con sus valores por defecto.
- **Límites:** dos cupos por IP (general y de `POST`) con `express-rate-limit`, y bloqueo de la IP tras fallos de key.
- **CORS:** escrito a mano, con un solo origen permitido.
- **Defensa de origen:** las escrituras de las API Routes responden `403` con `Origin` ajeno, `null` o
  `Sec-Fetch-Site: cross-site`; `ALLOWED_HOSTS` opcional valida el `Host`.
- **Roles:** `owner` solo migra, `writer` solo escribe en `tasks` y `reader` solo lee la vista de conteos.
- **Entrada:** validación estricta (tipos, longitudes, UUID, campos desconocidos), tamaño máximo y SQL parametrizado.
- **Errores y logs:** respuestas sin detalles internos; logs con lista cerrada de campos y sin datos de usuario.
- **Secretos:** solo en variables de entorno; `.env` fuera del repositorio y nunca `NEXT_PUBLIC_`.
- **Red:** en Docker solo se publica el frontend, en `127.0.0.1`; la base de datos y Express no tienen puerto expuesto.

## Cupo compartido por diseño (desviación declarada)

El servidor del frontend **nunca envía `X-Forwarded-For` ni otra cabecera de IP**, y ninguna cabecera del navegador
llega a Express (se comprobó con procesos reales y un Express sustituto que registra lo que recibe, en doce casos).
Por tanto Express cuenta a todos los
usuarios del frontend como una sola IP: la de loopback en desarrollo y la interna de la red de Docker en el despliegue.
Todos los usuarios comparten el cupo de peticiones y la IP no aparece en respuestas ni en registros del frontend.

- **Por qué.** Next 16.4.3 conserva el `X-Forwarded-For` que mande el navegador (solo lo rellena cuando falta) y el
  código de las rutas del servidor no ve el socket de la conexión. Enviar a Express una IP que el navegador pueda
  falsificar permitiría esquivar el límite o hacer que se bloquee a otra persona.
- **Alternativas descartadas.**
  - Copiar o anexar la cabecera del navegador: es falsificable.
  - Un servidor Node propio delante de Next que fije la IP del socket: añade piezas que la prueba no pide.
- **Riesgo aceptado.** Un usuario puede agotar el cupo de todos, y los fallos de key bloquean a todos hasta que
  termina la ventana (ver «Bloqueo por intentos fallidos»). En una demo con varias personas, súbanse `RATE_LIMIT_MAX` y
  `RATE_LIMIT_POST_MAX` (el segundo no puede superar al primero); `.env.example` trae comentados 1000 y 200.
- **`TRUSTED_PROXIES`.** Vale `loopback` por defecto, que mientras el frontend no envíe la cabecera equivale a `none`
  (no cambia el resultado). En Docker y en las pruebas extremo a extremo se usa `TRUSTED_PROXIES=none`.
- **Con un proxy de confianza delante.** Si un proxy sobrescribe `X-Forwarded-For` con la IP de la conexión del
  usuario, el backend ya soporta la IP real (ver «IP real del cliente y proxies de confianza»); no hace falta cambiar
  código.

## Pruebas

Resumen: qué grupos de pruebas hay, dónde viven y con qué comando se ejecutan. Cada comando se ejecuta dentro de la
carpeta indicada (`backend/`, `frontend/` o la raíz).

| Grupo                                            | Dónde                                         | Comando                                   |
| ------------------------------------------------ | --------------------------------------------- | ----------------------------------------- |
| Unitarias, API (Supertest), base de datos y procesos del backend | `backend/tests/` | `npm test` (en `backend/`)        |
| Servidor y componentes del frontend              | `frontend/tests/`                             | `npm test` (en `frontend/`)               |
| Arranque conjunto (validación de variables)      | `integration/dev-invalid-env.integration.test.js` | `npm run test:integration` (en la raíz) |
| Procesos reales (Express sustituto y `next start`) | `integration/` (raíz)                       | `npm run test:integration` (en la raíz)   |
| Calidad de código                                | los tres paquetes                             | `npm run lint` y `npm run typecheck`      |
| Compilación                                      | `backend/` y `frontend/`                      | `npm run build`                           |
| Comprobación manual del despliegue               | Docker Desktop (ver «Comprobación manual»)    | los comandos de cada paso                 |

Cobertura: el mínimo es del 80 % de líneas y sentencias en el global y del 90 % en validación y rutas (backend y
frontend); si baja, `npm test` falla. La raíz no tiene umbral. La cobertura sirve para encontrar huecos, no como
objetivo. Los Dockerfiles, el compose y el README no se prueban con Vitest: se validan con
`docker compose config --quiet` y construyendo las imágenes.

Pruebas extremo a extremo: no hay un comando `e2e` en los `package.json`, así que este README no documenta ninguno. Lo
más cercano son las pruebas de procesos reales (`npm run test:integration`) y la comprobación manual del despliegue.

Comprobación manual del despliegue: de los 20 pasos de «Comprobación manual», el usuario ejecutó en Docker Desktop 10 de
los 20 pasos, total o parcialmente. Resultado registrado: 4 cumple, 6 parcial y 10 no ejecutado. Los pasos no
ejecutados son 2, 5, 6, 8, 9, 12, 13, 16, 18 y 19, y quedan como lista de verificación para quien despliegue. Si sobra
tiempo, conviene ejecutar al menos 6, 8 y 16 (migración fallida, red interna sin salida y ausencia de secretos). Nada de
lo no ejecutado se da por probado.

El detalle por paquete (base de datos real, concurrencia, seguridad, cierre ordenado y frontend) está en
[Detalle de las pruebas](docs-tecnicos/desarrollo.md#detalle-de-las-pruebas).

## Decisiones técnicas

Cada decisión se escribe con el mismo formato: qué se decidió, por qué y qué alternativa se descartó. Aquí van las
quince principales; el detalle completo, con las decisiones D16 a D23 (entrada estricta, consulta cruda, fecha
truncada, orden de comprobación, `PUT` parcial, filas afectadas, identificador estricto y otras de seguridad), está en
[docs-tecnicos/decisiones.md](docs-tecnicos/decisiones.md). Los riesgos abiertos están en «Riesgos residuales y
limitaciones».

### D1. Monorepo con `backend/` y `frontend/`

- **Decisión:** un solo repositorio con un `package.json` por paquete y otro en la raíz.
- **Porqué:** se revisa y se versiona todo junto, y los cambios que afectan a las dos partes llegan coherentes.
- **Alternativa descartada:** dos repositorios, que complicarían la coordinación sin aportar nada a un proyecto así.

### D2. Solo Express escribe en la base de datos

- **Decisión:** toda escritura pasa por Express, que valida y aplica las reglas en un solo lugar.
- **Porqué:** las reglas viven en un único sitio y la superficie de ataque es la menor posible.
- **Alternativa descartada:** que el frontend escriba en la base de datos.

### D3. Tres roles de base de datos con mínimo privilegio

- **Decisión:** `owner` migra (solo al desplegar), `writer` (Express) tiene `SELECT`, `INSERT`, `UPDATE` y `DELETE` solo
  sobre `tasks` y `reader` solo lee una vista de conteos; un script SQL idempotente aplica los permisos tras migrar.
- **Porqué:** si una credencial se filtra, el daño queda acotado a lo que ese rol puede hacer.
- **Alternativa descartada:** un único usuario con todos los permisos.

### D4. Vista de conteos para el frontend

- **Decisión:** el frontend lee los contadores de la vista `task_counts`; `reader` no puede leer `tasks`.
- **Porqué:** aun con la credencial de `reader` filtrada, solo se verían tres números.
- **Alternativa descartada:** dar a `reader` `SELECT` sobre `tasks` y contar en el frontend, que expondría las tareas.

### D5. Prisma en backend y frontend, con papeles distintos

- **Decisión:** en el backend, Prisma es dueño del esquema y de las migraciones (escritas a mano); en el frontend solo
  lee los contadores en un Server Component y su esquema sale de `prisma db pull`.
- **Porqué:** hay un único dueño del esquema y el frontend queda reducido a lo que necesita leer.
- **Alternativa descartada:** que el frontend tenga también migraciones.

### D6. `pg` y `Pool` en las consultas de Express

- **Decisión:** Express consulta con `pg` y un `Pool` explícito, con SQL escrito a mano y parametrizado.
- **Porqué:** se pidieron un pool explícito y SQL a mano, y así cada consulta se lee y se prueba tal cual.
- **Alternativa descartada:** usar Prisma también para las consultas de Express.

### D7. Sin Server Actions

- **Decisión:** las escrituras van del cliente a API Routes de Next y de ahí a Express.
- **Porqué:** hay menos conceptos que explicar y el recorrido de cada petición es explícito.
- **Alternativa descartada:** Server Actions.

### D8. API key entre Next y Express

- **Decisión:** clave aleatoria de 32 bytes o más en `Authorization: Bearer`, comparada con `crypto.timingSafeEqual`
  sobre su SHA-256 y con `401` genérico; solo de servidor; toda ruta la exige salvo `/health` y el preflight de CORS.
- **Porqué:** no deja la key en la URL, la comparación no revela la longitud y denegar por defecto hace que una ruta
  nueva nazca protegida. La key autentica a la aplicación, no a las personas.
- **Alternativa descartada:** una cabecera propia o la key en la consulta, comparar con `===` y una lista de rutas
  protegidas.

### D9. Rate limiting con `express-rate-limit`

- **Decisión:** dos cupos por IP de la conexión (general y de `POST`), ventana fija, almacén en memoria y valores por
  variables de entorno; el bloqueo por fallos de key tiene su propio contador y bloquea toda la IP.
- **Porqué:** la librería hace el trabajo sin código propio de más, y el almacén en memoria basta para una instancia.
- **Alternativa descartada:** un contador propio para los dos cupos, Redis y bloquear solo las keys erróneas.

### D10. Cupo compartido y `TRUSTED_PROXIES`

- **Decisión:** los límites cuentan la IP de la conexión, que para el frontend es siempre la misma, así que todos
  comparten el cupo; `TRUSTED_PROXIES` (`loopback` por defecto, `none` en la composición) dice de quién se fía el
  servicio para leer la IP.
- **Porqué:** Next conserva la cabecera del navegador y las rutas no ven el socket, así que una IP reenviada sería
  falsificable.
- **Alternativa descartada:** reenviar la IP desde el frontend o un servidor Node propio, y en `TRUSTED_PROXIES`, `true`
  o un número de saltos.

### D11. Defensa de origen en las escrituras del frontend

- **Decisión:** `POST`, `PUT` y `DELETE` de las API Routes responden `403` si `Origin` no coincide con el `Host`, es
  `null` o `Sec-Fetch-Site` es `cross-site`.
- **Porqué:** sin sesión no hay dónde anclar un token, y esas cabeceras las pone el navegador y una web ajena no puede
  falsificarlas.
- **Alternativa descartada:** un token CSRF y CORS en las rutas (no impide que la petición se envíe).

### D12. Redis descartado

- **Decisión:** no se usa Redis; los contadores viven en la memoria de la instancia.
- **Porqué:** no hay un problema de carga que lo justifique y añade un servicio, una credencial y más superficie de
  ataque. Queda como «Trabajo futuro».
- **Alternativa descartada:** Redis para la caché y para un contador compartido entre instancias.

### D13. Login de usuarios fuera de alcance

- **Decisión:** la aplicación no tiene login; la key autentica a la aplicación, no a las personas.
- **Porqué:** un login a medias sería peor que ninguno; solo tendría sentido completo. Queda como «Trabajo futuro».
- **Alternativa descartada:** un login mínimo dentro de esta entrega.

### D14. Índice sobre `completed`

- **Decisión:** `tasks_completed_idx` sobre la columna `completed`.
- **Porqué:** con pocas filas aporta poco; se justifica por el patrón de consulta (casi todas las lecturas filtran por
  estado) y por el crecimiento esperado de la tabla. El filtro `WHERE completed = $1` y el conteo `GROUP BY completed`
  leen por esa columna; con pocas filas el planificador puede preferir un recorrido secuencial y el índice paga al
  crecer la tabla.
- **Alternativa descartada:** no crear el índice, o uno por fecha (`createdAt DESC, id`).

### D15. Despliegue con Docker Compose

- **Decisión:** un `docker-compose.yml` con cuatro servicios (`postgres`, `migrate`, `backend`, `frontend`). Las imágenes
  usan etiquetas exactas (`node:26.1.0-bookworm-slim`, `postgres:16.15`) y el frontend se compila en modo `standalone`.
  La red interna (`internal: true`) no tiene salida y solo el frontend se publica, en `127.0.0.1:3001`. Solo `migrate`
  recibe la credencial de `owner`: aplica migraciones y permisos y termina. El endurecimiento incluye `cap_drop: ALL`,
  `no-new-privileges`, sistema de archivos de solo lectura con `tmpfs` y límites de recursos; el backend y `postgres`
  salen con 0 y el frontend con 143.
- **Porqué:** una etiqueta exacta evita que un cambio externo rompa la construcción; `standalone` copia solo lo que Next
  necesita; la red interna y el reparto de credenciales mantienen el mínimo privilegio en ejecución. El 143 es
  `SIGTERM` sin salida propia de Next: limitación conocida que no pierde datos.
- **Alternativa descartada:** etiquetas flotantes, copiar `node_modules` completo a la imagen, una red con salida y que
  el backend migre al arrancar con una credencial más amplia.

## Riesgos residuales y limitaciones

Esta es la única sección de riesgos del README; la lista completa de límites está en
[decisiones](docs-tecnicos/decisiones.md#límites-de-la-implementación-detalle).

- **Cupo compartido.** Todos los usuarios comparten un solo cupo y uno puede agotarlo para todos (ver «Cupo compartido
  por diseño (desviación declarada)»).
- **Sin login.** Quien alcance la página puede crear, editar y borrar tareas; un cliente que no es un navegador
  (`curl`) pasa la defensa de origen. Por eso el servidor escucha solo en `127.0.0.1`.
- **Sin HTTPS propio.** No exponga la aplicación a internet sin un proxy con TLS delante.
- **Ubuntu: documentados, no probados.** Los pasos de [Despliegue en Ubuntu](docs-tecnicos/despliegue.md#despliegue-en-ubuntu)
  no se ejecutaron en una máquina Ubuntu.
- **Comprobación manual incompleta.** Resultado registrado: 4 cumple, 6 parcial y 10 no ejecutado (pasos 2, 5, 6, 8, 9,
  12, 13, 16, 18 y 19).
- **Memoria y ventana fija.** Los contadores viven en la memoria de una instancia (se pierden al reiniciar) y en la
  frontera entre ventanas puede pasar hasta el doble del cupo.
- **Lista con tope.** `GET /api/tasks` devuelve como máximo `TASKS_LIST_LIMIT` tareas, sin paginación ni aviso.
- **Dos caminos de lectura.** Los contadores (Prisma) y la lista (Express) pueden diferir un instante tras escribir.
- **Frontend con código 143** al parar (limitación conocida de Next; no pierde datos).

## Trabajo futuro

- Redis para caché y para un contador de rate limiting compartido entre varias instancias.
- Login de usuarios, implementado de forma completa.
- HTTPS (terminación TLS) antes de exponer la aplicación fuera de la red local.
- Ejecutar en una máquina Ubuntu los pasos documentados y los pasos 2, 5, 6, 8, 9, 12, 13, 16, 18 y 19 de la
  comprobación manual.

## Documentación técnica

La referencia técnica vive en `docs-tecnicos/`:

- [Desarrollo](docs-tecnicos/desarrollo.md): base de datos de desarrollo, instalación, arranque conjunto y cómo ejecutar.
- [Backend](docs-tecnicos/backend.md): variables, roles y permisos, migraciones, seguridad, límites, CORS y logs.
- [API](docs-tecnicos/api.md): tareas, validación y contrato de errores.
- [Frontend](docs-tecnicos/frontend.md): página, API Routes, defensa de origen y cliente interactivo.
- [Despliegue](docs-tecnicos/despliegue.md): Docker Compose y despliegue en Ubuntu.
- [Comprobación manual](docs-tecnicos/comprobacion-manual.md): los 20 pasos y su resultado.
- [Decisiones](docs-tecnicos/decisiones.md): D1 a D23 completas y límites de la implementación.
