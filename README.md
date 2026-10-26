# To-Do App

Prueba Técnica para Analista de Desarrollo.

## Descripción

Aplicación de lista de tareas (To-Do) con backend en Express, base de datos PostgreSQL y frontend en Next.js.
Permite crear, listar, editar, completar y eliminar tareas, y filtrarlas por estado (todas, completadas, pendientes).
El énfasis del proyecto está en la seguridad y en el mínimo privilegio.

## Tecnologías utilizadas

Las versiones se fijan al crear cada proyecto.

- Node.js
- Express
- helmet 8.3.0 (cabeceras de seguridad)
- express-rate-limit 8.7.1 (límite de peticiones por IP)
- PostgreSQL
- Next.js 16.4.3 (App Router) con React 19.3.1 (frontend)
- Prisma 7.10.1 (en el backend y, solo lectura, en el frontend con `@prisma/adapter-pg`)
- TypeScript 6.0.3
- Tailwind CSS 4.3.3 (con `@tailwindcss/postcss` y PostCSS 8.5.31)
- Vitest 5.0.5
- ESLint 10.13.0, typescript-eslint 8.72.0 y Prettier 3.9.10
- Docker

## Estructura del repositorio

- `backend/`: paquete del backend con TypeScript; contiene Prisma (esquema y migraciones) y el servicio HTTP con Express con la API de tareas (leer, crear, actualizar y borrar), protegido por API key.
- `frontend/`: aplicación Next.js (App Router) con TypeScript y Tailwind. Tiene la página principal con el filtro y los
  contadores, y la lista interactiva para crear, completar, editar y borrar tareas (ver «Frontend»).
- `docker-compose.dev.yml` y `docker/postgres/init/`: PostgreSQL de desarrollo y script de roles y bases.
- `docker-compose.yml`: despliegue completo con Docker Compose (ver «Despliegue con Docker Compose»).
- `backend/queries.sql`: consultas SQL de la prueba.

## Backend

El paquete del backend usa TypeScript estricto, ESLint, Prettier y Vitest con cobertura mínima del 95 %, y Prisma está
configurado para las migraciones. Express construye la aplicación con `createApp` y el servicio se arranca con
`npm start`.
Hay cuatro endpoints, `GET /api/tasks` (lectura), `POST /api/tasks` (creación), `PUT /api/tasks/:id` (actualización) y
`DELETE /api/tasks/:id` (borrado) (ver «API de tareas»). Toda ruta exige API key (ver «Seguridad:
API key»), salvo `GET /health` y el preflight de CORS válido de las rutas de la API (ver «CORS»). Las respuestas llevan cabeceras de `helmet` y `Cache-Control: no-store` (ver «Seguridad: cabeceras»). Cada
IP tiene dos cupos de peticiones (general y de `POST`), y se bloquea temporalmente tras demasiados intentos fallidos de
key (ver «Límite de peticiones» y «Bloqueo por intentos fallidos»). CORS admite un único origen y responde el preflight
de las rutas de la API (ver «CORS»). La lista de tareas tiene un tope (ver «Tope de la lista»). No hay login de usuarios
(ver «Trabajo futuro»).

Aviso: la API ya está protegida, pero NO debe exponerse a internet. No tiene HTTPS propio ni login de usuarios: úsela
solo en la red interna o en loopback, y quien tenga la key puede crear, modificar y borrar tareas.

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
`timeoutMs`): nunca contraseñas, URL de conexión, API key, cabecera `Authorization`, IP del cliente, cabecera `Origin`,
cuerpos de petición ni datos de usuario. Las respuestas 401, 429 y de preflight de CORS no escriben ninguna línea. De un error se
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

`/health` no pide API key (ver «Seguridad: API key»). Las demás rutas, existan o no, dan `401` si la petición no trae la
key. Única excepción: el preflight de CORS válido de una ruta de la API, que se responde con `204` sin key (ver «CORS»).

Las rutas se distinguen exactamente: `/Health` y `/health/` no existen y, con key válida, dan `404 NOT_FOUND`, igual que
cualquier ruta desconocida (con cualquier método; una codificación porcentual inválida en una ruta inexistente también
es 404, no 400); sin key dan `401`. Un método no permitido en una ruta que sí existe da `405 METHOD_NOT_ALLOWED` con la cabecera `Allow` (por
ejemplo `Allow: GET` en `/health`). Esto incluye HEAD y OPTIONS: el servicio no los responde por su cuenta, con una
única excepción, el preflight de CORS válido de las rutas de `/api` (ver «CORS»); `OPTIONS /health` sigue dando `405`
con `Allow: GET`, también sin key. Los 404 y
405 usan el mismo sobre JSON del contrato de errores y no se registran en el log.

## Seguridad: API key

Toda petición, salvo `GET /health` y el preflight de CORS válido (ver «CORS»), debe traer `Authorization: Bearer <key>` con la key configurada en `API_KEY`
(ver «Variables del servicio»). Si falta, está mal formada o no coincide, la respuesta es siempre la misma:
`401 {"error":{"code":"UNAUTHORIZED","message":"No autorizado.","details":[]}}` con `WWW-Authenticate: Bearer`. El
texto es idéntico para todas las causas, para no dar pistas a quien prueba claves.

- **Formato estricto.** La cabecera debe aparecer una sola vez, con el esquema `Bearer` (sin distinguir mayúsculas), un
  único espacio y un valor de 1 a 128 caracteres de `A-Za-z0-9_-`. Un valor fuera de ese formato da `401` sin llegar a
  comparar. (La key configurada en `API_KEY` es más exigente: de 43 a 128 caracteres, ver «Variables del servicio».)
  Dos cabeceras `Authorization` (aunque sean iguales),
  otros esquemas, dos espacios, un tabulador o la key en la URL o en una cookie dan `401`. `Proxy-Authorization` se
  ignora. Node ya recorta los espacios al principio y al final del valor de una cabecera.
- **Denegar por defecto.** `/health` se registra antes de la guarda y la guarda se aplica a todo lo que se registra
  después, sin comparar rutas: la exención la decide el mismo enrutador que despacha `/health`. El preflight de CORS también se registra antes de la guarda,
pero solo atiende a un `OPTIONS` válido (ver «CORS»). Así `/health;x`,
  `//health`, `/%68ealth`, `/Health` y `/health/` no están exentas (dan `401` sin key y `404` con ella) y una ruta nueva
  nace protegida. `/health` sigue su tabla de métodos: `HEAD /health` da `405` con `Allow: GET`, no `401`.
- **Antes de todo lo demás.** La guarda es la etapa P3 de la tubería (ver «Orden de comprobación de una petición»): antes
  solo van las cabeceras (P0), el cupo general (P1) y un preflight de CORS válido (P2). Sin
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

El servicio calcula una «clave de cliente» a partir de la IP de quien llama. La usa para contar las peticiones
en el límite de peticiones (ver «Límite de peticiones»); este apartado explica cómo se obtiene y cómo se configura.

Es una capacidad del backend que hoy NO se aprovecha con el frontend de este repositorio: el servidor de Next nunca
envía `X-Forwarded-For`, así que Express cuenta la dirección de la conexión (ver «Cupo compartido por diseño
(desviación declarada)»). Queda disponible para cuando haya un proxy de confianza delante del backend.

- **Para qué sirve.** Si un proxy de confianza estuviera entre los usuarios y Express, para Express todas las peticiones
  vendrían de ese proxy y un solo usuario agotaría el cupo de todos. Con el proxy en `TRUSTED_PROXIES`, Express lee la
  IP del usuario en `X-Forwarded-For`, pero solo cuando se puede creer.
- **Cuándo se cree `X-Forwarded-For`.** Solo si la conexión TCP viene de una dirección de la lista
  `TRUSTED_PROXIES`. Si viene de otra, la cabecera se ignora y cuenta la dirección de la conexión: quien falsifique
  la cabecera desde fuera no evade nada. `Forwarded` y `X-Real-IP` no se leen nunca.
- **Por qué una lista de direcciones.** Alternativas descartadas: `true` (creer a cualquiera: cualquiera falsifica su
  IP) y un número de saltos (depende de cuántos proxies haya y de que ninguno falle). Una lista dice exactamente de
  quién se fía el servicio. Tampoco se usa `req.ip` de Express con `trust proxy`, que devuelve la entrada no confiable tal
  cual aunque no sea una IP; el servicio tiene su propio cálculo, con reglas escritas y probadas, y `trust proxy` está
  desactivado.
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
    (`10.0.0.0/255.0.0.0`) no se admite. Una IPv4-mapeada con prefijo (`::ffff:a.b.c.d/N`) también se rechaza:
    es ambigua (no está claro si el prefijo cuenta los 96 bits iniciales), así que se elige el lado estricto.
    Los nombres distinguen mayúsculas.
  - `none` (solo, en minúsculas) significa que nadie es de confianza: ninguna cabecera influye y cuenta siempre la
    dirección de la conexión.
  - Ausente equivale a `loopback`. Vacía, con entradas vacías (`a,,b`), `true`, `/0`, `None`, `NONE` o cualquier otro
    texto es inválida y el servicio no arranca (el error nombra la variable, nunca su valor).
- **Requisito del proxy de confianza.** Un proxy que se ponga delante debe SOBRESCRIBIR `X-Forwarded-For` con la
  dirección de su socket entrante, nunca copiar ni anteponer lo que traiga el navegador, y su dirección debe figurar en
  `TRUSTED_PROXIES`. Sin eso la cabecera sería falsificable.
- **Sin cabecera.** Si no llega `X-Forwarded-For` (el caso del frontend de este repositorio), cuenta la dirección de la
  conexión y todos los usuarios del frontend comparten un solo cupo (ver «Cupo compartido por diseño (desviación
  declarada)»).

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

## Límite de peticiones

El servicio limita cuántas peticiones puede hacer cada IP con la librería `express-rate-limit` 8.7.1. Hay dos cupos,
que se cuentan por separado y por la IP de la conexión (ver «IP real del cliente y proxies de confianza» y «Cupo
compartido por diseño (desviación declarada)»):

- **Cupo general (100 por ventana).** Cuenta toda petición a una ruta que no sea `/health`, con cualquier método y con o
  sin key: incluye las que acaban en `401`, `404` o `405`. `/health` no cuenta ni se limita.
- **Cupo de `POST` (20 por ventana).** Cuenta solo los `POST` que llegan con una key válida y con cupo general
  disponible. Un `POST` rechazado después por validación (`400`) o por tipo de contenido (`415`) sí cuenta (se cuenta la
  petición, no el éxito); un `POST` sin key, uno rechazado por el cupo general o `POST /health` no lo consumen. `GET`,
  `PUT` y `DELETE` solo cuentan en el general: son los `POST` los que crean filas.

Al superar un cupo, la respuesta es `429 {"error":{"code":"TOO_MANY_REQUESTS","message":"Demasiadas peticiones.","details":[]}}`
con la cabecera `Retry-After` (segundos enteros, al menos 1, hasta que termine la ventana de esa IP). No se envían
cabeceras `RateLimit-*` ni `X-RateLimit-*`. El servicio no lee el cuerpo de una petición rechazada: si lo trae,
responde con `Connection: close` y cierra la conexión (nunca da `413` en su lugar). Un `429` conserva las cabeceras de
seguridad y no se registra en el log.

- **Ventana fija por IP.** La ventana de cada IP dura `RATE_LIMIT_WINDOW_MS` (15 minutos por defecto) y empieza con su
  primera petición contada; al terminar, su contador vuelve a cero. Con cupo N pasan las N primeras y la N+1 recibe
  `429`. Límite aceptado: una ventana fija puede dejar pasar hasta 2N peticiones en la frontera entre dos ventanas
  (N al final de una y N al principio de la siguiente). Alternativa descartada: ventana deslizante, más compleja y sin
  beneficio con un único cliente.
- **Orden.** El cupo general se cuenta ANTES de mirar la key: una IP agotada recibe `429` aunque la key sea errónea (el
  `429` gana a un `401`). El cupo de `POST` va después de la key y antes de las rutas, así que un `POST` a una ruta que
  daría `405` también se rechaza con `429` si el cupo está agotado.
- **En memoria, un solo proceso.** Los contadores viven en la memoria de la instancia de Express: se pierden al
  reiniciar y no se comparten entre instancias (con varias instancias, cada una cuenta aparte). Redis se deja como
  trabajo futuro: no hay un problema de carga que lo justifique. Al cerrar el servicio se liberan los almacenes y sus
  temporizadores (ver «Cierre ordenado»).
- **Variables.** `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` y `RATE_LIMIT_POST_MAX` (ver «Variables del servicio»).
  `RATE_LIMIT_POST_MAX` no puede ser mayor que `RATE_LIMIT_MAX`: un cupo de `POST` mayor que el general sería
  inalcanzable, porque cada `POST` también gasta del general. Si lo es, el servicio no arranca y el error nombra las dos
  variables (nunca sus valores). Como el defecto de `RATE_LIMIT_POST_MAX` es 20, bajar solo `RATE_LIMIT_MAX` por debajo
  de 20 obliga a bajar también `RATE_LIMIT_POST_MAX`.

## Bloqueo por intentos fallidos

Además de los cupos, el servicio bloquea la IP que acierta mal la key demasiadas veces. Un intento fallido es una
petición que acaba en `401` (sin `Authorization`, mal formada, repetida o con la key equivocada). Tras
`RATE_LIMIT_AUTH_FAILURES_MAX` intentos fallidos (10 por defecto) dentro de la ventana de la IP, TODA petición de esa IP
recibe `429` con `Retry-After` hasta que la ventana termina, incluso si trae la key buena. `/health` ni cuenta ni se
bloquea.

- **Por qué se bloquea toda la IP y no solo las keys erróneas.** Si la IP bloqueada pudiera entrar con la key buena, quien
  adivina la clave seguiría probando con éxito posible: un acierto se notaría porque deja de ser rechazado. Con el
  bloqueo total, tras agotar los intentos no obtiene ninguna información más hasta que termine la ventana.
- **Contador propio, síncrono y solo al emitir un `401`.** Es un contador de ventana fija por IP de la conexión (la misma ventana
  fija de 15 minutos de los cupos, que empieza con el primer fallo de esa IP) que vive en memoria. La guarda lee el
  contador, compara la key y suma en el mismo cuerpo síncrono, sin `await`: con peticiones simultáneas la cifra es exacta
  (20 peticiones simultáneas con key errónea y límite 3 dan exactamente 3 respuestas `401` y 17 respuestas `429`). Una
  petición con key válida nunca suma, acabe como acabe (`400`, `404`, `405`, `413`, `415`, `429` o `500`), y un `429`
  tampoco. El contador no usa temporizadores: caduca de forma perezosa y barre las IP vencidas como mucho una vez por
  ventana, así que no mantiene vivo el proceso ni necesita cierre.
