# @iot/api — NestJS API + Prisma + MQTT downlink.
#
# Build with the repo ROOT as the context (monorepo workspaces):
#   docker build -f apps/api/Dockerfile .
# (docker-compose sets `context: .` and `dockerfile: apps/api/Dockerfile`.)
#
# Final image is minimal: node + the built dist + the @iot/shared build output
# + the runtime node_modules + the generated Prisma client. No source, no
# TypeScript, no dev deps, no .env (secrets come from compose at runtime).

FROM node:22-alpine AS base
WORKDIR /repo

# ---- install --------------------------------------------------------------
FROM base AS install
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/consumer/package.json apps/consumer/
COPY apps/web/package.json apps/web/
# Dev deps (TypeScript, Prisma CLI, ts-node) are needed to BUILD, so a full
# install here; the final stage re-installs prod-only to drop them.
RUN npm ci

# ---- build ----------------------------------------------------------------
FROM install AS build
# Prisma `generate` (and the api's `build` script) read DATABASE_URL from the
# env at BUILD time even though the client only connects at RUNTIME. A
# placeholder is enough here — the real URL is injected by compose.
ARG DATABASE_URL=postgresql://build:***@localhost:5432/unused
ENV DATABASE_URL=$DATABASE_URL
# Build shared first (api imports @iot/shared from its dist), then the api.
# api's build script = `prisma generate && tsc -p tsconfig.json`.
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/
RUN npm run build -w @iot/shared \
 && npm run build -w @iot/api

# ---- runtime --------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
# `prisma generate` (below) reads DATABASE_URL even though the client only
# connects at runtime; a placeholder is fine — compose injects the real one.
ARG DATABASE_URL=postgresql://build:***@localhost:5432/unused
ENV DATABASE_URL=$DATABASE_URL
# Copy the lock + manifests so `npm ci --omit=dev` resolves the SAME versions
# as the build stage.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/consumer/package.json apps/consumer/
COPY apps/web/package.json apps/web/
# Prod-only install across all workspaces (devDeps / TypeScript / CLI dropped).
RUN npm ci --omit=dev
# Artifacts the api needs at runtime:
#  - dist (compiled api)
#  - packages/shared/dist (the @iot/shared build output; workspace link resolves
#    to packages/shared, whose package.json main points at dist/)
#  - prisma (the schema + migrations dir for `migrate deploy`)
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/prisma apps/api/prisma
# The Prisma CLI picks its schema-engine build by probing the system OpenSSL
# (the `openssl` binary). node:22-alpine ships neither that binary nor a
# system libssl, so detection falls back to "openssl-1.1.x" and the engine
# binary cannot load (Alpine 3.24 has only libssl.so.3) — `migrate deploy`
# then crashes at boot and the container restart-loops. Install the base
# image's OpenSSL 3 package BEFORE generate so both this step and the
# boot-time `migrate deploy` resolve the OpenSSL-3 engine.
RUN apk add --no-cache openssl
# The Prisma client is generated into node_modules/.prisma/client — which the
# fresh `npm ci --omit=dev` above does NOT create (it ships no generated
# client). Regenerate it here from the copied schema, as the root user (the
# engine writes into node_modules), BEFORE switching to the non-root user.
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
# Non-root (Spec §14). `useradd` lives in Alpine's `shadow` package (not in the
# node base image), so install it just to create the user.
RUN apk add --no-cache shadow \
 && useradd -u 10001 -r iot \
 && chown -R iot:iot /repo
USER iot
WORKDIR /repo/apps/api
EXPOSE 3000
# Migrations run at boot (idempotent `migrate deploy`), then the app starts.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
