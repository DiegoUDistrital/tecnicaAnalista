# Imagen del frontend en varias etapas: dependencias, compilación y servidor independiente de Next (standalone).

# Dependencias completas. `npm ci` ejecuta `prisma generate` (postinstall), por eso se copia antes `prisma/`.
FROM node:26.1.0-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# Compilación. No recibe ninguna variable de ejecución: los secretos no deben quedar en la imagen.
FROM node:26.1.0-bookworm-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/src/generated ./src/generated
COPY package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs prisma.config.ts ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src
RUN npm run verify:build
RUN npm run build

# Servicio en ejecución: solo el servidor independiente y los archivos estáticos.
FROM node:26.1.0-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=10001:10001 /app/.next/standalone ./
COPY --from=build --chown=10001:10001 /app/.next/static ./.next/static
RUN mkdir -p .next/cache && chown 10001:10001 .next/cache
USER 10001:10001
CMD ["node", "server.js"]