- **Alternativa descartada: `skipSuccessfulRequests` de la librería de cupos.** Cuenta cada petición al entrar y descuenta
  las exitosas al responder; con peticiones simultáneas la cifra intermedia es inexacta (15 peticiones válidas
  simultáneas con límite 10 llegarían a bloquear a quien nunca falló).
- **Orden.** El cupo general va antes (un `429` por cupo gana a todo) y el bloqueo por fallos va justo antes de mirar la
  key; el cupo de `POST` va después de la key.
- **Coste.** Quien pueda falsificar un `X-Forwarded-For` ajeno desde una dirección de `TRUSTED_PROXIES` puede hacer que la
  IP de otro acumule fallos y quede bloqueada. Por eso `TRUSTED_PROXIES` debe incluir solo la red del frontend (ver «IP
  real del cliente y proxies de confianza»). Los contadores están en memoria de una instancia: se pierden al reiniciar.
- **Rotar la API key.** Si se cambia `API_KEY` y el frontend sigue enviando la antigua, cada petición del frontend es un
  intento fallido y la IP del frontend queda bloqueada hasta que termine su ventana (15 minutos por defecto). El resto de
  usuarios, que llegan por esa misma IP (el frontend nunca envía la del navegador), también quedan bloqueados. Por eso conviene
  reiniciar Express y el frontend a la vez con la key nueva: al reiniciar Express se borran los contadores.
- **Variable.** `RATE_LIMIT_AUTH_FAILURES_MAX` (entero 1-1000, por defecto 10). No puede superar `RATE_LIMIT_MAX`: el
  cupo general también cuenta los `401`, y más fallos tolerados que peticiones permitidas serían inalcanzables. Si lo
  supera, el servicio no arranca y el error nombra las dos variables (nunca sus valores). Como el defecto es 10, bajar
  solo `RATE_LIMIT_MAX` por debajo de 10 obliga a bajar también esta variable.

## CORS

CORS es el mecanismo con el que un navegador decide si una página de un origen puede leer las respuestas de otro. El
servicio solo reconoce UN origen, el de `CORS_ORIGIN` (por ejemplo, `http://localhost:3001`, el frontend en
desarrollo). Una petición que trae
exactamente un `Origin` idéntico a ese valor recibe `Access-Control-Allow-Origin` con ese mismo valor; cualquier otra
(otro dominio, otro puerto, otro esquema, `null`, una barra final, mayúsculas distintas, la cabecera repetida o sin
`Origin`) no recibe ninguna cabecera `Access-Control-Allow-*` y se procesa igual que antes: CORS no rechaza nada, solo
informa al navegador. Por eso la protección real sigue siendo la API key y el aislamiento de red.

- **Por qué existe aunque el navegador no llame a Express.** En esta arquitectura quien llama a Express es el servidor del
  frontend, que no envía `Origin`; CORS no interviene. Se añade como segunda barrera, por si algún día la API se expone o
  se prueba desde una página de un navegador: así solo esa página puede leer las respuestas.
- **Siempre `Vary: Origin`.** Toda respuesta de una ruta protegida (incluidos `401`, `404`, `405` y `429`) lleva
  `Vary: Origin`, también cuando la petición no trae `Origin`: la respuesta depende de esa cabecera y una caché no debe
  servirle a un origen la respuesta pensada para otro. Se suma al `Vary` que ya hubiera. `GET /health` no lleva `Vary` ni
  cabeceras de CORS (no es una ruta de la API).
- **Nunca `*` ni credenciales.** No se envía `Access-Control-Allow-Origin: *` ni `Access-Control-Allow-Credentials`, y
  nunca se refleja el `Origin` recibido: solo se escribe el valor configurado, y solo si coincide exactamente.
- **También en los errores.** Las cabeceras se añaden antes de la guarda y de los cupos, así que un `401` o un `429` para
  el origen permitido las lleva y el navegador puede leer el error.
- **Preflight por ruta.** Antes de una petición con `Authorization` o `Content-Type: application/json`, el navegador
  envía un `OPTIONS` (el preflight) para preguntar qué se permite, y ese `OPTIONS` NO lleva `Authorization`: exigirla lo
  rompería siempre. Por eso un preflight válido se atiende sin key. Es válido solo si se cumple todo: método `OPTIONS`,
  exactamente un `Origin` igual a `CORS_ORIGIN`, `Access-Control-Request-Method` presente y no vacío (su valor no se
  valida: decide el navegador) y una ruta real de la API (`/api/tasks` o `/api/tasks/<id>`, comparada sin la consulta,
  que el navegador sí incluye; `/api/tasks/`, `/API/tasks` y `//api/tasks` no cuentan). La respuesta es `204` sin cuerpo
  con `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods` con los métodos REALES de esa ruta (`GET, POST` o
  `PUT, DELETE`, tomados de la misma tabla que genera `Allow` en el `405`, sin una segunda lista),
  `Access-Control-Allow-Headers: Authorization, Content-Type`, `Access-Control-Max-Age: 600` y `Vary: Origin`. Pasa por
  el cupo general (un preflight puede dar `429`) pero no cuenta como intento fallido ni en el cupo de `POST`, y no se
  registra. Si trae cuerpo, no se lee y se responde con `Connection: close`. Cualquier otro `OPTIONS` sigue el flujo
  normal. Alternativa descartada: responder `204` a todo `OPTIONS`, que anunciaría rutas y métodos que no existen.
- **Escrito a mano.** Son unas pocas líneas sobre `rawHeaders` (donde se cuenta cuántas cabeceras `Origin` llegan, porque
  Node descarta las repetidas en `req.headers`). Alternativa descartada: el paquete `cors`, cuyos valores por defecto
  aceptan cualquier origen o lo reflejan, y que añade una dependencia para algo que aquí cabe en una función.
- **Variable obligatoria `CORS_ORIGIN`.** Sin valor por defecto: si falta o es inválida, el servicio no arranca y el
  error nombra la variable (nunca su valor). Debe ser un origen canónico: `esquema://host[:puerto]` con `http` o
  `https`, host en minúsculas, sin ruta, barra final, consulta, fragmento ni credenciales, y sin el puerto por defecto
  (`http://localhost:80` es inválido; `http://localhost` es válido). No admite `*`, `null` ni listas. El `.env`
  necesita las dos variables, `API_KEY` y `CORS_ORIGIN`, antes de `npm start`.

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
| 429    | `TOO_MANY_REQUESTS`      | Demasiadas peticiones.                            |
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
| `DATABASE_URL` | URL `postgresql://` con usuario `writer`, contraseña, host y una sola base; sin parámetros de consulta | (obligatoria) | Conexión de la API a PostgreSQL (secreta). Si es inválida, el servicio no arranca y el error no muestra la URL. |
| `DB_POOL_MAX` | entero 1-100 | `10` | Conexiones simultáneas del Pool de `pg` (ver «Conexión a la base de datos»). |
| `DB_POOL_IDLE_TIMEOUT_MS` | entero 1000-600000 | `30000` | Milisegundos que vive una conexión inactiva. |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | entero 100-60000 | `5000` | Milisegundos de espera para obtener una conexión. |
| `PORT` | entero 1-65535 | `3000` | Puerto en el que escuchará el servicio. |
| `HOST` | dirección IP literal | `127.0.0.1` | Dirección en la que escuchará el servicio. |
| `SHUTDOWN_TIMEOUT_MS` | entero 1000-120000 | `10000` | Plazo máximo, en milisegundos, del cierre ordenado. |
| `API_KEY` | 43 a 128 caracteres de `A-Za-z0-9_-`, al menos 10 distintos | (obligatoria) | Clave de la API (secreta). |
| `TRUSTED_PROXIES` | lista de `loopback`, `linklocal`, `uniquelocal`, IP o `IP/prefijo`; o `none` | `loopback` | Direcciones de las que se cree `X-Forwarded-For` (ver «IP real del cliente y proxies de confianza»). |
| `RATE_LIMIT_WINDOW_MS` | entero 1000-3600000 | `900000` | Duración, en milisegundos, de la ventana de los cupos (15 minutos). |
| `RATE_LIMIT_MAX` | entero 1-10000 | `100` | Cupo general por IP y ventana. |
| `RATE_LIMIT_POST_MAX` | entero 1-10000, no mayor que `RATE_LIMIT_MAX` | `20` | Cupo de `POST` por IP y ventana (ver «Límite de peticiones»). |
| `RATE_LIMIT_AUTH_FAILURES_MAX` | entero 1-1000, no mayor que `RATE_LIMIT_MAX` | `10` | Intentos fallidos de key por IP y ventana antes de bloquear la IP (ver «Bloqueo por intentos fallidos»). |
| `CORS_ORIGIN` | un origen canónico `http(s)://host[:puerto]` | (obligatoria) | Único origen del navegador que recibe `Access-Control-Allow-Origin` (ver «CORS»). |
| `TASKS_LIST_LIMIT` | entero 1-10000 | `1000` | Máximo de tareas que devuelve `GET /api/tasks`, las más recientes (ver «Tope de la lista»). |

El servicio valida solo las variables de la tabla. El resto del `.env` lo usan otras piezas: las de contraseñas de roles,
`POSTGRES_USER`, `DB_NAME`, `DB_NAME_TEST` y `DB_LOCAL_PORT` (el contenedor de PostgreSQL), `OWNER_DATABASE_URL`
(`npm run db:deploy`), `READER_DATABASE_URL` (el frontend) y las `TEST_*` (los tests). El servicio las ignora.

`API_KEY` se genera con 32 bytes aleatorios, que dan 43 caracteres:

```
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

El servicio comprueba el formato y que la clave no sea trivial (una letra repetida, por ejemplo), pero NO verifica su
entropía: la garantía real viene de generarla con el comando anterior. El valor de ejemplo de `.env.example`
(`change-me-use-randomBytes-32`) no es un secreto y el servicio lo rechaza al arrancar, para que nadie deje la clave
sin cambiar. El `.env` necesita `API_KEY` y `CORS_ORIGIN` antes de `npm start`. La clave se valida al arrancar y la API la exige en
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
- La lista no tiene paginación y devuelve como máximo `TASKS_LIST_LIMIT` tareas, las más recientes (ver «Tope de la
  lista»). El tope viaja como último parámetro de un `LIMIT`.
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

> **Aviso de seguridad.** La API exige API key (cabecera `Authorization: Bearer`, ver «Seguridad: API key»), tiene
> límites por IP, bloqueo por intentos fallidos, CORS con un solo origen y tope de la lista, y escucha por defecto solo
> en 127.0.0.1. Aun así NO debe exponerse a internet: no tiene HTTPS propio ni login de usuarios. Quien tenga la key
> puede crear, modificar y borrar tareas. Existen la lectura y la creación (`GET` y `POST` en `/api/tasks`), la
> actualización (`PUT` en `/api/tasks/:id`) y el borrado (`DELETE` en `/api/tasks/:id`). Los ejemplos de esta sección
> omiten la cabecera `Authorization` por brevedad: sin ella, todas las rutas dan `401`.

### `GET /api/tasks`

Devuelve `200` con un arreglo JSON con las tareas más recientes (hasta `TASKS_LIST_LIMIT`, ver «Tope de la lista»), de
la más reciente a la más antigua (con desempate por `id`), o `[]` si no hay ninguna. No hay paginación. Cada tarea
tiene exactamente cinco campos:

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

#### Tope de la lista

`GET /api/tasks` devuelve como máximo `TASKS_LIST_LIMIT` tareas (1000 por defecto; entero de 1 a 10000, validado al
arrancar). Son las más recientes según el orden de siempre (`createdAt` descendente y `id` ascendente), y el tope se
aplica DESPUÉS del filtro: con `?completed=false` son las N pendientes más recientes. La respuesta sigue siendo un
arreglo de cinco campos con `200`; no hay cabeceras nuevas.

- Alternativa descartada: paginación. Cambia el contrato (parámetros, respuesta con total) y obliga a rehacer el
  frontend; el tope protege al servidor con un cambio mínimo.
- El tope no es una medida de seguridad contra escrituras: la tabla puede seguir creciendo (el cupo de `POST` frena el
  ritmo, no el total).
- Limitación: el listado ya no es completo y NO avisa de que está truncado. Los contadores del frontend (que leen el
  total real de la base de datos) pueden mostrar más tareas de las que lista la API; el frontend lo avisará.
- Coste: ordenar y quedarse con las N más recientes cuesta O(n) sobre la tabla (PostgreSQL ordena todas las filas
  candidatas y se queda con las N primeras: top-N). Un índice por fecha (`createdAt DESC, id`) sería la mejora si la
  tabla creciera mucho; hoy no se añade porque el tope acota lo que se envía, no lo que se lee.

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

Etapas previas, en este orden. Van antes que todo lo demás, también que el `404` y el `405`. `/health` solo pasa por P0.

- **P0. Cabeceras.** `helmet` en toda respuesta; `Cache-Control: no-store`, `Vary: Origin` y, si el origen es el
  permitido, `Access-Control-Allow-Origin` en las rutas de la API. No deciden nada.
- **P1. Cupo general (`429`).** Cuenta toda petición a la API, también las que luego fallan. Va antes que la key: una IP
  agotada recibe `429` aunque la key sea errónea.
- **P2. Preflight de CORS (`204`).** Solo un `OPTIONS` válido (ver «CORS»). No lleva key, no cuenta como intento fallido
  y no cuenta en el cupo de `POST`.
- **P3. API key y bloqueo (`401` o `429`).** Si la IP ya acumuló demasiados fallos, recibe `429` aunque la key sea buena.
  Si no, la key correcta pasa y cualquier otra cosa da `401`, que cuenta como fallo.
- **P4. Cupo de `POST` (`429`).** Solo para los `POST` con key válida.

Después, las ocho etapas de la petición:

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
`Allow: GET, POST`; `OPTIONS` solo recibe `204` si es un preflight de CORS válido (ver «CORS»), y cualquier otro
`OPTIONS` sigue este flujo (sin key `401`; con key `405` en una ruta existente y `404` en una inexistente). En `/api/tasks/<id>` solo existen `PUT` y `DELETE`: cualquier otro método (también `GET`) da `405` con
`Allow: PUT, DELETE` (`GET` no está permitido porque no se pidió leer una tarea por identificador); el método se
evalúa antes que el identificador, así que `GET /api/tasks/%E0%A4%A` da `405` y no `400`. `/api/tasks/`, `/api/tasks//`, `/api/%74asks`, `/api/tasks/<id>/`,
`/api/tasks/<id>/x` y cualquier ruta desconocida dan `404`. Si la base de datos falla (inalcanzable o
con una restricción violada), la respuesta es un `500` genérico y el log registra solo la clase del error y su
SQLSTATE, nunca datos de la petición (ni título, ni descripción, ni cuerpo, ni consulta).

