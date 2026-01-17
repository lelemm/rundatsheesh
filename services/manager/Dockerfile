# syntax=docker/dockerfile:1
FROM node:20-bookworm AS ui-builder

WORKDIR /ui
COPY services/manager/admin-ui/package.json services/manager/admin-ui/package-lock.json ./
RUN npm ci
COPY services/manager/admin-ui/app ./app
COPY services/manager/admin-ui/components ./components
COPY services/manager/admin-ui/hooks ./hooks
COPY services/manager/admin-ui/lib ./lib
COPY services/manager/admin-ui/public ./public
COPY services/manager/admin-ui/styles ./styles
COPY services/manager/admin-ui/next.config.mjs ./next.config.mjs
COPY services/manager/admin-ui/postcss.config.mjs ./postcss.config.mjs
COPY services/manager/admin-ui/tsconfig.json ./tsconfig.json
RUN npm run build

FROM node:20-bookworm AS builder

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY services/manager/package.json services/manager/package-lock.json ./
RUN npm ci
COPY services/manager/tsconfig.json ./
COPY services/manager/src ./src
COPY services/manager/drizzle ./drizzle
COPY services/manager/drizzle.sqlite.config.ts services/manager/drizzle.pg.config.ts ./
# Work around sporadic V8/Turbofan crashes during TypeScript compilation in some environments.
RUN NODE_OPTIONS=--jitless npm run build
RUN npm prune --omit=dev
COPY --from=ui-builder /ui/out ./public/admin

FROM node:20-bookworm AS runtime

ARG FIRECRACKER_VERSION=1.7.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates curl iproute2 iptables nftables socat util-linux \
  && rm -rf /var/lib/apt/lists/*

# Dedicated unprivileged user/group for Firecracker when launched via jailer.
# Keep ids deterministic so volumes and chown behavior are stable across rebuilds.
RUN getent group 1234 >/dev/null || groupadd -g 1234 fc \
  && id -u fc >/dev/null 2>&1 || useradd -u 1234 -g 1234 -M -r -s /usr/sbin/nologin fc

RUN curl -L "https://github.com/firecracker-microvm/firecracker/releases/download/v${FIRECRACKER_VERSION}/firecracker-v${FIRECRACKER_VERSION}-x86_64.tgz" \
  | tar -xz -C /tmp \
  && mv /tmp/release-v${FIRECRACKER_VERSION}-x86_64/firecracker-v${FIRECRACKER_VERSION}-x86_64 /usr/local/bin/firecracker \
  && mv /tmp/release-v${FIRECRACKER_VERSION}-x86_64/jailer-v${FIRECRACKER_VERSION}-x86_64 /usr/local/bin/jailer \
  && chmod +x /usr/local/bin/firecracker /usr/local/bin/jailer

WORKDIR /app
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/public ./public

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_DIALECT=sqlite
ENV SQLITE_PATH=/var/lib/run-dat-sheesh/manager.db

RUN mkdir -p /run/fc /var/lib/run-dat-sheesh

EXPOSE 3000
CMD ["node", "dist/index.js"]
