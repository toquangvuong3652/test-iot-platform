# @iot/consumer — MQTT uplink consumer + socket.io realtime gateway + Prisma.
#
# Build with the repo ROOT as the context (monorepo workspaces):
#   docker build -f apps/consumer/Dockerfile .
# (docker-compose sets `context: .` and `dockerfile: apps/consumer/Dockerfile`.)
#
# Same minimal final image as the api: node + built dist + @iot/shared build
# output + runtime node_modules + generated Prisma client. No source / dev deps.

FROM node:22-alpine AS base
WORKDIR /repo

# ---- install --------------------------------------------------------------
FROM base AS install
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/consumer/package.json apps/consumer/
COPY apps/web/package.json apps/web/
RUN npm ci

# ---- build ----------------------------------------------------------------
FROM install AS build
# Prisma `generate` needs a DATABASE_URL in the build env (runtime connects
# with the real one from compose). Placeholder is fine here.
ARG DATABASE_URL=postgresql://build:***@localhost:5432/unused
ENV DATABASE_URL=$DATABASE_URL
COPY packages/shared/ packages/shared/
COPY apps/consumer/ apps/consumer/
# The api's prisma dir (schema + migrations) is the single source of truth for
# the Prisma client both apps share; copied here so the runtime stage can
# `prisma generate` from it.
COPY apps/api/prisma apps/api/prisma
RUN npm run build -w @iot/shared \
 && npm run build -w @iot/consumer

# ---- runtime --------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
# `prisma generate` (below) reads DATABASE_URL even though the client only
# connects at runtime; a placeholder is fine — compose injects the real one.
ARG DATABASE_URL=postgresql://build:***@localhost:5432/unused
ENV DATABASE_URL=$DATABASE_URL
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/consumer/package.json apps/consumer/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev
COPY --from=build /repo/apps/consumer/dist apps/consumer/dist
COPY --from=build /repo/packages/shared/dist packages/shared/dist
# The consumer writes telemetry via the Prisma client, generated from the api's
# schema (the single source of truth). The fresh `npm ci --omit=dev` above does
# NOT create node_modules/.prisma/client, so regenerate it here from the copied
# schema, as root, BEFORE switching to the non-root user.
COPY --from=build /repo/apps/api/prisma apps/api/prisma
RUN apk add --no-cache openssl
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
# Non-root (Spec §14). `useradd` lives in Alpine's `shadow` package (not in the
# node base image), so install it just to create the user.
RUN apk add --no-cache shadow \
 && useradd -u 10001 -r iot \
 && chown -R iot:iot /repo
USER iot
WORKDIR /repo/apps/consumer
EXPOSE 3001
CMD ["node", "dist/main.js"]