Capas: ruta (`backend/src/routes`) → controlador (`controllers`) → servicio (`services`) → repositorio
(`repositories`), con SQL parametrizado de `pg`. La aplicación recibe la base de datos al construirse
(`createApp({ logger, database, security, tasks })`), así que no existe una aplicación sin base de datos ni sin key.

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
6. Desde la raíz: `npm run dev`, y abra `http://127.0.0.1:3001`.

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
3. Cuando ya no quedan conexiones, se liberan los almacenes de los cupos de peticiones y se cierra el Pool de la base
   de datos.

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

El frontend se documenta en «Frontend».

## Frontend

El frontend es una aplicación Next.js (App Router) con TypeScript estricto y Tailwind, en `frontend/`. Hoy ya tiene
la página principal con el filtro en la URL (`/?filter=completed|pending`) y los contadores de tareas, leídos en el
servidor con Prisma y el rol `reader` (ver «Contadores y Prisma en el frontend»). También tiene las rutas
`/api/tasks` y `/api/tasks/<id>`, que reenvían las peticiones a Express con la API key solo en el servidor (ver
«Rutas del servidor del frontend»). Tiene además la lista interactiva (crear, completar, desmarcar, editar y borrar),
que se describe en «Interfaz del cliente». La configuración propia (ver «Configuración del frontend»), las cabeceras de
seguridad y las herramientas de calidad se describen en las secciones siguientes.

### Comandos

Se ejecutan dentro de `frontend/` (primero `npm install`):

| Comando             | Qué hace                                                                    |
| ------------------- | --------------------------------------------------------------------------- |
| `npm run dev`       | Servidor de desarrollo en `127.0.0.1:3001`.                                 |
| `npm run build`     | Compila para producción.                                                    |
| `npm run start`     | Sirve lo compilado en `127.0.0.1:3001` (hay que ejecutar `build` antes).    |
| `npm run verify:build` | Compila sin ninguna variable de configuración y falla si la compilación la necesita. |
| `npm run lint`      | ESLint y comprobación de formato con Prettier.                              |
| `npm run format`    | Da formato con Prettier.                                                    |
| `npm run typecheck` | Comprueba los tipos con TypeScript.                                         |
| `npm test`          | Vitest con cobertura; falla si las líneas o sentencias bajan del 95 %.      |

### Puerto y host fijos

`dev` y `start` llevan `-p 3001 -H 127.0.0.1` escritos en el script. Por qué: el puerto 3000 es el del backend, y así no
chocan; y el host `127.0.0.1` evita que el servidor quede abierto a la red local por accidente. Como van en el script,
no dependen de la variable `PORT` del entorno (con `PORT=4000` el servidor sigue en 3001). Para cambiarlos hay que
editar `package.json`.

### Estructura de `frontend/src`

- `app/`: rutas y páginas finas, sin lógica (`layout.tsx`, `page.tsx`, `globals.css`).
- `components/`: componentes de servidor puros que reciben datos por props.
- `lib/`: funciones puras sin secretos que puede importar cualquiera, incluida `next.config.ts`.
- `server/`: todo lo que toca secretos, base de datos o Express; nunca llega al navegador (`server/config/` valida la
  configuración, `server/logging/` es el registro de errores y `server/counters/` lee los contadores con Prisma). Cada
  archivo empieza con `import 'server-only'`, que
  hace fallar la compilación si algo del navegador lo importa.
- `server/proxy/`: las rutas hacia Express (comprobaciones del borde, cliente de Express y traducción de respuestas); `app/api/tasks/` solo las expone.
- `instrumentation.ts`: el gancho de arranque de Next; valida la configuración al iniciar `dev` o `start`.
- `generated/`: cliente de Prisma generado (no se sube a git; lo crea `npm install`).
- `client/`: código que corre en el navegador (`'use client'`): la lista, las tarjetas, los formularios y las acciones.
  No importa nada de `server/` ni lee variables de entorno.

Fuera de `src`, `prisma/` y `prisma.config.ts` tienen el esquema y la configuración del CLI de Prisma. Solo `app/`,
`components/`, `client/`, `lib/`, `server/` y `generated/` existen hoy; el resto se crea cuando hace falta. Las importaciones son relativas (sin alias `@/`):
hay un alias menos que mantener entre `tsconfig` y Vitest.

### Pruebas de componentes y validación de texto del cliente

Para probar componentes React se instalan Testing Library (`@testing-library/react` 16.3.3 y `@testing-library/dom`
10.4.2) y `jsdom` 30.1.3, todos con versión exacta. `jsdom` simula un navegador dentro de Node y Testing Library
permite buscar los elementos como los vería una persona (por rol y nombre accesible). Solo se usan en los archivos de
componentes, que empiezan con `// @vitest-environment jsdom`; el resto de las pruebas sigue en entorno `node`, que es
más rápido. Alternativa descartada: usar jsdom en todo el proyecto (haría más lentas las pruebas que no necesitan DOM).
Tampoco se instalan `user-event` ni `jest-dom`: `fireEvent` y las aserciones de Vitest bastan. Testing Library no
limpia el DOM por sí sola (no se usan `globals`), así que `tests/helpers/dom-cleanup.ts` lo hace tras cada prueba.

Las funciones puras de la interfaz viven en `src/lib/` y se prueban sin DOM:

- **Validación de título y descripción** (`task-text.ts`): recorta con `trim()`, rechaza NUL y sustitutos sueltos, y
  cuenta la longitud en puntos de código (título de 1 a 100, descripción de hasta 500), con las mismas reglas y el mismo
  orden que Express. Es solo una comodidad para avisar antes de enviar: la autoridad es Express, que vuelve a validar
  todo. **Limitación:** un emoji compuesto (por ejemplo una familia, unida con ZWJ) cuenta varios puntos de código, igual
  que en Express, así que el contador puede marcar más de lo que parece.
- **Fecha** (`task-date.ts`): locale fijo `es-CO` con la zona del navegador, para que no dependa del idioma del equipo.
- **Errores del servidor** (`api-error.ts`): el mensaje que envía el servidor solo se muestra si su `code` está en una
  lista cerrada y mide de 1 a 200 caracteres; si no (por ejemplo una página HTML de un proxy), se usa un mensaje propio.

### Cabeceras de seguridad

`next.config.ts` desactiva `X-Powered-By` y añade a todas las rutas `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer` y `X-Frame-Options: DENY`. La lista sale de la función `securityHeaders()`
(`src/lib/security-headers.ts`), que se prueba aparte. **Limitación:** no hay `Content-Security-Policy`. Una CSP útil
con Next obliga a usar _nonces_ por petición (y a renderizar cada página en el servidor) y queda como trabajo futuro.

### Registros del frontend

El servidor del frontend registra sus errores con un registro propio (`src/server/logging/`). Escribe una línea JSON
por evento en la salida de error (`process.stderr`), con `time`, `level` (siempre `error`) y `event`. Lo usan la
configuración (`config_invalid`), la lectura de contadores (`counters_failed`) y las rutas (`route_failed`).

- **Eventos cerrados.** `config_invalid` (configuración inválida), `counters_failed` (no se pudieron leer los
  contadores) y `route_failed` (fallo inesperado de una ruta).
- **Campos cerrados.** Solo estos, en este orden:
  - `method`: `GET`, `POST`, `PUT` o `DELETE`. Otro valor se descarta.
  - `route`: la plantilla `/api/tasks` o `/api/tasks/:id`, nunca la URL real. Cualquier otra ruta se descarta.
  - `status`: entero de 100 a 599.
  - `errorName`: nombre de la clase del error si cumple `^[A-Za-z][A-Za-z0-9_]{0,59}$`; si no, `Error`. Lo lanzado que
    no es un `Error` deja solo su tipo (`string`, `object`...).
  - `errorCode`: el `code` del error, o el de `cause`, solo si cumple `^[A-Z0-9_]{1,40}$` (por ejemplo `ECONNREFUSED`).
    Si no, se omite.
  - `variables`: solo nombres de la lista `BACKEND_URL`, `API_KEY`, `READER_DATABASE_URL` y `ALLOWED_HOSTS`. Nunca sus
    valores.
- **Nunca se registra:** el mensaje del error, la traza, URL, cabeceras, cuerpo, consulta, identificadores, la API key
  ni valores de variables. Un mensaje o una traza pueden llevar una contraseña, una URL de conexión o un dato que envió
  la persona usuaria.
- **Por qué una lista cerrada.** Se permite lo que se conoce y se descarta lo demás, así que un campo nuevo no se cuela
  por descuido. Alternativa descartada: quitar los datos sensibles con expresiones regulares, que es frágil.
- **Por qué no `console.error(error)`.** Imprime el mensaje y la traza del error, que es justo lo que no puede salir.
- **Sin código compartido con el backend.** Son paquetes separados: el registro del frontend sigue los mismos principios
  (lista cerrada de campos, sin datos de usuario), pero no importa nada del backend.
- **Robustez.** Un getter que lanza (en `code`, `name` o `cause`) no hace fallar el registro: esa lectura se omite.
  Lo lanzado que no es un `Error` no se convierte a texto, así que su `toString` nunca se ejecuta.

### Configuración del frontend

El servidor del frontend lee su configuración de su PROPIO archivo `frontend/.env` (plantilla: `frontend/.env.example`;
se copia con `Copy-Item .env.example .env` dentro de `frontend/`). No usa el `.env` de la raíz. Por qué: el proceso de
Next solo recibe lo que necesita (ni la contraseña del dueño del esquema ni la de escritura) y no choca con el `PORT` del
backend. Coste: hay dos archivos `.env` y la `API_KEY` está repetida. Alternativa descartada: un único `.env` en la
raíz cargado desde las dos aplicaciones. `frontend/.env` está en `.gitignore`; `frontend/.env.example` sí se sube.

| Variable              | Obligatoria | Regla                                                                                       |
| --------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `BACKEND_URL`         | sí          | `http://` o `https://` + host + puerto opcional; sin ruta, consulta, fragmento, barra final ni credenciales. Ejemplo: `http://127.0.0.1:3000`. Se guarda como origen en minúsculas. |
| `API_KEY`             | sí          | La misma regla que en el backend: 43 a 128 caracteres de `A-Za-z0-9_-`, con al menos 10 distintos. El valor de ejemplo se rechaza. |
| `READER_DATABASE_URL` | sí          | `postgresql://` o `postgres://`, usuario exactamente `reader` (también tras decodificar `%`), contraseña no vacía, host y nombre de base, sin parámetros de consulta. |
| `ALLOWED_HOSTS`       | no          | Lista separada por comas de `host` o `host:puerto` en minúsculas, sin espacios ni comodines. Si falta, no se valida el `Host`. Si existe pero está vacía, es inválida. |

- **Una variable obligatoria vacía, con espacios en los extremos o ausente es inválida.** El error nombra TODAS las
  inválidas a la vez, en un orden fijo, y nunca sus valores. Los nombres son una lista cerrada.
- **Ninguna lleva el prefijo público de Next.** Así Next nunca las copia a los archivos que descarga el navegador, y una
  prueba automática lo vigila: ningún archivo del código tiene ese prefijo, y un archivo marcado `'use client'` (y lo que
  importe, directa o transitivamente) no puede llegar a `src/server`, leer `process.env` ni importar `server-only`.
- **La `API_KEY` debe ser EXACTAMENTE la del backend.** Se genera una vez (el comando está en `frontend/.env.example`) y
  se pega en los dos archivos. Si no coincide, el backend rechaza cada petición del frontend y, tras 10 rechazos,
  bloquea a todos los usuarios del frontend (que para Express son una sola IP) durante la ventana de tiempo (15
  minutos por defecto). Al rotarla, se reinician los dos procesos a la vez.
- **Contraseñas.** Next expande `$` dentro de los valores del `.env`: use solo `[A-Za-z0-9._~-]` en las contraseñas.
- **`ALLOWED_HOSTS`.** Pensada para cuando se conozca el nombre público (protege frente a que un nombre ajeno apunte a
  este servidor): una petición cuyo `Host` no esté en la lista recibirá 403 (lo aplican las rutas del servidor). Ejemplo:
  `ALLOWED_HOSTS=localhost:3001,127.0.0.1:3001`.

**Cuándo se valida.** La configuración es PEREZOSA: no se valida al importar el módulo. Se valida en dos momentos y el
resultado (válido o inválido) queda en memoria:

1. En el primer uso (la primera vez que algo pide la configuración).
2. Al arrancar el servidor, con el gancho `register()` de `src/instrumentation.ts`. Solo actúa cuando el proceso es el
   servidor de Node (`NEXT_RUNTIME === 'nodejs'`) y nunca durante `next build`.

| Comando         | Sin `frontend/.env` o con variables inválidas                                                      |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `npm run build` | Pasa. No valida ni abre ninguna conexión: se puede compilar en CI o en una imagen sin secretos.    |
| `npm run dev`   | Se detiene con un mensaje que nombra las variables inválidas, sin valores.                         |
| `npm run start` | Escribe el mismo mensaje y registra `config_invalid` una vez; el proceso sigue vivo pero TODA petición recibe 500 (no sirve nada útil). Hay que pararlo con Ctrl+C y corregir el `.env`. |

Al cambiar `frontend/.env` hay que reiniciar `dev` o `start`: la configuración se lee una sola vez. Plan B: si algún día
una versión de Next no impidiera servir cuando el gancho lanza, la validación quedaría solo en el primer uso; con la
versión fijada de Next el gancho sí lo impide, así que ese plan no está activo. En el build de producción el nombre de la
clase del error (`errorName`) puede salir abreviado por el minificador: el dato fiable del registro es `variables`.

**Comprobar que `build` no necesita configuración:** `npm run verify:build` ejecuta `next build` pisando las cuatro
variables con cadenas vacías (los valores del entorno mandan sobre el `.env`), de modo que el resultado no depende de que
exista un `.env` real. Termina con código 0 si la compilación pasa. No va dentro de `npm test` porque tarda y comparte la
carpeta `.next` con `npm run build`.

**Ejemplos y demostraciones.** El `CORS_ORIGIN` de ejemplo del `.env` de la raíz es `http://localhost:3001` (el origen del
frontend en desarrollo); si ya tiene un `.env` de la raíz con el valor anterior, cámbielo a mano. Para demostraciones, el
mismo archivo trae comentados unos cupos más altos (`RATE_LIMIT_MAX=1000` y `RATE_LIMIT_POST_MAX=200`), porque la
interfaz hace una lectura de la lista tras cada acción y con los cupos por defecto se agotarían pronto. Todos los
usuarios comparten un único cupo, por diseño (ver «Cupo compartido por diseño (desviación declarada)»).

### Contadores y Prisma en el frontend

El frontend lee tres números (completadas, pendientes y todas) con Prisma 7.10.1 (`prisma`, `@prisma/client` y
`@prisma/adapter-pg`, versiones exactas). Lo hace en el servidor, con el rol `reader` y **solo sobre la vista
`task_counts`**. La página principal los muestra (ver «Página principal»).

