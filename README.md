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
- `frontend/`: aplicación Next.js (App Router) con TypeScript y Tailwind. Hoy tiene la base del proyecto y una página provisional (ver «Frontend (estado actual)»).
- `docker-compose.dev.yml` y `docker/postgres/init/`: PostgreSQL de desarrollo y script de roles y bases.
- `docker-compose.yml`: orquestación de los servicios (próximamente).
- `backend/queries.sql`: consultas SQL de la prueba.

## Backend (estado actual)

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
de cada persona en el límite de peticiones (ver «Límite de peticiones»); este apartado explica cómo se obtiene y cómo
se configura.

- **Por qué hace falta.** El navegador no llama a Express: lo hace el servidor del frontend. Para Express, todas las
  peticiones vienen de ese servidor. Si el límite contara su IP, un solo usuario agotaría el cupo de todos. Por eso el
  frontend debe pasar la IP del usuario en `X-Forwarded-For` y Express debe leerla, pero solo cuando se puede creer.
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
- **Contrato para el frontend.** El servidor de Next debe escribir en `X-Forwarded-For` UNA sola IP: la dirección de su
  propio socket entrante (la de quien le llama, que el servidor ve en la conexión). Debe SOBRESCRIBIR cualquier valor que
  traiga el navegador: nunca copiarlo ni anteponerlo, porque un cliente podría falsificar su IP.
  Si Next estuviera detrás de otro proxy, su socket vería la IP de ese proxy; ese caso se decide al desplegar, no se
  resuelve copiando cabeceras.
- **Riesgo.** Si el frontend no envía la cabecera, o `TRUSTED_PROXIES` no incluye la red desde la que se conecta, todos
  los usuarios comparten una misma clave y un solo usuario podría agotar el cupo de todos.
- **Despliegue (pendiente).** Cuando el frontend y la API estén en Docker Compose, la red desde la que Next llama a
  Express debe figurar en `TRUSTED_PROXIES` como subred fija (IP/prefijo), no como `loopback`. Esa configuración se
  documentará con el despliegue.

## Límite de peticiones

El servicio limita cuántas peticiones puede hacer cada IP con la librería `express-rate-limit` 8.7.1. Hay dos cupos,
que se cuentan por separado y por la IP real del cliente (ver «IP real del cliente y proxies de confianza»):

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
- **Contador propio, síncrono y solo al emitir un `401`.** Es un contador de ventana fija por IP real (la misma ventana
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
  usuarios, que llegan por esa misma IP si el frontend no reenvía la suya, también quedan bloqueados. Por eso conviene
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

El frontend se documenta en «Frontend (estado actual)».

## Frontend (estado actual)

El frontend es una aplicación Next.js (App Router) con TypeScript estricto y Tailwind, en `frontend/`. Hoy ya tiene
la página principal con el filtro en la URL (`/?filter=completed|pending`) y los contadores de tareas, leídos en el
servidor con Prisma y el rol `reader` (ver «Contadores y Prisma en el frontend»). También tiene las rutas
`/api/tasks` y `/api/tasks/<id>`, que reenvían las peticiones a Express con la API key solo en el servidor (ver
«Rutas del servidor del frontend»). Aún no tiene la interfaz interactiva (lista, crear, completar, editar y borrar):
llega en una fase posterior. La configuración propia (ver «Configuración del frontend»), las cabeceras de
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
- `client/`: reservada para el código que corre en el navegador (aún no existe).

Fuera de `src`, `prisma/` y `prisma.config.ts` tienen el esquema y la configuración del CLI de Prisma. Solo `app/`,
`lib/`, `server/` y `generated/` existen hoy; el resto se crea cuando hace falta. Las importaciones son relativas (sin alias `@/`):
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
por evento en la salida de error (`process.stderr`), con `time`, `level` (siempre `error`) y `event`. Hoy lo usa la
configuración (`config_invalid`) y la lectura de contadores (`counters_failed`); las rutas lo usarán en tareas
posteriores.

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
  bloquea la IP del frontend durante la ventana de tiempo (15 minutos por defecto). Al rotarla, se reinician los dos
  procesos a la vez.
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
usuarios comparten un único cupo, porque el backend ve siempre la IP del servidor del frontend.

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
  La página (siguiente tarea) mostrará entonces «—» con un aviso. La consulta que pierde la carrera sigue en curso sin
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
- **Sin JavaScript** la página funciona (los filtros son enlaces normales); la lista de tareas llegará con la interfaz del cliente.

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
- **Client Component** (la lista interactiva): llegará con la interfaz del cliente; hablará con estas rutas.
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

- **Todavía no se envía `X-Forwarded-For`** (llegará con la integración, que enviará la IP real del socket
  sobrescribiendo, nunca copiando). Consecuencia: **el backend ve a todos los usuarios como un único cliente**, con un
  único cupo compartido de peticiones. En una demo con varias personas, súbanse los cupos del backend
  (`RATE_LIMIT_MAX` y `RATE_LIMIT_POST_MAX`, ver «Variables del servicio»).
- **Sin límite de peticiones propio en el frontend:** el límite por IP está en Express; duplicarlo aquí sin conocer la
  IP real no aportaría nada.
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
    comprobar que el servidor del frontend sigue sano. Pendiente de comprobar si `request.signal` se aborta al cortar la
    conexión; si no se aborta, es una limitación conocida y el plazo de 15 s sigue protegiendo.

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
  de la página y de las funciones puras de la interfaz, con Vitest en entorno Node (jsdom solo en las de componentes). Las reglas de ESLint propias (`react/no-danger`, las de
  `@next/next`, las de hooks y la prohibición de importar el servidor desde `src/client/`) se comprobaron una vez con
  archivos de ejemplo que deben fallar y que se borraron después.

## Base de datos

Ya implementado: migración documentada de la tabla `tasks` (ver «Esquema y migraciones»), `backend/queries.sql` con
dos consultas escritas a mano (filtro por `completed` y conteo agrupado por estado; ver «Consultas SQL») e índice
sobre `completed` (`tasks_completed_idx`). Justificación honesta del índice: con pocas filas aporta poco beneficio;
se justifica por el patrón de consulta (casi todas las lecturas filtran por estado) y por el crecimiento esperado
de la tabla.

## Despliegue en Ubuntu

Pendiente.

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

**g) Rate limiting.** Dos cupos por IP real (general y de `POST`) con `express-rate-limit`, ventana fija, almacén en
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
- **Límites por IP real.** Cada persona tiene su cupo y el frontend no consume el de todos. Alternativa descartada: contar
  la IP de la conexión, que para el frontend es siempre la misma.
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
- Hasta que el frontend envíe `X-Forwarded-For` (ver el contrato en «IP real del cliente y proxies de confianza»), todos
  los usuarios comparten un solo cupo.
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
