# syntax=docker/dockerfile:1

FROM oven/bun:1-debian AS build
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATABASE_PATH=/app/data/publisher.db

# curl para el healthcheck externo de Coolify (la imagen slim no lo trae)
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ffmpeg sqlite3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY package.json drizzle.config.ts tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY ops ./ops

RUN mkdir -p /app/data /deletion-ledger /backups /deletion-replica && chown -R node:node /app /deletion-ledger /backups /deletion-replica

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

# Migrations are an explicit, backed-up operator action.
CMD ["sh", "ops/entrypoint.sh"]