- **Mínimo privilegio.** `reader` tiene SELECT únicamente sobre la vista y ningún permiso sobre `tasks`; aun con la
  credencial filtrada, lo único que se vería son tres números. Se comprobó contra la base de desarrollo: con
  `READER_DATABASE_URL`, `SELECT ... FROM task_counts` funciona y `SELECT 1 FROM tasks` falla con `42501` (permiso
  denegado). Alternativa descartada: leer los contadores con el rol `writer` o con un `COUNT(*)` sobre `tasks`, que
  daría al frontend acceso a todas las tareas.
- **La vista no se modela.** `prisma/schema.prisma` se obtuvo con `prisma db pull` conectando como `reader`. Como
  `reader` no ve columnas de `tasks` ni la vista, Prisma no genera ningún modelo y deja `tasks` y `_prisma_migrations`
  como comentarios vacíos (no son modelos). El esquema solo declara el generador (`prisma-client`, salida en
  `src/generated/prisma`) y la fuente de datos. Por eso la lectura es una consulta cruda de texto fijo
  (`SELECT completed, total FROM task_counts`, plantilla etiquetada de `$queryRaw`, sin parámetros), y un test comprueba
  que su texto solo menciona `task_counts`. Alternativa descartada: editar el esquema a mano para añadir un modelo de la
  vista, que dejaría de ser «lo que devuelve `db pull`».
- **Filas validadas.** La vista devuelve una fila por estado que tenga tareas (puede haber 0, 1 o 2). Se exige que cada
  fila tenga `completed` booleano y `total` entero no negativo, sin estados repetidos; el estado que falta cuenta 0.
  Cualquier otra forma es una lectura inválida.
- **Plazo de 2 s y fallo sin datos.** `readCounters` nunca lanza: si la base no responde en 2 segundos, si falla la
  conexión, si las filas no tienen la forma esperada o si la configuración es inválida, registra el evento
  `counters_failed` (solo nombre de la clase y código del error, nunca el mensaje ni la URL) y devuelve «no disponibles».
  La página muestra entonces «—» con un aviso. La consulta que pierde la carrera sigue en curso sin
  bloquear la respuesta.
- **Un solo cliente.** `src/server/counters/reader-database.ts` crea el cliente la primera vez que se lee (nunca al
  importar ni en `npm run build`, que no abre ninguna conexión) con `READER_DATABASE_URL`, `log: []` (Prisma no escribe
  consultas ni errores) y lo guarda en `globalThis` para que `npm run dev` no abra un pool nuevo en cada recarga.
- **El cliente generado no se sube.** `src/generated/` está en `.gitignore` y `npm install` ejecuta `prisma generate`
  (`postinstall`), que no necesita ninguna variable de entorno. Alternativa descartada: versionar el código generado,
  que ensucia las revisiones y se desfasa.
- **Sin migraciones.** El dueño del esquema es el backend; el frontend no migra. Tras cada migración nueva hay que
  regenerar el esquema y el cliente a mano (`prisma db pull` y `prisma generate`).
- **Cómo pasar `READER_DATABASE_URL` al CLI.** El CLI de Prisma no lee ningún `.env`. Desde `frontend/`:
  `node --env-file=.env node_modules/prisma/build/index.js db pull` (o, en PowerShell,
  `$env:READER_DATABASE_URL = '...'` y luego `npx prisma db pull`). Si hay que repetir el `db pull`, la base de
  desarrollo debe estar arriba (`docker compose -f docker-compose.dev.yml up -d --wait`). `prisma.config.ts` lee la
  variable directamente de `process.env` y no con el ayudante `env()`, que lanza si falta y rompería `generate` en un
  clon limpio.
- **Riesgo residual.** Hay dos caminos de lectura (los contadores por Prisma y la lista por Express) y dos credenciales
  de base de datos (`writer` en el backend y `reader` en el frontend). Los contadores pueden diferir un instante de la
  lista tras una escritura.

### Página principal

- **El filtro vive en la URL**: `/?filter=completed` o `/?filter=pending`; así se puede compartir, recargar y usar el botón «atrás». `readFilter` (en `lib/task-filter.ts`) es una función pura: cualquier otra cosa (`all`, mayúsculas, vacío, repetido, parámetros extra) es «Todas», sin error, sin redirección y sin reflejar el valor en la página.
- **Contadores**: se leen en el servidor en cada petición (`readCounters`) y no dependen del filtro activo. Si fallan, cada cantidad es `—` y sale el aviso «No se pudieron cargar los contadores.» (`role="status"`); los enlaces siguen funcionando.
- **Por petición, no en la compilación**: `page` exporta `dynamic = 'force-dynamic'`, así `next build` no se conecta a la BD (en la salida de la compilación `/` aparece como `ƒ (Dynamic)`).
- **Página fina**: `page.tsx` solo une `readFilter`, `readCounters` y `HomeView`; la lógica y el HTML están en funciones y componentes puros que se prueban sin invocar un componente de servidor asíncrono.
- **Sin JavaScript** la página funciona (los filtros son enlaces normales); la lista de tareas necesita JavaScript (ver «Interfaz del cliente»).

### Interfaz del cliente

La lista la pinta un componente de cliente: `client/task-manager.tsx` (la lista y sus estados) y `client/task-card.tsx` (una tarea). El reparto es este:

- **Servidor (Server Component)**: la página lee el filtro de la dirección y los contadores, y calcula el total de cada filtro.
- **Navegador (Client Component)**: pide la lista a `GET /api/tasks` de este mismo servidor, nunca a Express, y la pinta.

**Por qué:** los contadores se leen en el servidor sin enviar nada extra al navegador, y la lista cambia con cada
acción, así que se pide desde el navegador. Alternativa descartada: pedir también la lista en el servidor (cada cambio
recargaría la página entera).

En esta versión la pantalla muestra la lista y permite crear, completar, desmarcar, editar y borrar tareas.

**Estados de la lista:**

- **Cargando**: al abrir la página y al cambiar de filtro, la región de estado (`role="status"`, `aria-live="polite"`)
  dice «Cargando tareas…» y sustituye a la lista. El formulario de crear sigue disponible.
- **Lista**: cada tarea muestra su título, su descripción (si tiene), la fecha de creación y su estado con texto,
  «Completada» o «Pendiente» (no solo con color).
- **Vacía**: según el filtro, «Aún no hay tareas…», «No hay tareas completadas.» o «No hay tareas pendientes.». No es un error.
- **Error de carga**: si la carga falla, aparece un aviso con `role="alert"` y el botón «Reintentar», que
  repite solo esa petición.
- **Refresco fallido**: si la lista no se puede actualizar tras una acción, se mantiene la lista que había y sale
  «No se pudo actualizar la lista.» con «Reintentar».
- **Errores de una tarea**: van junto a su tarjeta con `role="alert"` (red, 500, 429 con la espera y 400). El 404 es un
  aviso general, no un error de la tarjeta.
- **Avisos**: «Tarea creada.» tras crear; «Lista actualizada.» tras una escritura correcta de completar, desmarcar,
  editar o borrar; «La tarea ya no existe.» cuando la tarea ya no está (404).
- **Truncado**: la API devuelve como mucho el tope de la lista (1 000 por defecto, `TASKS_LIST_LIMIT`). Si el total del
  filtro, según los contadores, es mayor que las tareas recibidas, aparece «Mostrando las N tareas más recientes de M.».
  Solo aparece sin carga, refresco ni escritura pendientes, y con los contadores disponibles.

**El texto siempre se muestra como texto.** React escribe el título y la descripción como texto: un `<b>` o un
`<img onerror=…>` se ven tal cual y no se ejecutan. Los saltos de línea de la descripción se conservan. El cliente no
usa `dangerouslySetInnerHTML`: el lint lo prohíbe y una prueba lo comprueba.

**Fecha:** se muestra con el locale fijo `es-CO` (fecha media y hora corta) y la zona horaria del navegador. El
locale fijo hace que la salida no dependa del idioma del equipo.

**Limitaciones:**

- **Hace falta JavaScript**: sin él, los filtros y los contadores funcionan, pero la lista no se carga.
- **Sin paginación ni virtualización**: se muestran todas las tareas recibidas, como mucho 1 000 (con el aviso de
  truncado). Con ese número la página se pinta entera.
- **Emojis compuestos**: un emoji formado por varios puntos de código unidos (como una familia) cuenta como varios
  caracteres, igual que en Express (ver «Pruebas de componentes y validación de texto del cliente»).
- **Sin login**: la clave autentica a la aplicación, no al usuario. Quien llega a la página puede crear, editar y borrar
  tareas.
- **No exponer a una red**: no tiene login ni HTTPS propio, y el frontend escucha solo en `127.0.0.1`.
- **Fecha**: se muestra con el locale fijo `es-CO` y la zona horaria del navegador, así que la hora depende del equipo
  desde el que se mire.
- **Idioma y contraste**: la página va marcada como `es` y el contraste de los colores se revisa a mano. No hay pruebas
  automáticas de ninguno de los dos.

### Crear una tarea

El formulario está encima de la lista (`client/create-form.tsx` y `client/text-field.tsx`), con título y descripción.

- **Validación previa:** antes de enviar se aplican las mismas reglas que en Express: se recortan los espacios de los
  extremos, el título mide de 1 a 100 caracteres, la descripción hasta 500 y no se admiten el carácter NUL ni los
  sustitutos sueltos. Los mensajes salen junto al campo («Debe tener entre 1 y 100 caracteres.», «Debe tener como máximo
  500 caracteres.», «Contiene caracteres no permitidos.») y el foco va al primer campo inválido. Un contador `n/100` y
  `n/500` cuenta puntos de código sobre el texto recortado; no se usa `maxLength` porque cuenta otra unidad y
  rechazaría 100 emojis válidos. Es solo una comodidad: Express sigue siendo la autoridad y, si responde 400, sus
  mensajes se muestran junto al campo (o como mensaje general si el campo es otro).
- **Si falla:** lo escrito se conserva, el error aparece junto al formulario con `role="alert"` y no hay aviso de
  éxito. Si el fallo es de red o un 502/504, el mensaje invita a revisar la lista antes de volver a enviar, porque la
  tarea pudo crearse.
- **Si sale bien:** el formulario se vacía, el foco vuelve al título y una región accesible anuncia «Tarea creada.».
- **Sin doble envío:** un guardia síncrono (una marca que se escribe antes de que React repinte) hace que dos clics o dos
  Enter seguidos envíen una sola petición. El botón se marca con `aria-disabled` en lugar de `disabled` para no perder
  el foco.
- **Lista y contadores tras cada escritura:** tras crear se vuelve a pedir la lista (en segundo plano, con el filtro
  vigente, sin quitarla de la pantalla) y se pide a Next que renderice otra vez el Server Component de los contadores
  (`router.refresh()`). **Por qué:** son dos caminos de lectura distintos (la lista por Express, los contadores por
  Prisma) y pueden diferir un instante tras escribir; refrescar ambos lo resuelve. Si se cambia de filtro, el borrador
  del formulario se conserva.
- **Sin actualización optimista:** la tarea nueva aparece cuando llega la lista, no antes. **Por qué:** así la pantalla
  nunca muestra algo que el servidor no confirmó. Alternativa descartada: insertarla al enviar y deshacerlo si falla
  (más código y estados intermedios que explicar).

### Completar y desmarcar

Cada tarjeta tiene un botón de completar (`client/task-card.tsx`; la lógica común está en `client/use-task-actions.ts`).

- **Un botón con `aria-pressed`:** su nombre accesible es fijo, «Marcar «título» como completada», y no cambia con el
  estado; `aria-pressed` dice si la tarea está completada. **Por qué:** un lector de pantalla anuncia siempre lo mismo y
  el estado aparte. Alternativa descartada: una casilla (nombre y estado se anuncian de dos formas según el lector).
- **Qué se envía:** `PUT /api/tasks/<id>` con solo `{"completed": true|false}`. Sin actualización optimista: el estado
  cambia cuando llega la lista nueva (se vuelve a pedir la lista y a renderizar los contadores, como al crear). Bajo
  Pendientes, completar hace desaparecer la tarea tras el refresco; bajo Completadas, desmarcar también. La región de
  estado anuncia «Lista actualizada.» y el aviso se quita al empezar la siguiente acción (sin temporizadores).
- **Sin doble clic:** un guardia síncrono por tarea hace que dos clics seguidos envíen una sola petición. Mientras dura
  la petición el botón queda con `aria-disabled` (no `disabled`, que podría hacerle perder el foco). Tareas distintas
  pueden tener peticiones a la vez.
- **Errores por tarea:** si falla (red, 500, 400 o 429), el mensaje sale junto a esa tarjeta con `role="alert"`, la
  tarea queda como estaba, el botón se reactiva y no se refresca nada. En un 429 el mensaje trae la espera, pero no hay
  reintento automático: la persona decide cuándo volver a pulsar. El mensaje desaparece al empezar otra acción sobre
  esa tarea.
- **Si la tarea ya no existe (404):** no es un error de la tarjeta, que va a desaparecer. Se avisa en la región de estado
  («La tarea ya no existe.») y se refrescan la lista y los contadores. Solo se interpreta así un 404 de Express con el
  código `NOT_FOUND`; un 404 de otro origen (por ejemplo, un proxy) es un error normal.
- **Dónde queda el foco:** si la tarea sigue en la lista, en su mismo botón; si desaparece, en el botón de la tarea que
  ocupa su lugar (la siguiente o, si era la última, la anterior) y, si la lista queda vacía, en el encabezado «Tareas».
  Si la persona ya había pasado a otro campo, no se le quita el foco.
- **Estado por tarea:** los errores, las tareas ocupadas y los avisos viven en un reductor puro (`lib/task-ui-state.ts`)
  en lugar de varios `useState`: un 404 cambia varias cosas a la vez y así no se descuadran. Al llegar una lista nueva
  se olvidan los errores de las tareas que ya no están.

### Borrar

Cada tarjeta tiene un botón «Eliminar «título»». Reutiliza el mismo mecanismo de completar (guardia contra el doble
clic, error junto a la tarjeta, aviso de 404 y foco).

- **Confirmación con `window.confirm`:** borrar no se puede deshacer, así que se pregunta antes de enviar nada; si se
  cancela, no hay petición. **Por qué:** es una línea, es accesible de serie y se simula fácil en los tests.
  Alternativa descartada: un diálogo propio (habría que gestionar a mano el foco y la tecla Escape).
- **Qué se envía:** `DELETE /api/tasks/<id>`. Con éxito (204) se vuelve a pedir la lista y a renderizar los contadores,
  y el foco pasa a la tarea que ocupa su lugar o al encabezado «Tareas». Dos clics seguidos hacen una sola pregunta y
  una sola petición.
- **Borrado no idempotente:** el backend responde 204 la primera vez y 404 si la tarea ya no existe. Si se borra desde
  dos pestañas, la segunda ve el aviso «La tarea ya no existe.» (no un error en una tarjeta que va a desaparecer) y su
  lista se refresca. Si la tarea estaba en edición, la edición se descarta al llegar la lista nueva.
