# syntax=docker/dockerfile:1
FROM node:20-bookworm AS builder

WORKDIR /app
COPY services/manager/package.json services/manager/package-lock.json ./
RUN npm ci
COPY services/manager/tsconfig.json ./
COPY services/manager/src ./src
# Work around sporadic V8/Turbofan crashes during TypeScript compilation in some environments.
RUN NODE_OPTIONS=--jitless npm run build

FROM node:20-bookworm AS runtime

ARG FIRECRACKER_VERSION=1.7.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates curl iproute2 iptables nftables socat util-linux \
  && rm -rf /var/lib/apt/lists/*

RUN curl -L "https://github.com/firecracker-microvm/firecracker/releases/download/v${FIRECRACKER_VERSION}/firecracker-v${FIRECRACKER_VERSION}-x86_64.tgz" \
  | tar -xz -C /tmp \
  && mv /tmp/release-v${FIRECRACKER_VERSION}-x86_64/firecracker-v${FIRECRACKER_VERSION}-x86_64 /usr/local/bin/firecracker \
  && mv /tmp/release-v${FIRECRACKER_VERSION}-x86_64/jailer-v${FIRECRACKER_VERSION}-x86_64 /usr/local/bin/jailer \
  && chmod +x /usr/local/bin/firecracker /usr/local/bin/jailer

WORKDIR /app
COPY services/manager/package.json services/manager/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3000

RUN mkdir -p /run/fc /var/lib/run-dat-sheesh

EXPOSE 3000
CMD ["node", "dist/index.js"]
