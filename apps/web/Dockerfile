# @iot/web — Next.js 14 dashboard (login + realtime + ECharts + command panel).
#
# Build with the repo ROOT as the context (monorepo workspaces):
#   docker build -f apps/web/Dockerfile .
#
# NEXT_PUBLIC_* are baked into the CLIENT bundle at BUILD time (not read from
# process.env at runtime), so they MUST be passed as build ARGs. Defaults are
# local-dev; for prod, pass the Cloudflare Tunnel public URLs:
#   docker build --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
#                --build-arg NEXT_PUBLIC_WS_URL=https://realtime.example.com \
#                -f apps/web/Dockerfile .

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
# Client-facing URLs baked into the bundle. (NEXT_PUBLIC_* = client-side.)
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ARG NEXT_PUBLIC_WS_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/
RUN npm run build -w @iot/shared \
 && npm run build -w @iot/web

# ---- runtime --------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/consumer/package.json apps/consumer/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev
COPY --from=build /repo/apps/web/.next apps/web/.next
# `next start` needs the Next.js metadata manifest.
COPY --from=build /repo/apps/web/next.config.mjs apps/web/
# Non-root (Spec §14). `useradd` lives in Alpine's `shadow` package (not in the
# node base image), so install it just to create the user.
RUN apk add --no-cache shadow \
 && useradd -u 10001 -r iot \
 && chown -R iot:iot /repo
USER iot
WORKDIR /repo/apps/web
EXPOSE 3002
CMD ["npx", "next", "start", "-p", "3002"]