- **Si falla** (red, 500, 400 o 429): el mensaje sale junto a la tarjeta, la tarea se queda y los botones se reactivan.

### Editar

Cada tarjeta tiene un botón «Editar «título»». Reutiliza el mismo mecanismo de completar y borrar (guardia contra el
doble clic, error junto a la tarjeta, aviso de 404) y los mismos campos que el formulario de crear
(`client/edit-form.tsx` y `client/text-field.tsx`).

- **En la propia tarjeta:** el título y la descripción se sustituyen por un formulario con los valores actuales y el
  foco va al título. **Por qué:** no se pierde el contexto de la lista ni hace falta otra ruta. Alternativa descartada:
  una página aparte `/tasks/<id>` (más rutas, más navegación y una lista que recargar al volver).
- **Solo viajan los campos que cambian:** `PUT /api/tasks/<id>` con el título, la descripción o ambos, según cuáles
  difieran del original **una vez recortados**. Un cambio solo de espacios, o ningún cambio, no envía nada y sale de la
  edición. Antes de enviar se validan con las mismas reglas que al crear (mensaje junto al campo y foco al primer campo
  inválido); un 400 del servidor se muestra junto a su campo o, si no es de título ni de descripción, como mensaje
  general del formulario.
- **Una edición a la vez:** pulsar «Editar» en otra tarea con cambios sin guardar pregunta con `window.confirm`
  («Hay cambios sin guardar en «título». ¿Descartarlos?»); si se rechaza, se queda donde estaba; sin cambios, cambia
  sin preguntar. Alternativa descartada: varias ediciones a la vez (el foco y los refrescos se complican) o descartar
  sin avisar (se pierde lo escrito).
- **Cancelar y Escape:** descartan lo escrito y devuelven el foco al botón «Editar» de esa tarea. Lo mismo al guardar
  con éxito.
- **El borrador sobrevive:** el texto escrito se guarda por tarea en el estado común (`lib/task-ui-state.ts`), no en la
  tarjeta, así que no se pierde al refrescar la lista (por ejemplo al completar otra tarea) ni al cambiar de filtro
  mientras la tarea siga en la lista. Si la tarea ya no está tras un refresco, o si se borra, la edición se descarta.
  Completar la tarea mientras se edita no descarta lo escrito.
- **Si falla** (red, 500 o 429): el mensaje sale junto a la tarjeta, lo escrito se conserva y los botones se
  reactivan, sin refrescar. Si la tarea ya no existe (404) se avisa «La tarea ya no existe.», se descarta la edición y
  se refresca.

### Cierre del cliente: refrescos, foco, capacidad y comprobaciones manuales

Las cinco acciones (crear, completar, desmarcar, editar y borrar) siguen las mismas reglas:

- **Sin doble envío.** Cada acción tiene un guardia síncrono, y el botón queda con `aria-disabled` mientras dura la
  petición (no `disabled`, para no perder el foco).
- **Sin actualización optimista.** La pantalla cambia solo cuando el servidor confirma. Alternativa descartada:
  pintar el cambio antes y deshacerlo si falla.
- **Qué se refresca.** Solo después de una escritura correcta o de un 404:

| Resultado                 | Lee la lista | Refresca contadores | Aviso o error                                      |
| ------------------------- | ------------ | ------------------- | -------------------------------------------------- |
| Éxito                     | Sí           | Sí                  | «Tarea creada.» (crear) o «Lista actualizada.»     |
| 404 (ya no existe)        | Sí           | Sí                  | «La tarea ya no existe.»                           |
| Red, 500, 400 o 429       | No           | No                  | Error junto al campo, al formulario o a la tarjeta |

- **Dónde queda el foco:**

| Acción                              | Foco al terminar                                                    |
| ----------------------------------- | ------------------------------------------------------------------- |
| Crear                               | Campo del título del formulario                                     |
| Editar (guardar, cancelar o Escape) | Botón «Editar» de esa tarea                                         |
| Completar o desmarcar               | Su botón; si la tarea desaparece, la tarjeta siguiente o la anterior |
| Borrar                              | La tarjeta siguiente, la anterior o «Tareas»                        |

  Si la lista queda vacía, el foco va al encabezado «Tareas». Si la persona ya había pasado a otro campo, no se le
  quita el foco.

#### Nota de capacidad

- **Coste por acción.** Cada acción cuesta una escritura y una lectura de la lista al backend. Los contadores se
  leen con Prisma (ver «Contadores y Prisma en el frontend») y no cuentan en el cupo de Express.
- **StrictMode en desarrollo.** El modo de React que monta dos veces cada componente para detectar fallos duplica la
  carga inicial: son dos `GET`. La cancelación de la petición anterior evita que se pinte una respuesta vieja, pero el
  backend puede contar las dos peticiones.
- **Demos rápidas.** Con los cupos por defecto (`RATE_LIMIT_MAX=100` peticiones generales y `RATE_LIMIT_POST_MAX=20`
  de `POST` por IP, en ventanas de 15 minutos: `RATE_LIMIT_WINDOW_MS=900000`), una demo rápida puede recibir `429`.
- **Cupo compartido.** Todos los usuarios cuentan como una sola IP, por diseño (ver «Cupo compartido por diseño
  (desviación declarada)»). Para una demo con varias personas, suba `RATE_LIMIT_MAX` y `RATE_LIMIT_POST_MAX` (el segundo no puede superar al
  primero). `.env.example` trae comentados los valores 1000 y 200. Ver «Variables del servicio».

#### Comprobaciones manuales del cliente

No las cubre ningún test. Las hace quien implementa y anota el resultado de cada punto.

- [ ] **`isPending` en el refresco.** Comprobar que `startTransition(() => router.refresh())` expone `isPending` en
  Next 16.4.3: añadir un `console.log` temporal del valor, ver que pasa a `true` durante el refresco y quitarlo antes de
  hacer el commit.
- [ ] **Formulario tras el refresco.** El formulario conserva su texto tras `router.refresh()`. Crear, completar y
  desmarcar, editar y borrar hacen cambiar los contadores.
- [ ] **Dos pestañas.** Borrar la misma tarea en la otra pestaña y ver «La tarea ya no existe.».
- [ ] **Borrador al cambiar de filtro.** Con un borrador de crear y otro de editar a medias, cambiar de filtro: se
  conservan si la tarea sigue en la lista.
- [ ] **Diseño a 320, 768 y 1280 px.** Con un título de 100 caracteres sin espacios, una descripción de 500 caracteres
  con saltos de línea y 1 000 tareas: sin scroll horizontal, con los saltos de línea conservados, controles de al
  menos 44 px y formulario y acciones accesibles en móvil.
- [ ] **Teclado.** Tab en orden lógico y con foco visible; Enter envía el formulario; Escape cancela la edición; el foco
  llega a los destinos de la tabla anterior.
- [ ] **Arranque conjunto.** Con el backend y el frontend en marcha: crear, completar, desmarcar, editar, borrar,
  cambiar de filtro y ver cómo cambian los contadores.

### Rutas del servidor del frontend

#### Arquitectura Server/Client

El navegador solo habla con su propio origen (`http://127.0.0.1:3001`); nunca con Express ni con la base de datos. El
servidor de Next hace de intermediario:

```
navegador -> rutas /api/tasks de Next (servidor) -> Express -> PostgreSQL (rol writer)
página (Server Component) -> Prisma con el rol reader -> vista task_counts
```

- **Server Component** para los contadores: se leen en el servidor, con credenciales que el navegador no ve.
- **Rutas de API** (`app/api/tasks`) para la lista y las escrituras: añaden la API key, que solo existe en el servidor.
- **Client Component** (la lista, en `client/task-manager.tsx`): pide la lista a `GET /api/tasks` de este mismo servidor. Ver «Interfaz del cliente».
- **Por qué rutas de API y no llamar a Express desde el navegador:** la key tendría que estar en el navegador.
  Alternativa descartada: `NEXT_PUBLIC_API_KEY` (cualquiera la vería en las herramientas del navegador).
- **Por qué no Server Actions:** las rutas son un contrato HTTP explícito, fácil de probar con `curl` y con tests.

#### Las cuatro operaciones y el 405

| Método   | Ruta               | Reenvía a Express            | Éxito          |
| -------- | ------------------ | ---------------------------- | -------------- |
| `GET`    | `/api/tasks`       | `GET /api/tasks`             | `200` (arreglo) |
| `POST`   | `/api/tasks`       | `POST /api/tasks`            | `201` (tarea)  |
| `PUT`    | `/api/tasks/<id>`  | `PUT /api/tasks/<id>`        | `200` (tarea)  |
| `DELETE` | `/api/tasks/<id>`  | `DELETE /api/tasks/<id>`     | `204` sin cuerpo |

