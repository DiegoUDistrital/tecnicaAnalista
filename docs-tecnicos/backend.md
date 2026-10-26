# Backend: referencia técnica

[← README](../README.md)

## Backend

El paquete del backend usa TypeScript estricto, ESLint, Prettier y Vitest con cobertura mínima del 80 % (90 % en validación y rutas), y Prisma está
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
- `npm test`: tests con Vitest y cobertura (falla por debajo del 80 % global o del 90 % en validación y rutas).
- `npm run build`: compila a `backend/dist`.
- `npm start`: compila y arranca el servicio con el `.env` de la raíz (ver «Cómo ejecutar»).
- `npm run db:deploy`: aplica las migraciones y los permisos (ver «Migrar y aplicar permisos»).

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
