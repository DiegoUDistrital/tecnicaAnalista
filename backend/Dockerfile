# Imagen del backend en varias etapas. Compose elige la etapa final con `target` (runtime o migrate).

# Dependencias completas (con las de desarrollo: TypeScript y la herramienta de Prisma).
FROM node:26.1.0-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Compilación de TypeScript a dist/.
FROM node:26.1.0-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Solo las dependencias de ejecución.
FROM node:26.1.0-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Servicio en ejecución: solo lo que carga `node dist/index.js`.
FROM node:26.1.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --chown=10001:10001 package.json ./
USER 10001:10001
CMD ["node", "dist/index.js"]

# Tarea de un solo uso: migra y concede permisos con el rol owner. Es la excepción: lleva la herramienta de Prisma.
FROM node:26.1.0-bookworm-slim AS migrate
WORKDIR /app
COPY --from=deps --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --chown=10001:10001 package.json prisma.config.ts ./
COPY --chown=10001:10001 prisma ./prisma
USER 10001:10001
CMD ["node", "dist/db/migrate-cli.js"]