`GET /api/tasks` admite `?filter=completed` o `?filter=pending` (se reenvía como `?completed=true` o `false`). Cada
ruta exporta **todos** los métodos (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`) y los que no atiende
responden `405 METHOD_NOT_ALLOWED` con `Allow: GET, POST` (colección) o `Allow: PUT, DELETE` (con id), sin tocar
Express; la respuesta a `HEAD` no lleva cuerpo. **Por qué se exportan todos:** si no, Next inventaría por su cuenta
las respuestas a `OPTIONS` y `HEAD`. Todas las respuestas llevan `Cache-Control: no-store` y las rutas son dinámicas
(`dynamic = 'force-dynamic'`): nada se guarda en cachés.

#### Orden de comprobaciones

Antes de reenviar, cada petición pasa estos pasos en este orden; el primero que falla responde y los demás no se
ejecutan. Los seis primeros no leen el cuerpo.

1. Método no soportado: `405`.
2. Defensa de origen y de `Host`: `403` (ver abajo).
3. `id` que no es un UUID completo (`..`, `%2e%2e`, `a%2Fb`, un sufijo): `400`. Se mira el segmento tal cual viene en
   la dirección y debe coincidir con el parámetro que entrega Next; el `id` se pasa a minúsculas.
4. Consulta: en `GET` solo se admite un `filter` válido; en `POST`, `PUT` y `DELETE`, ninguna: `400`.
5. `Content-Length` (`POST`, `PUT`): no numérico `400`; mayor de 10 240 bytes `413`.
6. `Content-Type: application/json` (con o sin `charset=utf-8`) y sin `Content-Encoding` (salvo `identity`): `415`.
7. Lectura del cuerpo **en flujo**, con tope de 10 240 bytes realmente recibidos (`413`, aunque `Content-Length`
   mintiera) y plazo de 5 segundos (`408`); si la conexión se corta, `400`.
8. El cuerpo debe ser UTF-8 válido sin BOM, JSON, un objeto y sin la clave `__proto__`: `400`.

El borde **no valida campos** (título, descripción): esa autoridad es Express, y así hay una sola fuente de verdad. Pero
**nunca reenvía el texto crudo**: reenvía el JSON ya analizado y vuelto a serializar (sin espacios ni claves repetidas).
Alternativas descartadas: reenviar el texto tal cual (más superficie) y validar también los campos aquí (dos fuentes
de verdad que se desincronizan). `GET` y `DELETE` no leen ni envían cuerpo aunque lo traigan. Exigir JSON impide además
que un formulario de otra web envíe un `POST` simple a estas rutas.

#### Errores hacia el navegador

Siempre con la forma `{"error":{"code","message","details"}}`; el mensaje lo escribe este servidor desde tablas
cerradas, **nunca se copia texto ni cabeceras de Express** (podrían llevar SQL, trazas o la key).

| Qué ocurre                                                | El navegador recibe                                 |
| --------------------------------------------------------- | --------------------------------------------------- |
| Método no soportado                                       | `405 METHOD_NOT_ALLOWED` + `Allow`                  |
| Origen o `Host` no permitido                              | `403 FORBIDDEN`                                     |
| `id` o consulta inválidos; cuerpo no válido o cortado     | `400 BAD_REQUEST` (con `details` de `id`, `query` o `body`) |
| Cuerpo demasiado grande                                   | `413 PAYLOAD_TOO_LARGE`                             |
| Tipo o codificación no admitidos                          | `415 UNSUPPORTED_MEDIA_TYPE`                        |
| Plazo de lectura del cuerpo agotado                       | `408 REQUEST_TIMEOUT`                               |
| Error inesperado o configuración inválida                 | `500 INTERNAL_ERROR`                                |
| Express: `400` de validación (`POST`, `PUT`)              | `400 VALIDATION_ERROR` con `details` filtrados      |
| Express: `404` (`PUT`, `DELETE`)                          | `404 NOT_FOUND` «La tarea ya no existe.»            |
| Express: `413` (`POST`, `PUT`)                            | `413 PAYLOAD_TOO_LARGE`                             |
| Express: `429`                                            | `429 TOO_MANY_REQUESTS`, con `Retry-After` solo si es válido |
| Express: `401`, `500`, `405`, `3xx`, éxito inesperado, JSON roto, forma inesperada o respuesta de más de 8 MiB | `502 BAD_GATEWAY` |
| Express no responde (conexión rechazada)                  | `502 BAD_GATEWAY`                                   |
| Express no responde en 15 segundos                        | `504 GATEWAY_TIMEOUT`                               |

Detalles que conviene saber:

- **`401` de Express se muestra como `502`**: es un fallo de configuración entre servidores (la key no coincide), no de
  la persona; así no se da información de más.
- **`details` del `400` de Express**: solo se conservan los campos conocidos (`body`, `query`, `id`, `title`,
  `description`, `completed`) y solo los mensajes de la lista conocida; cualquier otro texto pasa a «Valor no válido.».
- **`Retry-After` del `429`**: se acepta solo un entero de 1 a 3600 sin signo ni ceros a la izquierda; si no es válido
  se omite la cabecera y el mensaje es «Demasiadas peticiones. Inténtalo de nuevo en unos instantes.». Con N válido, el
  mensaje dice «Espera N segundos» (menos de 120) o los minutos redondeados hacia arriba.
- **Una tarea de Express** se valida (cinco claves, UUID, longitudes, fecha ISO 8601 real) y se vuelve a construir; lo
  que no cuadre es `502`.
- **Sin redirecciones ni reintentos nunca.** Un `POST` reintentado crearía tareas duplicadas.
- **Un `504` (o `502`) en un `POST` puede haber creado la tarea** (sin idempotencia). Por eso el mensaje es «No se pudo
  confirmar si la tarea se creó. Revisa la lista antes de volver a enviarla.». Alternativa descartada: claves de
  idempotencia (exigen almacenarlas en el backend); queda como trabajo futuro.
- **Plazos**: 5 s para leer el cuerpo de la petición, 15 s para el reenvío (incluye leer la respuesta de Express) y
  tope de 8 MiB en su respuesta. Los 15 s son mayores que la espera del pool del backend (`DB_POOL_CONNECTION_TIMEOUT_MS`,
  5 s por defecto) más una consulta normal, para que Express conteste su propio error antes de que el frontend se rinda.
  Si se sube `DB_POOL_CONNECTION_TIMEOUT_MS` por encima de unos 10 s, el frontend responderá `504` antes. El tope de
  8 MiB deja margen sobre `TASKS_LIST_LIMIT` (por defecto 1000 tareas, unos cientos de KiB); si se sube ese límite al
  máximo (10 000), la respuesta sigue cabiendo con holgura.
- **Si el navegador cancela**, se cancela la petición a Express y no se registra como error.

#### Defensa de origen y de `Host`

Sin login, la API key autentica a la aplicación, no a la persona. Una web ajena abierta en el navegador podría intentar
escribir contra `localhost:3001`. Por eso, en `POST`, `PUT` y `DELETE`, se responde `403` (sin tocar Express) si:

- trae `Origin` y su host (con puerto) no es exactamente el `Host` de la petición, o es `null`, o está repetido;
- trae `Sec-Fetch-Site: cross-site`.

`Sec-Fetch-Site: same-origin` y `none` pasan; con `same-site` decide `Origin`. Opcionalmente,
`ALLOWED_HOSTS` valida el `Host` de **cualquier** método (protege frente a la reasignación de DNS cuando se conoce el
nombre público).

- **Por qué cabeceras y no un token CSRF:** sin sesión no hay dónde anclar un token, y las cabeceras `Origin` y
  `Sec-Fetch-Site` las pone el navegador y una web no puede falsificarlas. Alternativa descartada: CORS en las rutas
  (no impide que la petición se envíe, solo que se lea la respuesta).
- **Limitación:** un cliente que no es un navegador (`curl`, un script) no envía `Origin` y pasa. Es inevitable sin
  login: quien alcance el puerto 3001 puede usar la API. Por eso el servidor escucha solo en `127.0.0.1`.

#### Qué viaja a Express

El servidor del frontend envía a Express **solo** `Authorization: Bearer <API_KEY>` y, con cuerpo,
`Content-Type: application/json` (más lo que añade el propio cliente HTTP). **No copia ninguna cabecera del
navegador** (`Cookie`, `Authorization`, `X-Forwarded-*`, `Forwarded`, `X-Real-IP`, `Origin`, `Referer`,
`Content-Encoding`). Por qué: copiarlas permitiría falsificar la IP que cuenta el límite de peticiones y reenviar
credenciales ajenas.

- **Nunca se envía `X-Forwarded-For` ni otra cabecera de IP**, por diseño (ver «Cupo compartido por diseño
  (desviación declarada)»). Consecuencia: **el backend ve a todos los usuarios como un único cliente**, con un
  único cupo compartido de peticiones. En una demo con varias personas, súbanse los cupos del backend
  (`RATE_LIMIT_MAX` y `RATE_LIMIT_POST_MAX`, ver «Variables del servicio»).
- **Sin límite de peticiones propio en el frontend:** el límite por IP está en Express; duplicarlo aquí, donde las
  rutas no conocen la IP de quien llama, no aportaría nada.
- **Sin login:** la key autentica a la aplicación, no a la persona; quien alcance el frontend usa la API.
- **Sin `Content-Security-Policy`** (ver «Cabeceras de seguridad»): trabajo futuro.

#### Registros de las rutas

Los errores de las rutas se registran con el logger propio (ver «Registros del frontend»): el evento `route_failed`
con `method`, `route` (la plantilla `/api/tasks` o `/api/tasks/:id`, nunca la dirección real), `errorName` y
`errorCode`. Se registran el error inesperado de un manejador y la conexión rechazada con Express. No se registra el
`message`, la traza, la URL, las cabeceras, el cuerpo, el `id`, la key ni valores de variables. Con una configuración
inválida las rutas responden `500` y los nombres de las variables se registran una sola vez (`config_invalid`).

#### Comprobar la salida del navegador: `npm run verify:build`

Compila dos veces: sin ninguna variable de configuración (la compilación no debe necesitarla) y con valores centinela;
después recorre `.next/static`, que es lo único que se envía al navegador, y falla si encuentra un centinela o el
nombre de `API_KEY`, `READER_DATABASE_URL` o `BACKEND_URL`. Alternativa descartada: hacerlo dentro de `npm test`
(es lento y choca con la carpeta `.next` de `npm run build`).

#### Lista de verificación manual (contra `next start`)

Con la base de datos, el backend y `npm run build` + `npm run start` en `frontend/` en marcha. Anote el resultado de
cada punto. (`<id>` es el de una tarea existente; `$KEY` es la API key, que no debe pegarse en ningún sitio público.)

1. Arrancar `npm run start` sin `frontend/.env` falla con un mensaje que nombra las variables inválidas y sin valores.
2. `curl` a las cuatro operaciones con backend y frontend a la vez:
   `curl -i http://127.0.0.1:3001/api/tasks`, `curl -i -X POST -H "Content-Type: application/json" -d '{"title":"Prueba"}' http://127.0.0.1:3001/api/tasks`,
   y `PUT` y `DELETE` sobre `/api/tasks/<id>` (`PUT` con un JSON con `title`).
3. `/api/tasks/` y `/api/tasks/<id>/` (con barra final) responden `308` hacia la ruta sin barra y no llegan a Express.
4. `curl -i -X OPTIONS` y `curl -i -I` (`HEAD`) sobre `/api/tasks` responden `405` propio con `Allow`.
5. Cabeceras reales: `curl -i http://127.0.0.1:3001/` y `curl -i http://127.0.0.1:3001/api/tasks` llevan
   `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, no llevan `X-Powered-By`, y la ruta lleva
   `Cache-Control: no-store`.
6. `curl -i -X POST -H "Origin: http://evil.example" -H "Content-Type: application/json" -d '{"title":"x"}' http://127.0.0.1:3001/api/tasks`
   responde `403`.
7. Se puede entrar por `http://localhost:3001` y por `http://127.0.0.1:3001` (y una escritura desde la propia página,
   o con `Origin` igual al `Host`, pasa).
8. Con `PORT=4000 npm run start` el servidor sigue en el puerto 3001.
9. Con el backend apagado, `GET /api/tasks` responde `502` (o `504` si tarda) y el servidor del frontend sigue
   atendiendo después.
10. `npm run verify:build` termina con «OK» y sin hallazgos.
11. Cancelación del navegador: iniciar con el backend lento o parado un `curl` a `/api/tasks`, cortarlo con Ctrl+C y
    comprobar que el servidor del frontend sigue sano. Si `request.signal` no se aborta al cortar la
    conexión, es una limitación conocida y el plazo de 15 s sigue protegiendo.

### Por qué el proyecto se creó a mano

No se usó `create-next-app`: instala versiones con `^`, añade archivos de demostración y fuentes que se descargan en
la compilación (la compilación fallaría sin red) y su asistente es interactivo. A mano, todas las versiones son
exactas (`--save-exact`) y el repositorio solo tiene lo que se usa.

### Versiones y compatibilidad (ESLint 10 sin `eslint-config-next`)

Todas las versiones son exactas: Next.js 16.4.3 (`latest` estable al crear el proyecto), React y React DOM 19.3.1,
Tailwind CSS 4.3.3, TypeScript 6.0.3, ESLint 10.13.0, typescript-eslint 8.72.0, Prettier 3.9.10 y Vitest 5.0.5, las
mismas herramientas que el backend. Next.js exige Node 20.9 o superior; el `engines` del frontend es el del backend.

- **Decisión:** se mantiene ESLint 10 y NO se instala `eslint-config-next`. Ese paquete trae los plugins `react`,
  `import` y `jsx-a11y`, que no declaran compatibilidad con ESLint 10. En su lugar se instalan los plugins que se usan
  y se cablean a mano en `eslint.config.mjs`: `@next/eslint-plugin-next` 16.4.3 (reglas recomendadas y
  `core-web-vitals`), `eslint-plugin-react-hooks` 7.1.1 (declara ESLint 10) y `eslint-plugin-react` 7.37.5 (solo
  `react/no-danger`). Cada plugin se comprobó con una regla mutada que debe fallar (ver «Pruebas»).
- **Por qué:** así el frontend usa las mismas versiones de ESLint, TypeScript y typescript-eslint que el backend, y
  solo se activan reglas que se entienden y se justifican.
- **Alternativa descartada:** bajar a ESLint 9 para usar `eslint-config-next`. Habría dado una configuración «de
  fábrica», pero con dos versiones de ESLint en el repositorio y reglas que nadie ha elegido.
- **Excepción documentada:** `eslint-plugin-react` 7.37.5 declara como peer ESLint hasta la 9. Funciona con ESLint 10
  (se comprobó con una regla mutada), así que `package.json` lleva un `overrides` de npm que le indica que use el
  `eslint` del proyecto (`"eslint-plugin-react": { "eslint": "$eslint" }`). No se usa `--legacy-peer-deps`. Si sale una
  versión del plugin que declare ESLint 10, se quita el `overrides`.
- `@next/next/*` queda con las severidades de su configuración recomendada (algunas son avisos, no errores).

### Generados que no se suben

`next-env.d.ts` (lo escribe Next y apunta a `.next`) está en `.gitignore`: `npm run typecheck` funciona en un clon limpio
sin él. `npm run dev` puede crear un `AGENTS.md` si detecta un asistente de código; también se ignora.
`src/generated/` (el cliente de Prisma) tampoco se sube: `npm install` lo regenera con `prisma generate`.

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
«Seguridad: API key»). Limita las peticiones por IP (ver «Límite de peticiones»), bloquea la IP tras demasiados fallos
de key (ver «Bloqueo por intentos fallidos») y aplica CORS a un solo origen (`CORS_ORIGIN`, ver «CORS»). `GET /api/tasks`
devuelve como máximo `TASKS_LIST_LIMIT` tareas (ver «Tope de la lista»). Aun así, no debe exponerse a internet: no tiene
HTTPS propio ni login de usuarios. Quien tenga la key puede crear, modificar y borrar tareas.

La base de datos se prepara con `npm run db:deploy` (dentro de `backend/`). Para arrancar la aplicación completa con un
solo comando, ver «Arranque conjunto».

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

## Base de datos

Ya implementado: migración documentada de la tabla `tasks` (ver «Esquema y migraciones»), `backend/queries.sql` con
dos consultas escritas a mano (filtro por `completed` y conteo agrupado por estado; ver «Consultas SQL») e índice
sobre `completed` (`tasks_completed_idx`). Justificación honesta del índice: con pocas filas aporta poco beneficio;
se justifica por el patrón de consulta (casi todas las lecturas filtran por estado) y por el crecimiento esperado
de la tabla.

## Despliegue con Docker Compose

Esta sección explica cómo se empaqueta y se ejecuta la aplicación completa con Docker: PostgreSQL, una tarea de un
solo uso que migra la base (`migrate`), el backend y el frontend. Se va completando por partes: están las imágenes
del backend y del frontend, el script de inicio de la base, las variables y la composición (`docker-compose.yml`) que
las une; el endurecimiento y el cierre ordenado se documentan cuando se añadan.

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

Las pruebas estáticas (`backend/tests/static/dockerfiles.test.ts`) comprueban sin Docker las etapas y su orden, el
usuario numérico, la etiqueta de Node, la ausencia de credenciales y de `COPY . .`, el contenido de
`backend/.dockerignore` y la forma de los comandos de arranque.

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
  añadir su `COPY` a la etapa `runner` (la prueba estática falla para recordarlo).
- **Usuario y arranque.** `USER 10001:10001` numérico, como en el backend, y `CMD ["node", "server.js"]` en forma de
  lista: `node` es el proceso principal y recibe directamente las señales de parada.

Construcción manual (solo para probar; Compose lo hará por ti):

```powershell
docker build -t todo-frontend frontend
```

Las mismas pruebas estáticas (`backend/tests/static/dockerfiles.test.ts`) cubren el frontend: etapas, usuario,
etiqueta de Node común con el backend, ausencia de variables de ejecución en la construcción, `.dockerignore`,
`output: 'standalone'` y el comando de arranque.

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
sobrescribir desde el `.env`: la relación entre ellos debe mantenerse y un test estático la comprueba. No se cambia
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

### Comprobación manual

Los tests estáticos leen los archivos, pero no ejecutan Docker. Esta lista de veinte pasos comprueba a mano, en Docker
Desktop, lo que solo se ve con los contenedores en marcha. Reglas de la lista:

- Se ejecuta en PowerShell desde la raíz del repositorio, con un `.env` creado a partir de `.env.example` (ver
  «Variables del despliegue»). Ningún paso imprime el contenido del `.env`.
- Todos los comandos de Compose llevan `-f docker-compose.yml` (conviven dos archivos de Compose en la carpeta). La
  única excepción es el listado de proyectos (`docker compose ls`), que no depende de ningún archivo. La
  configuración se valida siempre con `config --quiet` (sin ese `--quiet`, Compose imprimiría los valores de las
  variables, entre ellos las contraseñas).
- `down` conserva los datos. `down -v` los **BORRA**: solo se usa en el paso 2, siempre con
  `-f docker-compose.yml -p todo-app-deploy` explícitos, y NUNCA contra el proyecto de desarrollo.
- Versión de Compose con la que se preparó la composición: v5.3.1 (Docker 29.6.2). La versión del equipo del usuario no
  se ha anotado. Con una versión anterior, `--wait` y `service_completed_successfully` podrían no comportarse igual; no
  se ha probado.

**Nota sobre `SIGTERM`.** Docker Desktop ejecuta contenedores Linux, así que parar un servicio con `stop` envía un `SIGTERM`
real al proceso principal (en Windows nativo no existe, ver «Cierre ordenado»). El paso 14 lo comprueba con el
backend: debe registrar `shutdown_started` y `shutdown_completed`, y terminar con código 0. El paso 14a comprobó esa
señal real en el backend (el `SIGTERM` real solo se comprobó en el backend); los pasos 14b, 14c y 14d (cierre
con una petición en curso, frontend y PostgreSQL) no se ejecutaron.

1. **`.env` vacío falla; con el `.env` real, la configuración es válida.** Prueba que las variables obligatorias se
   exigen y que el error no muestra valores.

   ```powershell
   New-Item $env:TEMP\vacio.env -ItemType File -Force | Out-Null
   docker compose -f docker-compose.yml --env-file $env:TEMP\vacio.env config --quiet; $LASTEXITCODE
   docker compose -f docker-compose.yml config --quiet; $LASTEXITCODE
   Remove-Item $env:TEMP\vacio.env
   ```

   Esperado: el primero termina con código distinto de 0 y un mensaje que nombra una variable obligatoria (por ejemplo
   `API_KEY` o `POSTGRES_USER`, según el orden en que Compose las evalúe), sin ningún valor. El segundo no imprime nada
   y termina con código 0.

