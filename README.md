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
- PostgreSQL
- Next.js 15+ (App Router)
- Prisma
- TypeScript
- Tailwind CSS
- Vitest
- ESLint y Prettier
- Docker

## Estructura del repositorio

- `backend/`: paquete del backend con TypeScript; contiene Prisma (esquema y migraciones) y, en los siguientes PR, el servicio HTTP con Express.
- `frontend/`: aplicación Next.js con TypeScript y Tailwind (próximamente).
- `docker-compose.yml`: orquestación de los servicios (próximamente).
- `backend/queries.sql`: consultas SQL de la prueba (próximamente).

## Backend (estado actual)

Este PR deja el paquete del backend preparado (TypeScript estricto, ESLint, Prettier, Vitest con cobertura mínima del 95 %) y Prisma configurado para las migraciones. Express todavía NO está instalado: se añade en el siguiente PR (servicio HTTP). Se hace así para no incorporar dependencias sin uso. Hasta entonces no existe ningún servicio HTTP.

Comandos disponibles (dentro de `backend/`): `npm run lint`, `npm run format`, `npm run typecheck`, `npm test`, `npm run build`.

## Instalación

Pendiente: se documenta cuando existan los proyectos.

## Cómo ejecutar

Pendiente: se documenta cuando existan los proyectos.

## Pruebas

- Cobertura mínima del 95 % sobre el código propio (backend y frontend).
- Además de los tests se comprueban `lint` y `typecheck`.
- Comandos: pendiente, se documentan cuando existan los proyectos.

## Base de datos

Pendiente de implementar:

- Migración documentada del esquema de la tabla `tasks`.
- `queries.sql` con dos consultas escritas a mano: filtro por `completed` y conteo agrupado por estado.
- Índice sobre `completed`. Justificación honesta: con pocas filas aporta poco beneficio; se justifica por el patrón
  de consulta (casi todas las lecturas filtran por estado) y por el crecimiento esperado de la tabla.

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
red.

**g) Rate limiting.** Con `express-rate-limit` y valores configurables por variables de entorno, protege frente a
abuso y a intentos repetidos con una API key inválida. El contador está en memoria, por lo que solo es válido para
una instancia de Express.

**h) Redis descartado.** No hay un problema de carga que lo justifique y añade un servicio, una credencial y más
superficie de ataque. Se mide la necesidad antes de añadir infraestructura; el `Pool` y el índice cubren la carga
prevista. Queda como trabajo futuro.

**i) Login de usuarios fuera de alcance.** Un login a medias sería peor que ninguno: solo tendría sentido completo
(hash de contraseñas, expiración de tokens, protección CSRF). Queda como trabajo futuro.

**j) Riesgos residuales.** Hay dos credenciales de base de datos en la aplicación (`writer` y `reader`; el daño
posible con `reader` es muy limitado). Además hay dos caminos de lectura: los contadores vía Prisma y la lista vía
Express, que pueden diferir un instante tras una escritura; se resuelve refrescando tras cada acción.

**Nota sobre el historial.** El commit "backend setup con Express y Prisma" abre el backend: Prisma se usa allí para
el esquema y las migraciones, mientras que las consultas de la API se hacen con `pg` y `Pool`.

## Trabajo futuro

- Redis para caché y para un contador de rate limiting compartido entre varias instancias.
- Login de usuarios, implementado de forma completa.
