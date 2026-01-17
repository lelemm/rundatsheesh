# syntax=docker/dockerfile:1
FROM node:20-bookworm AS guest-agent-builder

WORKDIR /src
COPY services/guest-agent/package.json services/guest-agent/package-lock.json ./
RUN npm ci
COPY services/guest-agent/tsconfig.json ./
COPY services/guest-agent/src ./src
# Work around sporadic V8/Turbofan crashes during TypeScript compilation in some environments.
RUN NODE_OPTIONS=--jitless npm run build
# Keep only runtime deps for the guest image.
RUN npm prune --omit=dev

FROM debian:bookworm AS guest-image-builder

ARG KERNEL_VERSION=5.10.210
ARG KERNEL_CONFIG_URL=https://raw.githubusercontent.com/firecracker-microvm/firecracker/main/resources/guest_configs/microvm-kernel-x86_64-5.10.config
ARG NODE_VERSION=20.11.1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     build-essential bc bison flex libssl-dev libelf-dev \
     ca-certificates curl wget xz-utils \
     debootstrap e2fsprogs kmod cpio \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY services/guest-image/scripts/build-kernel.sh /usr/local/bin/build-kernel.sh
RUN chmod +x /usr/local/bin/build-kernel.sh \
  && KERNEL_VERSION="${KERNEL_VERSION}" KERNEL_CONFIG_URL="${KERNEL_CONFIG_URL}" /usr/local/bin/build-kernel.sh /build

# Build rootfs
WORKDIR /rootfs
ARG DEBIAN_MIRROR=https://deb.debian.org/debian
ARG DEBIAN_SUITE=bookworm
COPY services/guest-image/scripts/build-rootfs.sh /usr/local/bin/build-rootfs.sh
RUN chmod +x /usr/local/bin/build-rootfs.sh \
  && DEBIAN_MIRROR="${DEBIAN_MIRROR}" DEBIAN_SUITE="${DEBIAN_SUITE}" NODE_VERSION="${NODE_VERSION}" /usr/local/bin/build-rootfs.sh /rootfs

# Guest agent runtime (ESM + dependencies)
COPY --from=guest-agent-builder /src/package.json /rootfs/opt/guest-agent/package.json
COPY --from=guest-agent-builder /src/package-lock.json /rootfs/opt/guest-agent/package-lock.json
COPY --from=guest-agent-builder /src/node_modules /rootfs/opt/guest-agent/node_modules
COPY --from=guest-agent-builder /src/dist /rootfs/opt/guest-agent/dist

# Rootfs overlay for small static files (kept intentionally minimal).
COPY services/guest-image/rootfs-overlay/ /rootfs/

# Provide a small binary init (PID1). Some minimal kernels may not support script init (/sbin/init).
COPY services/guest-image/init/guest-init.c /tmp/guest-init.c
RUN gcc -O2 -o /rootfs/sbin/init /tmp/guest-init.c \
  && chmod +x /rootfs/sbin/init \
  && rm -f /tmp/guest-init.c

RUN truncate -s 2G /rootfs.ext4 \
  && mke2fs -t ext4 -F -d /rootfs /rootfs.ext4

RUN mkdir -p /out \
  && cp /build/linux-${KERNEL_VERSION}/vmlinux /out/vmlinux \
  && cp /rootfs.ext4 /out/rootfs.ext4

FROM scratch AS export
COPY --from=guest-image-builder /out /out