2. **Estado inicial limpio.** Comprueba que no hay datos de pruebas anteriores y que el despliegue no se confunde con
   el desarrollo.

   ```powershell
   docker volume ls --filter name=todo_app_deploy
   docker compose ls -a
   ```

   Esperado: ningún volumen `todo_app_deploy_pgdata` y ningún proyecto `todo-app-deploy` en el listado (el proyecto de
   desarrollo, si aparece, tiene otro nombre y no se toca). Si el volumen existe de pruebas anteriores, se borra solo el
   del despliegue (esto BORRA sus datos) y se repite la comprobación:

   ```powershell
   docker compose -f docker-compose.yml -p todo-app-deploy down -v
   ```

3. **Arranque en frío sano.** Construye las imágenes, crea el volumen, migra y espera a que todo esté sano.

   ```powershell
   $inicio = Get-Date
   docker compose -f docker-compose.yml up -d --build --wait; $LASTEXITCODE
   ((Get-Date) - $inicio).TotalSeconds
   docker compose -f docker-compose.yml ps -a
   ```

   Esperado: código 0; `postgres`, `backend` y `frontend` en `healthy`; `migrate` en `Exited (0)`. Anotar el tiempo.

4. **Roles, permisos, índice y ausencia de la base de pruebas.** Consulta el catálogo de la base desde dentro del
   contenedor, con el usuario administrador de la imagen (las consultas entran por la entrada estándar para no
   depender de las comillas de PowerShell).

   ```powershell
   $consultas = @(
     '\l',
     "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname IN ('owner','writer','reader') ORDER BY 1;",
     '\dt', '\dv', '\di',
     "SELECT has_table_privilege('reader','tasks','SELECT') AS reader_tasks, has_table_privilege('reader','task_counts','SELECT') AS reader_counts, (has_table_privilege('writer','tasks','SELECT') AND has_table_privilege('writer','tasks','INSERT') AND has_table_privilege('writer','tasks','UPDATE') AND has_table_privilege('writer','tasks','DELETE')) AS writer_crud, has_schema_privilege('writer','public','CREATE') AS writer_create;"
   )
   $consultas | docker compose -f docker-compose.yml exec -T postgres sh -c 'psql -U $POSTGRES_USER -d $DB_NAME'
   ```

   Esperado: aparece la base de `DB_NAME` (`todo_app` por defecto) y NINGUNA base terminada en `_test`; los tres roles
   con todos los atributos privilegiados en `f`; `\dt` lista `tasks`, `\dv` lista `task_counts` y `\di` lista
   `tasks_completed_idx`; la última consulta da `reader_tasks = f`, `reader_counts = t`, `writer_crud = t` y
   `writer_create = f`.

5. **Migración repetible.** Repite el arranque y la migración y comprueba que nada cambia.

   ```powershell
   $huella = "SELECT (SELECT count(*) FROM _prisma_migrations) AS migraciones, (SELECT md5(string_agg(relname || COALESCE(relacl::text, ''), ',' ORDER BY relname)) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','v')) AS permisos;"
   $huella | docker compose -f docker-compose.yml exec -T postgres sh -c 'psql -U $POSTGRES_USER -d $DB_NAME'
   docker compose -f docker-compose.yml up -d --wait; $LASTEXITCODE
   docker compose -f docker-compose.yml run --rm --no-deps migrate
   $huella | docker compose -f docker-compose.yml exec -T postgres sh -c 'psql -U $POSTGRES_USER -d $DB_NAME'
   ```

   Esperado: el segundo comando termina con código 0 (como `migrate` ya terminó y no cambió, Compose no lo ejecuta
   otra vez; por eso el tercero lo ejecuta de forma explícita); la salida de `migrate` indica que no hay migraciones
   pendientes y termina con código 0; las dos huellas (número de migraciones y resumen de permisos) son idénticas.

6. **Una migración fallida impide arrancar el resto.** Se usa una contraseña falsa para `owner` en un archivo
   temporal; el `.env` real no se modifica ni se muestra.

   ```powershell
   docker compose -f docker-compose.yml down
   (Get-Content .env) -replace '^OWNER_PASSWORD=.*', 'OWNER_PASSWORD=contrasena-falsa-123' | Set-Content $env:TEMP\malo.env
   docker compose -f docker-compose.yml --env-file $env:TEMP\malo.env up -d --wait; $LASTEXITCODE
   docker inspect -f '{{.State.ExitCode}}' (docker compose -f docker-compose.yml ps -a -q migrate)
   docker compose -f docker-compose.yml ps -a
   docker compose -f docker-compose.yml logs --no-color migrate
   docker compose -f docker-compose.yml logs --no-color migrate | Select-String -SimpleMatch -Quiet 'contrasena-falsa-123'
   Remove-Item $env:TEMP\malo.env
   docker compose -f docker-compose.yml up -d --wait; $LASTEXITCODE
   ```

   Esperado: el primer `up` termina con código distinto de 0; el código de salida de `migrate` es distinto de 0;
   `backend` y `frontend` no arrancaron (en `ps -a` aparecen `Created` o no aparecen); el registro de `migrate` nombra
   el fallo de autenticación del rol `owner` y la búsqueda de la contraseña falsa da `False` (el registro no la
   muestra). El último `up`, con el `.env` real, termina con código 0 y deja todo sano.

7. **Puertos publicados.** Solo el frontend, solo en este equipo.

   ```powershell
   docker compose -f docker-compose.yml ps
   (Test-NetConnection 127.0.0.1 -Port 3001 -WarningAction SilentlyContinue).TcpTestSucceeded
   (Test-NetConnection 127.0.0.1 -Port 3000 -WarningAction SilentlyContinue).TcpTestSucceeded
   (Test-NetConnection 127.0.0.1 -Port 5432 -WarningAction SilentlyContinue).TcpTestSucceeded
   $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' } | Select-Object -First 1).IPAddress
   (Test-NetConnection $ip -Port 3001 -WarningAction SilentlyContinue).TcpTestSucceeded
   ```

   Esperado: solo `frontend` muestra `127.0.0.1:3001->3001/tcp`; las pruebas dan `True` (3001 en 127.0.0.1), `False`
   (3000), `False` (5432) y `False` (3001 con la IP de la red local del equipo).

8. **Red interna sin salida a internet.** Prueba que la base y la API no pueden salir, y que el anfitrión no llega a
   la API.

   ```powershell
   docker network inspect todo_app_deploy_internal -f '{{.Internal}}'
   docker compose -f docker-compose.yml exec -T backend node -e "require('node:https').get('https://example.com',(r)=>{console.log('SALIDA',r.statusCode);process.exit(0)}).on('error',(e)=>{console.log('SIN SALIDA',e.code);process.exit(0)})"
   docker compose -f docker-compose.yml exec -T postgres bash -c '(echo > /dev/tcp/1.1.1.1/443) 2>/dev/null && echo SALIDA || echo SIN SALIDA'
   $idBackend = docker compose -f docker-compose.yml ps -q backend
   $ipBackend = docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $idBackend
   (Test-NetConnection $ipBackend -Port 3000 -WarningAction SilentlyContinue).TcpTestSucceeded
   docker compose -f docker-compose.yml exec -T frontend node -e "require('node:https').get('https://example.com',(r)=>{console.log('SALIDA',r.statusCode);process.exit(0)}).on('error',(e)=>{console.log('SIN SALIDA',e.code);process.exit(0)})"
   ```

   Esperado: `true`; `SIN SALIDA` con un código de red (`ENOTFOUND`, `EAI_AGAIN` o `ENETUNREACH`) desde el backend;
   `SIN SALIDA` desde `postgres`; `False` desde el anfitrión hacia la IP interna del backend. La última línea, desde el
   frontend, SÍ muestra `SALIDA` con un código HTTP: es lo esperado y está documentado (el frontend está en `publish`).

9. **Salud de los servicios.**

   ```powershell
   docker compose -f docker-compose.yml ps -a
   docker inspect -f '{{.State.Health.Status}}' (docker compose -f docker-compose.yml ps -q postgres backend frontend)
   ```

   Esperado: el mismo estado que en el paso 3; las tres líneas de `docker inspect` dicen `healthy`.

10. **Aplicación en el navegador.** Abrir `http://127.0.0.1:3001` y también `http://localhost:3001`. Crear, completar,
    desmarcar, editar y borrar una tarea; abrir `http://127.0.0.1:3001/?filter=completed`. Esperado: sin errores
    visibles; los contadores Todas, Completadas y Pendientes son correctos tras cada acción y el filtro funciona.

    ```powershell
    Start-Process http://127.0.0.1:3001
    ```

11. **Archivos estáticos y cabecera `Host`.** Prueba que los estáticos del servidor independiente se sirven y que una
    escritura con un `Host` ajeno se rechaza.

    ```powershell
    $html = (curl.exe -s http://127.0.0.1:3001/) -join "`n"
    $ruta = [regex]::Match($html, '/_next/static/[^"]+\.(js|css)').Value
    curl.exe -s -o NUL -w "%{http_code}`n" "http://127.0.0.1:3001$ruta"
    curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: 127.0.0.1:3001" http://127.0.0.1:3001/
    curl.exe -s -o NUL -w "%{http_code}`n" -X POST -H "Host: otro.example" -H "Content-Type: application/json" -d "{}" http://127.0.0.1:3001/api/tasks
    ```

    Esperado: `200`, `200` y `403`.

12. **Cupo compartido.** Primero se lee el valor efectivo; después se baja el cupo con un archivo temporal para ver el
    429 sin lanzar cientos de peticiones.

    ```powershell
    docker compose -f docker-compose.yml exec -T backend printenv RATE_LIMIT_MAX RATE_LIMIT_POST_MAX
    Get-Content .env | Where-Object { $_ -notmatch '^(RATE_LIMIT_MAX|RATE_LIMIT_POST_MAX|RATE_LIMIT_AUTH_FAILURES_MAX)=' } | Set-Content $env:TEMP\cupo.env
    Add-Content $env:TEMP\cupo.env 'RATE_LIMIT_MAX=10'
    Add-Content $env:TEMP\cupo.env 'RATE_LIMIT_POST_MAX=5'
    Add-Content $env:TEMP\cupo.env 'RATE_LIMIT_AUTH_FAILURES_MAX=5'
    docker compose -f docker-compose.yml --env-file $env:TEMP\cupo.env up -d --wait; $LASTEXITCODE
    1..12 | ForEach-Object { curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3001/api/tasks }
    curl.exe -s -o NUL -w "%{http_code}`n" -H "X-Forwarded-For: 203.0.113.9" http://127.0.0.1:3001/api/tasks
    Remove-Item $env:TEMP\cupo.env
    docker compose -f docker-compose.yml up -d --wait; $LASTEXITCODE
    docker compose -f docker-compose.yml exec -T backend printenv RATE_LIMIT_MAX RATE_LIMIT_POST_MAX
    ```

    Esperado: la primera lectura da `1000` y `200` si el `.env` no define los cupos (si da `100` y `20`, el `.env` es
    una copia literal de `.env.example` y manda sobre los de demostración: anotarlo, es el comportamiento
    documentado); con el cupo reducido, las doce peticiones empiezan con `200` y las últimas dan `429`; la petición con
    otra cabecera `X-Forwarded-For` TAMBIÉN da `429`: es el cupo único compartido por diseño, no un fallo, y la
    cabecera enviada no cambia el resultado. Al restaurar, `backend` se recrea y su contador se reinicia; la última
    lectura vuelve al valor inicial.

13. **API key mal puesta.** Se simula un frontend con una key equivocada y se comprueba el bloqueo y su recuperación.

    ```powershell
    1..12 | ForEach-Object { docker compose -f docker-compose.yml exec -T frontend node -e "fetch('http://backend:3000/api/tasks',{headers:{Authorization:'Bearer clave-falsa'}}).then((r)=>console.log(r.status))" }
    curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3001/api/tasks
    docker compose -f docker-compose.yml up -d --force-recreate backend
    curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3001/api/tasks
    ```

    Esperado: diez respuestas `401` (con el valor por defecto de `RATE_LIMIT_AUTH_FAILURES_MAX`, 10) y después `429`;
    la interfaz (segunda línea) también recibe `429`, porque el backend solo ve la IP del frontend y la bloquea
    entera; tras recrear el backend, el contador se reinicia y la tercera línea da `200`. Rotar la key: generar una
    nueva con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`, ponerla en `API_KEY`
    del `.env` y ejecutar:

    ```powershell
    docker compose -f docker-compose.yml up -d --force-recreate backend frontend
    ```

    Esperado: la aplicación vuelve a funcionar (`http://127.0.0.1:3001`) con la key nueva en los dos servicios a la vez.

14. **`SIGTERM` real.** Cuatro paradas, una por servicio, con el subcomando `stop` (envía `SIGTERM`).

    (a) Backend en reposo:

    ```powershell
    $idBackend = docker compose -f docker-compose.yml ps -q backend
    Measure-Command { docker compose -f docker-compose.yml stop backend } | Select-Object TotalSeconds
    docker compose -f docker-compose.yml logs --no-color backend
    docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}}' $idBackend
    ```

    Esperado: la parada tarda menos de 10 s (`SHUTDOWN_TIMEOUT_MS`); el registro contiene `shutdown_started` y
    `shutdown_completed`; `docker inspect` da `0 false`.

    (b) Con una petición en curso. En una terminal, abrir una conexión que envía las cabeceras de un `POST` con
    `Content-Length: 100` y solo una parte del cuerpo, y la deja abierta (la key se lee dentro del contenedor y no se
    imprime):

    ```powershell
    docker compose -f docker-compose.yml up -d --wait backend
    docker compose -f docker-compose.yml exec -T backend node -e "const s=require('node:net').connect(3000,'127.0.0.1',()=>{s.write('POST /api/tasks HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer '+process.env.API_KEY+'\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{');console.log('ABIERTO')});s.on('close',()=>{console.log('CERRADO');process.exit(0)})"
    ```

    En otra terminal, mientras la primera sigue abierta:

    ```powershell
    $idBackend = docker compose -f docker-compose.yml ps -q backend
    docker compose -f docker-compose.yml stop backend
    docker compose -f docker-compose.yml logs --no-color backend
    docker inspect -f '{{.State.ExitCode}}' $idBackend
    ```

    Esperado (según «Cierre ordenado»): una petición que no termina agota el plazo de 10 s (`SHUTDOWN_TIMEOUT_MS`):
    el registro contiene `shutdown_started` y `shutdown_timeout`, el código de salida es `1` (no `137`: el cierre
    forzado ocurre antes de los 20 s de `stop_grace_period`) y la primera terminal imprime `CERRADO`. Si el
    contenedor responde y cierra la conexión sin llegar al plazo, o si no se puede simular, se anota lo observado
    («no simulable» y por qué).

    (c) Frontend:

    ```powershell
    docker compose -f docker-compose.yml up -d --wait
    $idFrontend = docker compose -f docker-compose.yml ps -q frontend
    docker compose -f docker-compose.yml stop frontend
    docker inspect -f '{{.State.ExitCode}}' $idFrontend
    ```

    Esperado: `143` (128 + 15) es la limitación conocida del servidor de Next (ver «Plazos de cierre»); si da `0`, se
    anota. Lo que no puede pasar es `137` (cierre forzado).

    (d) PostgreSQL:

    ```powershell
    docker compose -f docker-compose.yml up -d --wait
    $idPostgres = docker compose -f docker-compose.yml ps -q postgres
    docker compose -f docker-compose.yml stop postgres
    docker inspect -f '{{.State.ExitCode}}' $idPostgres
    docker compose -f docker-compose.yml up -d --wait
    ```

    Esperado: `0` (cierre rápido de su imagen); el último `up` deja todo sano otra vez.

