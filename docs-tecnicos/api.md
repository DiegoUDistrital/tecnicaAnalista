# API de tareas

[← README](../README.md)

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
