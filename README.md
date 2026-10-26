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
- [Arranque rápido](#arranque-rápido)
- [Arquitectura](#arquitectura) y [Recorrido de una petición](#recorrido-de-una-petición)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Versiones usadas](#versiones-usadas)
- [Referencia técnica](#referencia-técnica), movida a `docs-tecnicos/`:
  [desarrollo](docs-tecnicos/desarrollo.md) (base de datos de desarrollo, instalación, arranque conjunto y cómo
  ejecutar), [backend](docs-tecnicos/backend.md) (variables, roles y permisos, migraciones),
  [API](docs-tecnicos/api.md) (tareas y contrato de errores) y [frontend](docs-tecnicos/frontend.md),
  [despliegue con Docker Compose](docs-tecnicos/despliegue.md), [comprobación manual](docs-tecnicos/comprobacion-manual.md),
  [Ubuntu](docs-tecnicos/despliegue.md#despliegue-en-ubuntu) y [decisiones](docs-tecnicos/decisiones.md)
- [Cupo compartido por diseño (desviación declarada)](#cupo-compartido-por-diseño-desviación-declarada)
- [Pruebas](#pruebas)
- [Decisiones técnicas](#decisiones-técnicas)
- [Riesgos residuales y limitaciones](#riesgos-residuales-y-limitaciones)
- [Trabajo futuro](#trabajo-futuro)

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
desarrollo. Detalles, límites y comprobaciones en «Despliegue con Docker Compose». Para desarrollar con recarga, ver
«Instalación» y «Arranque conjunto».

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

- `backend/`: paquete del backend con TypeScript; contiene Prisma (esquema y migraciones) y el servicio HTTP con Express con la API de tareas (leer, crear, actualizar y borrar), protegido por API key.
- `frontend/`: aplicación Next.js (App Router) con TypeScript y Tailwind. Tiene la página principal con el filtro y los
  contadores, y la lista interactiva para crear, completar, editar y borrar tareas (ver «Frontend»). Su plantilla de variables es `frontend/.env.example`.
- `docker-compose.dev.yml` y `docker/postgres/init/`: PostgreSQL de desarrollo y script de roles y bases.
- `docker-compose.yml`: despliegue completo con Docker Compose (ver «Despliegue con Docker Compose»).
- `backend/queries.sql`: consultas SQL de la prueba.
- `scripts/`: arranque conjunto (`npm run dev`) y sus ayudantes.
- `integration/`: pruebas con procesos reales (`npm run test:integration`).
- `tests/`: pruebas de los scripts de la raíz y del contenido de este README.
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

## Referencia técnica

El detalle técnico vive en `docs-tecnicos/` (el contenido es el mismo, solo se movió de sitio):

- [Backend](docs-tecnicos/backend.md#backend)
- [Base de datos de desarrollo](docs-tecnicos/desarrollo.md#base-de-datos-de-desarrollo)
- [Logs](docs-tecnicos/backend.md#logs)
- [Rutas del servicio](docs-tecnicos/backend.md#rutas-del-servicio)
- [Seguridad: API key](docs-tecnicos/backend.md#seguridad-api-key)
- [Seguridad: cabeceras](docs-tecnicos/backend.md#seguridad-cabeceras)
- [IP real del cliente y proxies de confianza](docs-tecnicos/backend.md#ip-real-del-cliente-y-proxies-de-confianza)
- [Despliegue con Docker Compose](docs-tecnicos/despliegue.md#despliegue-con-docker-compose)
- [Comprobación manual del despliegue](docs-tecnicos/comprobacion-manual.md)
- [Despliegue en Ubuntu](docs-tecnicos/despliegue.md#despliegue-en-ubuntu)
- [Detalle de las decisiones D1 a D23](docs-tecnicos/decisiones.md#detalle-de-las-decisiones)

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

Continúa la referencia técnica (en `docs-tecnicos/`):

- [Límite de peticiones](docs-tecnicos/backend.md#límite-de-peticiones)
- [Bloqueo por intentos fallidos](docs-tecnicos/backend.md#bloqueo-por-intentos-fallidos)
- [CORS](docs-tecnicos/backend.md#cors)
- [Contrato de errores](docs-tecnicos/api.md#contrato-de-errores)
- [Conexión a la base de datos](docs-tecnicos/backend.md#conexión-a-la-base-de-datos)
- [Variables del servicio](docs-tecnicos/backend.md#variables-del-servicio)
- [Esquema y migraciones](docs-tecnicos/backend.md#esquema-y-migraciones)
- [Consultas SQL](docs-tecnicos/backend.md#consultas-sql-backendqueriessql)
- [Cómo guarda y lee tareas el backend](docs-tecnicos/backend.md#cómo-guarda-y-lee-tareas-el-backend)
- [API de tareas](docs-tecnicos/api.md#api-de-tareas)
- [Validación de título y descripción](docs-tecnicos/api.md#validación-de-título-y-descripción)
- [Entrada de la API: tamaño y tipo de contenido](docs-tecnicos/api.md#entrada-de-la-api-tamaño-y-tipo-de-contenido)
- [Roles y permisos](docs-tecnicos/backend.md#roles-y-permisos)
- [Migrar y aplicar permisos](docs-tecnicos/backend.md#migrar-y-aplicar-permisos)
- [Instalación](docs-tecnicos/desarrollo.md#instalación)
- [Arranque conjunto](docs-tecnicos/desarrollo.md#arranque-conjunto)
- [Arranque](docs-tecnicos/backend.md#arranque)
- [Cierre ordenado](docs-tecnicos/backend.md#cierre-ordenado)
- [Códigos de salida y eventos](docs-tecnicos/backend.md#códigos-de-salida-y-eventos)
- [Frontend](docs-tecnicos/frontend.md#frontend)
- [Cómo ejecutar](docs-tecnicos/desarrollo.md#cómo-ejecutar)

## Pruebas

Resumen: qué grupos de pruebas hay, dónde viven y con qué comando se ejecutan. Cada comando se ejecuta dentro de la
carpeta indicada (`backend/`, `frontend/` o la raíz).

| Grupo                                            | Dónde                                         | Comando                                   |
| ------------------------------------------------ | --------------------------------------------- | ----------------------------------------- |
| Unitarias, API (Supertest), base de datos, procesos y estáticas del backend | `backend/tests/` | `npm test` (en `backend/`)        |
| Servidor y componentes del frontend              | `frontend/tests/`                             | `npm test` (en `frontend/`)               |
| Scripts del arranque conjunto y contenido del README | `tests/` (raíz)                           | `npm test` (en la raíz)                   |
| Procesos reales (Express sustituto y `next start`) | `integration/` (raíz)                       | `npm run test:integration` (en la raíz)   |
| Calidad de código                                | los tres paquetes                             | `npm run lint` y `npm run typecheck`      |
| Compilación                                      | `backend/` y `frontend/`                      | `npm run build`                           |
| Comprobación manual del despliegue               | Docker Desktop (ver «Comprobación manual»)    | los comandos de cada paso                 |

Cobertura: el mínimo es del 95 % de líneas y sentencias sobre el código propio (backend, frontend y `scripts/` de la
raíz); si baja de ese valor, `npm test` falla. `npm test` ejecuta la cobertura en los tres paquetes.

Pruebas extremo a extremo: no hay un comando `e2e` en los `package.json`, así que este README no documenta ninguno. Lo
más cercano son las pruebas de procesos reales (`npm run test:integration`) y la comprobación manual del despliegue.

Comprobación manual del despliegue: de los 20 pasos de «Comprobación manual», el usuario ejecutó en Docker Desktop 10 de
los 20 pasos, total o parcialmente. Resultado registrado: 4 cumple, 6 parcial y 10 no ejecutado. Los pasos no
ejecutados son 2, 5, 6, 8, 9, 12, 13, 16, 18 y 19, y quedan como lista de verificación para quien despliegue. Si sobra
tiempo, conviene ejecutar al menos 6, 8 y 16 (migración fallida, red interna sin salida y ausencia de secretos). Nada de
lo no ejecutado se da por probado.

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

- [Base de datos](docs-tecnicos/desarrollo.md#base-de-datos)

## Decisiones técnicas

Cada decisión se escribe con el mismo formato: qué se decidió, por qué y qué alternativa se descartó. Los riesgos que
quedan abiertos no se repiten aquí: están en «Riesgos residuales y limitaciones».

### D1. Monorepo con `backend/` y `frontend/`

- **Decisión:** un solo repositorio con una carpeta por paquete y un `package.json` propio en cada una y en la raíz.
- **Porqué:** se revisa y se versiona todo junto, y los cambios que afectan a las dos partes llegan coherentes.
- **Alternativa descartada:** dos repositorios, que complicarían la revisión y la coordinación sin aportar nada a un
  proyecto de este tamaño.

### D2. Solo Express escribe en la base de datos

- **Decisión:** toda escritura pasa por Express, que valida y aplica las reglas de negocio en un solo lugar.
- **Porqué:** las reglas viven en un único sitio y la superficie de ataque es la menor posible.
- **Alternativa descartada:** que el frontend escriba en la base de datos, lo que repartiría las reglas y ampliaría la
  superficie de ataque.

### D3. Tres roles de base de datos con mínimo privilegio

- **Decisión:** `owner` ejecuta las migraciones y solo se usa al desplegar; `writer` (Express) tiene `SELECT`, `INSERT`,
  `UPDATE` y `DELETE` solo sobre `tasks`; `reader` solo lee una vista de conteos, sin acceso a `tasks`. Los permisos
  se aplican con un script SQL idempotente que ejecuta `owner` después de migrar (ver «Roles y permisos»).
- **Porqué:** si una credencial se filtra, el daño queda acotado a lo que ese rol puede hacer.
- **Alternativa descartada:** un único usuario con todos los permisos.

### D4. Vista de conteos para el frontend

- **Decisión:** el frontend lee los contadores (todas, completadas, pendientes) de la vista `task_counts`, que se ejecuta
  con los privilegios de su dueño; `reader` no puede leer `tasks`.
- **Porqué:** aun con la credencial de `reader` filtrada, solo se verían tres números.
- **Alternativa descartada:** dar a `reader` `SELECT` sobre `tasks` y contar en el frontend, que expondría todas las
  tareas.

### D5. Prisma en backend y frontend, con papeles distintos

- **Decisión:** en el backend, Prisma es dueño del esquema y de las migraciones (escritas a mano). En el frontend solo
  lee los contadores en un Server Component; su esquema sale de `prisma db pull` y no ejecuta migraciones.
- **Porqué:** hay un único dueño del esquema y el frontend queda reducido a lo que necesita leer.
- **Alternativa descartada:** que el frontend tenga también migraciones, lo que repartiría la propiedad del esquema.

### D6. `pg` y `Pool` en las consultas de Express

- **Decisión:** Express consulta con `pg` y un `Pool` explícito, con SQL escrito a mano y parametrizado.
- **Porqué:** se pidieron un pool explícito y SQL a mano, y así el texto de cada consulta se lee y se prueba tal cual.
- **Alternativa descartada:** usar Prisma también para las consultas de Express.

### D7. Sin Server Actions

- **Decisión:** las escrituras van del cliente a API Routes de Next y de ahí a Express.
- **Porqué:** hay menos conceptos que explicar y el recorrido de cada petición es explícito.
- **Alternativa descartada:** Server Actions.

### D8. API key entre Next y Express

- **Decisión:** las API Routes se autentican ante Express con una clave aleatoria de 32 bytes o más, enviada en
  `Authorization: Bearer` y comparada con `crypto.timingSafeEqual` sobre su SHA-256, con respuesta `401` genérica. Es
  solo de servidor (nunca llega al navegador) y se rota cambiando la variable de entorno. La guarda se aplica con
  `app.use` tras registrar `/health`: toda ruta exige key salvo `/health` y el preflight de CORS válido.
- **Porqué:** es el estándar para enviar credenciales y no deja la key en la URL, que queda en historiales y registros
  de proxies. Ambos resúmenes miden 32 bytes: la comparación no lanza ni revela la longitud. Denegar por defecto hace
  que una ruta nueva nazca protegida, y comprobar la key antes que `404` y `405` evita que quien no la tiene averigüe
  qué rutas existen. La key autentica a la aplicación, no a las personas.
- **Alternativa descartada:** una cabecera propia o la key en la consulta; comparar con `===` (el tiempo depende de
  dónde falla) o comprobar la longitud antes (la revela); y una lista de rutas protegidas, donde una ruta nueva nacería
  sin protección.

### D9. Rate limiting con `express-rate-limit`

- **Decisión:** dos cupos por IP de la conexión (general y de `POST`), ventana fija, almacén en memoria y valores por
  variables de entorno (ver «Límite de peticiones»). El bloqueo por intentos fallidos de key tiene su propio contador
  síncrono, que suma solo al emitir el `401` (ver «Bloqueo por intentos fallidos»). Si la IP bloqueada pudiera entrar
  con la key buena, quien adivina seguiría obteniendo señal, así que el bloqueo es de toda la IP.
- **Porqué:** la librería hace el trabajo sin código propio de más y el almacén en memoria basta para una sola
  instancia; el contador propio es exacto con peticiones simultáneas.
- **Alternativa descartada:** un contador propio para los dos cupos (más código y deja la librería sin uso), Redis (sin
  problema de carga que lo justifique), `skipSuccessfulRequests` de la librería (inexacto en ese caso) y bloquear solo
  las keys erróneas.

### D10. Cupo compartido y `TRUSTED_PROXIES`

- **Decisión:** los límites cuentan la IP de la conexión, que para el frontend es siempre la misma, así que todos los
  usuarios comparten el cupo. El frontend nunca envía `X-Forwarded-For`. `TRUSTED_PROXIES` dice de quién se fía el
  servicio para leer la IP (`loopback` por defecto; `none` en la composición). Ver «Cupo compartido por diseño
  (desviación declarada)».
- **Porqué:** Next conserva la cabecera del navegador y las rutas no ven el socket, así que una IP reenviada sería
  falsificable (esquivar el límite o bloquear a otro). El backend sí soporta la IP real tras un proxy de confianza.
- **Alternativa descartada:** reenviar la IP desde el frontend o un servidor Node propio que fije la IP del socket (más
  piezas sin que nadie lo pida); en `TRUSTED_PROXIES`, `true` (cualquiera falsifica su IP), un número de saltos (depende
  de la topología) y el `trust proxy` de Express (su `req.ip` no sirve con reglas escritas y probadas).

### D11. Defensa de origen en las escrituras del frontend

- **Decisión:** `POST`, `PUT` y `DELETE` de las API Routes responden `403` si `Origin` no coincide con el `Host`, es
  `null` o `Sec-Fetch-Site` es `cross-site`; `ALLOWED_HOSTS` opcional valida el `Host` (ver «Defensa de origen y de
  `Host`»).
- **Porqué:** sin sesión no hay dónde anclar un token, y esas cabeceras las pone el navegador y una web ajena no puede
  falsificarlas.
- **Alternativa descartada:** un token CSRF y CORS en las rutas (no impide que la petición se envíe, solo que se lea la
  respuesta).

### D12. Redis descartado

- **Decisión:** no se usa Redis; los contadores viven en la memoria de la instancia.
- **Porqué:** no hay un problema de carga que lo justifique y añade un servicio, una credencial y más superficie de
  ataque; el `Pool` y el índice cubren la carga prevista. Queda como «Trabajo futuro».
- **Alternativa descartada:** Redis para la caché y para un contador compartido entre instancias.

### D13. Login de usuarios fuera de alcance

- **Decisión:** la aplicación no tiene login; la key autentica a la aplicación, no a las personas.
- **Porqué:** un login a medias sería peor que ninguno; solo tendría sentido completo (hash de contraseñas, expiración
  de tokens, protección CSRF). Queda como «Trabajo futuro».
- **Alternativa descartada:** un login mínimo dentro de esta entrega.

### D14. Índice sobre `completed`

- **Decisión:** `tasks_completed_idx` sobre la columna `completed`.
- **Porqué:** con pocas filas aporta poco beneficio; se justifica por el patrón de consulta (casi todas las lecturas
  filtran por estado) y por el crecimiento esperado de la tabla (ver «Base de datos»).
- **Alternativa descartada:** no crear el índice, o uno por fecha (`createdAt DESC, id`), que sería la mejora si la
  lista creciera mucho (ver «Tope de la lista»).

### D15. Despliegue con Docker Compose

- **Decisión:** un `docker-compose.yml` con cuatro servicios (`postgres`, `migrate`, `backend`, `frontend`). Las imágenes
  usan etiquetas exactas (`node:26.1.0-bookworm-slim`, `postgres:16.15`). El frontend se compila en modo `standalone`.
  La red interna (`internal: true`) no tiene salida y solo el frontend se publica, en `127.0.0.1:3001`. Solo `migrate`
  recibe la credencial de `owner`: aplica migraciones y permisos y termina. El endurecimiento incluye `cap_drop: ALL`,
  `no-new-privileges`, sistema de archivos de solo lectura con `tmpfs` y límites de recursos, y los plazos de cierre
  están fijados por servicio: el backend y `postgres` salen con 0 y el frontend con 143.
- **Porqué:** una etiqueta exacta evita que un cambio externo rompa la construcción; `standalone` copia solo lo que Next
  necesita; la red interna y el reparto de credenciales mantienen el mínimo privilegio también en tiempo de ejecución.
  El 143 es `SIGTERM` sin salida propia de Next: es una limitación conocida y no pierde datos (ver «Plazos de cierre»).
- **Alternativa descartada:** etiquetas flotantes, copiar `node_modules` completo a la imagen, una red con salida y que
  el backend migre al arrancar con una credencial más amplia.

### D16. Entrada estricta en `/api`

- **Decisión:** el tamaño (10 240 bytes) se comprueba antes que el tipo y `Content-Encoding` solo puede ser `identity`; el
  cuerpo debe ser UTF-8 bien formado y nunca se sustituyen bytes inválidos por U+FFFD. Se usa un lector de cuerpo
  propio.
- **Porqué:** un cuerpo enorme o comprimido se corta sin leerlo ni descomprimirlo (no hay bomba de descompresión) y no se
  guardan datos distintos de los enviados.
- **Alternativa descartada:** `express.json` con sus opciones, que acepta otros tipos y codificaciones y no permite fijar
  este orden.

### D17. Consulta cruda

- **Decisión:** `?completed=` se evalúa sobre la cadena sin interpretar (el intérprete de consulta de Express está
  desactivado).
- **Porqué:** ese intérprete descarta claves como `__proto__` y trunca a 1 000 parámetros, lo que dejaría pasar
  parámetros sin verlos.
- **Alternativa descartada:** usar `req.query`.

### D18. Fecha truncada en SQL

- **Decisión:** `createdAt` sale ya formateado de la consulta, con los microsegundos truncados a milisegundos y en UTC, y
  la lista se ordena por la marca completa.
- **Porqué:** la hora mostrada nunca es posterior a la guardada y el orden no depende de la zona horaria ni del
  redondeo.
- **Alternativa descartada:** formatear en JavaScript con `Date`, que redondea y pierde el orden fino.

### D19. Orden fijo de comprobación

- **Decisión:** cinco etapas previas (P0 a P4: cabeceras, cupo general, preflight, key y bloqueo, cupo de `POST`) y ocho de
  la petición: ruta y método, tamaño, codificación y tipo, cuerpo, identificador, consulta y campos, existencia de la
  tarea, base de datos (ver «Orden de comprobación de una petición»). Solo la etapa de consulta y campos acumula
  problemas.
- **Porqué:** el resultado de una petición con varios fallos es siempre el mismo: un `400` gana a un `404` y una base de
  datos caída nunca tapa un error de validación.
- **Alternativa descartada:** comprobar cada cosa donde se usa, con un resultado que dependería del camino.

### D20. `PUT` parcial

- **Decisión:** `PUT /api/tasks/:id` escribe solo los campos enviados.
- **Porqué:** el cliente puede completar una tarea enviando únicamente `{"completed":true}`, y una pestaña con datos
  viejos no pisa los cambios hechos desde otra. Es una desviación consciente del `PUT` puro.
- **Alternativa descartada:** reemplazo completo, que obligaría a reenviar todos los campos y sobrescribiría cambios
  ajenos.

### D21. Existencia por filas afectadas

- **Decisión:** `UPDATE` y `DELETE` son una sola sentencia y la tarea «no existe» si afectaron cero filas.
- **Porqué:** no hay carrera entre comprobar y escribir: dos borrados simultáneos dan un `204` y un `404`, y un `PUT`
  concurrente con un `DELETE` da `200` o `404`, nunca `500`.
- **Alternativa descartada:** un `SELECT` previo, que dejaría una ventana en la que otra petición borra la fila y la
  escritura falla o miente.

### D22. Identificador estricto, anclado y decodificado una vez

- **Decisión:** el identificador debe ser un UUID completo (anclado de principio a fin, sin salto de línea final) y se
  decodifica una sola vez. La ruta `/api/tasks/<id>` se registra con una expresión regular sin grupos de captura y el
  código lee el segmento crudo de `req.path`.
- **Porqué:** con un parámetro `:id` Express decodifica el segmento al enrutar y, si tiene un `%` roto, falla con un `500`
  antes de decidir el método. Así un identificador mal formado da `400` en `PUT` y `DELETE`, y `405` con otro método.
- **Alternativa descartada:** la ruta `/api/tasks/:id` con `req.params.id`, que da `500` ante `%E0%A4%A`.

### D23. Otras decisiones de seguridad de la API

- **Decisión:** CORS escrito a mano con un solo origen; `helmet` con sus valores por defecto; tope de la lista
  (`TASKS_LIST_LIMIT`) en lugar de paginación.
- **Porqué:** CORS son pocas líneas sin dependencia; `helmet` basta para una API de JSON y es fácil de explicar; el tope
  protege al servidor sin cambiar el contrato ni el frontend.
- **Alternativa descartada:** el paquete `cors`, cuyos valores por defecto reflejan orígenes; ajustar cada política de
  `helmet` sin beneficio claro; y la paginación, que cambia la respuesta y obliga a rehacer el frontend.

**Nota sobre el historial.** El commit «backend setup con Express y Prisma» abre el backend: Prisma se usa allí para el
esquema y las migraciones, mientras que las consultas de la API se hacen con `pg` y `Pool`.

## Riesgos residuales y limitaciones

Esta es la única sección de riesgos del README; las demás secciones remiten a ella.

**Lo que se asume al usar la aplicación hoy**

- **Cupo compartido.** Todos los usuarios del frontend comparten un solo cupo, porque el frontend nunca envía
  `X-Forwarded-For`. Un usuario puede agotarlo para todos y los fallos de key bloquean a todos (ver «Cupo compartido por
  diseño (desviación declarada)»). Rotar `API_KEY` con el frontend sin reiniciar deja bloqueada su IP hasta que termine
  la ventana (ver «Bloqueo por intentos fallidos»).
- **Sin login.** Quien alcance la página puede crear, editar y borrar tareas; la key autentica a la aplicación, no a las
  personas. Un cliente que no es un navegador (`curl`, un script) no envía `Origin` y pasa la defensa de origen. Por eso
  el servidor escucha solo en `127.0.0.1`.
- **Sin HTTPS propio.** La aplicación no debe exponerse a internet sin un proxy con TLS delante (ver «Antes de exponer a
  una red»).
- **Ubuntu: documentados, no probados.** Los pasos de «Despliegue en Ubuntu» no se ejecutaron en una máquina Ubuntu. La
  restauración de la copia de seguridad tampoco se documentó ni se probó.
- **Comprobación manual del despliegue incompleta.** Resultado registrado: 4 cumple, 6 parcial y 10 no ejecutado. Los
  pasos no ejecutados son 2, 5, 6, 8, 9, 12, 13, 16, 18 y 19; si sobra tiempo, conviene ejecutar al menos 6, 8 y 16 (ver
  «Comprobación manual»).

**Límites de la implementación**

- Hay dos credenciales de base de datos en la aplicación (`writer` y `reader`; el daño posible con `reader` es muy
  limitado).
- Hay dos caminos de lectura: los contadores vía Prisma y la lista vía Express, que pueden diferir un instante tras una
  escritura; se resuelve refrescando tras cada acción.
- Ventana fija en los cupos: en la frontera entre dos ventanas pueden pasar hasta el doble del cupo (2N).
- Los contadores (cupos y fallos) viven en la memoria de una sola instancia: se pierden al reiniciar y no se comparten
  entre instancias.
- El frontend termina con código 143 al parar (limitación conocida de Next; no pierde datos).
- `GET /api/tasks` devuelve como máximo `TASKS_LIST_LIMIT` tareas (las más recientes, sin paginación) y no avisa de que la
  lista está truncada; la tabla puede seguir creciendo (ver «Tope de la lista»).
- No se puede leer una tarea por su identificador: `GET /api/tasks/<id>` da `405`, porque nadie lo ha pedido.
- Los errores de nivel HTTP que resuelve Node antes de Express (cabeceras o URL enormes, método desconocido, petición
  mal formada) los contesta Node con sus propios códigos (400, 414 o 431, a veces sin cuerpo JSON) o cierra la conexión;
  el servicio sigue atendiendo.
- Un cuerpo lento (declara más bytes de los que envía y deja el socket abierto) lo resuelve el plazo de Node.
- Los caracteres invisibles se aceptan (un título solo con U+200B se guarda y se vería vacío).

## Trabajo futuro

- Redis para caché y para un contador de rate limiting compartido entre varias instancias.
- Login de usuarios, implementado de forma completa.
- HTTPS (terminación TLS) antes de exponer la aplicación fuera de la red local.
- Ejecutar en una máquina Ubuntu los pasos documentados y los pasos 2, 5, 6, 8, 9, 12, 13, 16, 18 y 19 de la
  comprobación manual.