15. **Persistencia de los datos.** Crear una tarea en la interfaz (`http://127.0.0.1:3001`) y reiniciar sin `-v`.

    ```powershell
    docker compose -f docker-compose.yml down
    docker compose -f docker-compose.yml up -d --wait; $LASTEXITCODE
    docker compose -f docker-compose.yml logs --no-color postgres | Select-String 'Skipping initialization|CREATE ROLE'
    ```

    Esperado: la tarea sigue en la interfaz; el filtro del registro muestra solo la línea que indica que se omite la
    inicialización (el directorio de datos ya contiene una base) y ninguna línea `CREATE ROLE`.

16. **Sin secretos en imágenes ni en registros.** Primero las imágenes, con archivos centinela que coinciden con
    `.env.*` (no se toca ningún `.env` real):

    ```powershell
    Set-Content backend\.env.centinela 'CENTINELA_8f3a1c'
    Set-Content frontend\.env.centinela 'CENTINELA_8f3a1c'
    docker compose -f docker-compose.yml build --no-cache backend frontend migrate
    docker run --rm --entrypoint sh todo-app-deploy-backend -c "grep -r --exclude-dir=proc --exclude-dir=sys CENTINELA_8f3a1c / 2>/dev/null; ls -a /app"
    docker run --rm --entrypoint sh todo-app-deploy-migrate -c "grep -r --exclude-dir=proc --exclude-dir=sys CENTINELA_8f3a1c / 2>/dev/null; ls -a /app"
    docker run --rm --entrypoint sh todo-app-deploy-frontend -c "grep -r --exclude-dir=proc --exclude-dir=sys CENTINELA_8f3a1c / 2>/dev/null; ls -a /app"
    docker history --no-trunc todo-app-deploy-backend | Select-String CENTINELA_8f3a1c
    docker history --no-trunc todo-app-deploy-migrate | Select-String CENTINELA_8f3a1c
    docker history --no-trunc todo-app-deploy-frontend | Select-String CENTINELA_8f3a1c
    Remove-Item backend\.env.centinela, frontend\.env.centinela
    ```

    Después los registros: se guardan en un archivo temporal y se busca cada secreto del `.env` sin imprimirlo; solo
    se escribe el nombre si aparece.

    ```powershell
    docker compose -f docker-compose.yml up -d --wait
    docker compose -f docker-compose.yml logs --no-color > $env:TEMP\logs.txt
    $lineas = Get-Content .env
    foreach ($nombre in 'API_KEY', 'POSTGRES_PASSWORD', 'OWNER_PASSWORD', 'WRITER_PASSWORD', 'READER_PASSWORD') {
      $linea = $lineas | Where-Object { $_ -like "$nombre=*" } | Select-Object -First 1
      $valor = $linea.Substring($nombre.Length + 1)
      if (Select-String -Path $env:TEMP\logs.txt -SimpleMatch -Pattern $valor -Quiet) { "FUGA: $nombre" }
    }
    Remove-Item $env:TEMP\logs.txt
    ```

    Esperado: ninguna coincidencia con `CENTINELA_8f3a1c` (ni en los archivos ni en el historial), `ls -a /app` sin
    ningún `.env` en las tres imágenes, y ningún «FUGA». Riesgo residual que se anota: `docker inspect` de un
    contenedor en marcha muestra sus variables a quien tenga acceso al socket de Docker, que equivale a ser
    administrador del equipo.

17. **Usuario sin privilegios.**

    ```powershell
    docker compose -f docker-compose.yml run --rm --no-deps --entrypoint id backend -u
    docker compose -f docker-compose.yml run --rm --no-deps --entrypoint id frontend -u
    docker compose -f docker-compose.yml run --rm --no-deps --entrypoint id migrate -u
    docker compose -f docker-compose.yml exec -T backend sh -c 'grep ^Uid /proc/1/status'
    docker compose -f docker-compose.yml exec -T frontend sh -c 'grep ^Uid /proc/1/status'
    ```

    Esperado: `10001` en las tres primeras líneas; en las dos últimas, `Uid:` seguido de `10001` cuatro veces.

18. **Finales de línea del script de inicio.**

    ```powershell
    git check-attr eol docker/postgres/init/01-roles-and-databases.sh
    docker compose -f docker-compose.yml exec -T postgres sh -c 'grep -c -P \\r /docker-entrypoint-initdb.d/01-roles-and-databases.sh'
    ```

    Esperado: `eol: lf`; el recuento de retornos de carro dentro del contenedor es `0`. El arranque en frío del paso 3
    ya demuestra que el script se ejecutó (los roles y la base existen).

19. **Salud con la base caída.** Prueba la limitación documentada: el backend no consulta la base en su salud y el
    frontend sí.

    ```powershell
    docker compose -f docker-compose.yml stop postgres
    Start-Sleep -Seconds 120
    docker compose -f docker-compose.yml ps -a
    curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3001/api/tasks
    docker compose -f docker-compose.yml start postgres
    Start-Sleep -Seconds 120
    docker compose -f docker-compose.yml ps -a
    curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3001/api/tasks
    ```

    Esperado: con la base parada, `frontend` pasa a `unhealthy` (no se reinicia) y `backend` sigue `healthy`; la
    petición da `500` con un cuerpo genérico, sin detalles. Tras arrancar de nuevo la base, en unos minutos todo vuelve
    a `healthy` y la petición da `200`.

20. **Reconstrucción y limpieza.**

    ```powershell
    docker compose -f docker-compose.yml up -d --build --wait; $LASTEXITCODE
    docker compose -f docker-compose.yml ps -a
    docker compose -f docker-compose.yml down
    ```

    Esperado: código 0 y todo sano; `migrate` sigue en `Exited (0)` (si nada cambió, Compose no lo ejecuta de nuevo; se
    puede forzar con el comando del paso 5); los datos siguen. El `down` final conserva los datos. Reinicio completo
    opcional (BORRA los datos del despliegue; nunca contra el proyecto de desarrollo):

    ```powershell
    docker compose -f docker-compose.yml -p todo-app-deploy down -v
    ```

**Tabla de resultados.** Columna «Resultado»: `cumple` (el paso se comprobó completo), `parcial` (solo una parte; la
observación dice cuál), `no ejecutado` o `no cumple`. La observación recoge lo medido (tiempos, códigos, el valor
efectivo de los cupos).

| Paso | Qué se comprueba | Resultado | Observación |
| --- | --- | --- | --- |
| 1 | `.env` vacío falla; `.env` real válido | cumple | Ejecutado el 2026-10-26 por el usuario en Docker Desktop; sin observaciones. |
| 2 | Estado inicial limpio | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 3 | Arranque en frío sano | cumple | Ejecutado el 2026-10-26; sin observaciones. Tiempo no anotado. |
| 4 | Roles, permisos, índice, sin base de pruebas | parcial | Solo la lista de bases (`\l`): aparece la base de desarrollo y ninguna base de pruebas. Roles, permisos, catálogo e índice no se ejecutaron. |
| 5 | Migración repetible | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 6 | Migración fallida impide arrancar el resto | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 7 | Puertos publicados | parcial | Comprobado en 127.0.0.1. La prueba con la IP de la red local no se ejecutó. |
| 8 | Red interna sin salida | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 9 | Salud de los servicios | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 10 | Aplicación en el navegador | cumple | Ejecutado el 2026-10-26; sin observaciones. |
| 11 | Estáticos y cabecera `Host` | parcial | Solo la respuesta `403` con `Host` ajeno. Los estáticos y el `Host` correcto no se ejecutaron. |
| 12 | Cupo compartido | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 13 | API key mal puesta y rotación | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 14 | `SIGTERM` real (backend, frontend, base) | parcial | Solo 14a (backend en reposo): `shutdown_started` y `shutdown_completed`, código de salida 0 y `OOMKilled` falso. Los pasos 14b, 14c y 14d no se ejecutaron. |
| 15 | Persistencia de los datos | cumple | Ejecutado el 2026-10-26; sin observaciones. |
| 16 | Sin secretos en imágenes ni registros | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 17 | Usuario sin privilegios | parcial | Solo la parte `run --rm` con `id -u`. Las comprobaciones con los servicios en marcha (`/proc/1/status`) no se ejecutaron. |
| 18 | Finales de línea del script de inicio | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 19 | Salud con la base caída | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 20 | Reconstrucción y limpieza | parcial | Solo el `down` final, sin `-v`. La reconstrucción con `up -d --build --wait` no se ejecutó. |

**Cobertura de la comprobación (2026-10-26).** El usuario ejecutó en Docker Desktop 10 de los 20 pasos, total o
parcialmente: los pasos 1, 3, 10 y 15 completos, y los pasos 4, 7, 11, 14, 17 y 20 solo en parte. Los 10 pasos
restantes (2, 5, 6, 8, 9, 12, 13, 16, 18 y 19) no se ejecutaron y quedan como lista de verificación para quien
despliegue.

## Despliegue en Ubuntu

Los pasos de Ubuntu no se han probado en una máquina Ubuntu. Mientras tanto, el despliegue con Docker y su
comprobación manual están en «Despliegue con Docker Compose».

## Decisiones técnicas

Cada decisión indica su porqué y la alternativa descartada. Las de seguridad se resumen al final de esta sección.

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

**g) Rate limiting.** Dos cupos por IP de la conexión (general y de `POST`) con `express-rate-limit`, ventana fija, almacén en
memoria y valores configurables por variables de entorno (ver «Límite de peticiones»). Se eligió la librería porque
hace el trabajo sin código propio de más; el almacén en memoria basta para una sola instancia. Alternativas
descartadas: un contador propio para estos dos cupos (más código y deja la librería sin uso) y Redis (sin problema de
carga que lo justifique). Además, el bloqueo por intentos fallidos de key tiene su propio contador (ver «Bloqueo por
intentos fallidos»).

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

**n) Orden fijo de comprobación.** Cinco etapas previas (P0 a P4: cabeceras, cupo general, preflight, key y bloqueo, cupo
de `POST`) y ocho de la petición: ruta y método, tamaño, codificación y tipo, cuerpo, identificador, consulta y campos,
existencia de la tarea, base de datos (ver «Orden de comprobación de una petición»): el resultado
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

**Decisiones de seguridad (resumen).** Cada una se explica en su sección; aquí, el porqué y la alternativa descartada.

- **Bearer en `Authorization`.** Es el estándar para credenciales y no deja la key en la URL, que queda en historiales y
  registros de proxies. Alternativas descartadas: una cabecera propia o la key en la consulta.
- **SHA-256 y `timingSafeEqual`.** Ambos resúmenes miden 32 bytes: la comparación no lanza ni revela la longitud, y su
  tiempo no depende del contenido. Alternativas descartadas: `===` (el tiempo depende de dónde falla) y comprobar la
  longitud antes (la revela).
- **Denegar por defecto.** Toda ruta exige key salvo `/health` y el preflight de CORS válido, porque la guarda se
  registra con `app.use` y no compara rutas (las exenciones están en su propio manejador, antes de la guarda). Alternativa descartada: una lista de rutas protegidas, donde una ruta nueva nacería sin protección.
- **La key antes que `404` y `405`.** Quien no tiene key no averigua qué rutas ni métodos existen. Alternativa
  descartada: responder primero el `404` o el `405`.
- **Cupo compartido por diseño.** Los límites cuentan la IP de la conexión, que para el frontend es siempre la misma:
  todos los usuarios comparten el cupo. Alternativa descartada: reenviar una IP real desde el frontend, porque Next
  conserva la cabecera del navegador y las rutas no ven el socket, así que la IP sería falsificable (esquivar el límite
  o bloquear a otro). Ver «Cupo compartido por diseño (desviación declarada)».
- **Bloqueo total de la IP tras fallos.** Si la IP bloqueada pudiera entrar con la key buena, quien adivina seguiría
  obteniendo señal. Alternativa descartada: bloquear solo las keys erróneas.
- **Contador propio de fallos.** Es síncrono y suma solo al emitir el `401`, así que es exacto con peticiones
  simultáneas. Alternativa descartada: `skipSuccessfulRequests` de la librería, inexacta en ese caso.
- **CORS escrito a mano, un solo origen.** Son pocas líneas sin dependencia. Alternativa descartada: el paquete `cors`,
  cuyos valores por defecto reflejan orígenes.
- **`helmet` con sus valores por defecto.** Son suficientes para una API de JSON y fáciles de explicar. Alternativa
  descartada: ajustar cada política sin beneficio claro.
- **IP tras proxies por lista de confianza.** `TRUSTED_PROXIES` dice de quién se fía el servicio. Alternativas
  descartadas: `true` (cualquiera falsifica su IP), un número de saltos (depende de la topología) y el `trust proxy` de
  Express (su `req.ip` no sirve con reglas escritas y probadas).
- **Tope de la lista frente a paginación.** El tope protege al servidor sin cambiar el contrato ni el frontend.
  Alternativa descartada: paginación, que cambia la respuesta y obliga a rehacer el frontend.
- **Redis descartado.** Ver el punto h).

**Limitaciones conocidas de la API actual.**

- Seguridad: la API tiene key, cabeceras de `helmet`, límites por IP, bloqueo por intentos fallidos, CORS con un solo
  origen y tope de la lista. Aun así no debe exponerse a internet: no tiene HTTPS propio ni login de usuarios. La key
  autentica a la aplicación, no a las personas.
- Ventana fija en los cupos: en la frontera entre dos ventanas pueden pasar hasta el doble del cupo (2N).
- Los contadores (cupos y fallos) viven en la memoria de una sola instancia: se pierden al reiniciar y no se comparten
  entre instancias.
- Rotar `API_KEY` con el frontend sin reiniciar: la IP del frontend queda bloqueada hasta que termine la ventana (ver
  «Bloqueo por intentos fallidos»).
- Todos los usuarios del frontend comparten un solo cupo, porque el frontend nunca envía `X-Forwarded-For` (ver «Cupo
  compartido por diseño (desviación declarada)»).
- `GET /api/tasks` devuelve como máximo `TASKS_LIST_LIMIT` tareas (las más recientes, sin paginación) y no avisa de que
  la lista está truncada; la tabla puede seguir creciendo (ver «Tope de la lista»).
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
- HTTPS (terminación TLS) antes de exponer la API fuera de la red interna.
