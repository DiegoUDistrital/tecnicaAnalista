# Frontend: referencia técnica

[← README](../README.md)

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
