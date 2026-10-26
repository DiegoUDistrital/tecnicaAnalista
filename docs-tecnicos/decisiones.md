# Decisiones técnicas

[← README](../README.md)

## Detalle de las decisiones

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

## Límites de la implementación (detalle)

Lista completa de los límites que el README resume en «Riesgos residuales y limitaciones».

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
