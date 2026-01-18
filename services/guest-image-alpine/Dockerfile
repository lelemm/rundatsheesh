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

FROM debian:bookworm AS kernel-builder

ARG KERNEL_VERSION=5.10.210
ARG KERNEL_CONFIG_URL=https://raw.githubusercontent.com/firecracker-microvm/firecracker/main/resources/guest_configs/microvm-kernel-x86_64-5.10.config

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     build-essential bc bison flex libssl-dev libelf-dev \
     ca-certificates curl wget xz-utils \
     kmod cpio \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY services/guest-image/scripts/build-kernel.sh /usr/local/bin/build-kernel.sh
RUN chmod +x /usr/local/bin/build-kernel.sh \
  && KERNEL_VERSION="${KERNEL_VERSION}" KERNEL_CONFIG_URL="${KERNEL_CONFIG_URL}" /usr/local/bin/build-kernel.sh /build

FROM alpine:3.20 AS guest-image-builder

# Tools needed to assemble + shrink ext4
RUN apk add --no-cache \
  e2fsprogs e2fsprogs-extra \
  util-linux coreutils \
  build-base

WORKDIR /rootfs

# Populate an Alpine rootfs into /rootfs using apk's --root mode.
RUN set -eux; \
  apk add --no-cache --root /rootfs --initdb \
    --repositories-file /etc/apk/repositories \
    --keys-dir /etc/apk/keys \
    alpine-baselayout busybox \
    ca-certificates bash coreutils tar gzip unzip curl \
    iproute2 iptables nftables socat \
    busybox-static \
    nodejs npm \
    deno \
  ; \
  # Ensure apk leaves no cache inside the rootfs.
  rm -rf /rootfs/var/cache/apk/* || true

# Minimal init (PID1), compiled for Alpine (musl); static so it doesn't depend on shared libs in the rootfs.
COPY services/guest-image/init/guest-init.c /tmp/guest-init.c
RUN gcc -O2 -static -o /rootfs/sbin/init /tmp/guest-init.c \
  && chmod +x /rootfs/sbin/init \
  && rm -f /tmp/guest-init.c

# Create runtime layout + untrusted user confinement under /home/user
RUN set -eux; \
  mkdir -p /rootfs/home/user /rootfs/opt/guest-agent /rootfs/home/user/.deno /rootfs/home/user/.tmp; \
  # Create user/group deterministically (uid/gid 1000). Alpine uses busybox adduser/addgroup.
  chroot /rootfs /bin/sh -c 'addgroup -g 1000 user || true; adduser -D -u 1000 -G user -s /bin/bash user || true; passwd -l root || true'; \
  # Confined toolchain under /home/user (static busybox)
  mkdir -p /rootfs/home/user/bin /rootfs/home/user/dev /rootfs/home/user/tmp; \
  bb_src=""; \
  for cand in /rootfs/bin/busybox.static /rootfs/bin/busybox /rootfs/usr/bin/busybox /rootfs/usr/sbin/busybox; do \
    if [ -x "$cand" ]; then bb_src="$cand"; break; fi; \
  done; \
  if [ -z "$bb_src" ]; then \
    echo "busybox binary not found in rootfs; expected busybox-static to install one of: /bin/busybox.static, /bin/busybox, /usr/bin/busybox"; \
    ls -la /rootfs/bin || true; \
    ls -la /rootfs/usr/bin || true; \
    exit 1; \
  fi; \
  cp "$bb_src" /rootfs/home/user/bin/busybox; \
  chmod 0755 /rootfs/home/user/bin/busybox; \
  # IMPORTANT: the guest-agent later does `chroot --userspec=1000:1000 /home/user /bin/busybox sh -c ...`
  # so all applet symlinks must be valid *within* that chroot. If we install symlinks that point to
  # `/home/user/bin/busybox`, they will break after chrooting (it would resolve to /home/user/home/user/...).
  # Install inside a chroot rooted at /home/user so symlinks target `/bin/busybox` (valid inside the confinement).
  chroot /rootfs/home/user /bin/busybox --install -s /bin; \
  # Device nodes inside the /home/user chroot
  mknod -m 666 /rootfs/home/user/dev/null c 1 3 || true; \
  mknod -m 666 /rootfs/home/user/dev/zero c 1 5 || true; \
  mknod -m 666 /rootfs/home/user/dev/random c 1 8 || true; \
  mknod -m 666 /rootfs/home/user/dev/urandom c 1 9 || true; \
  chown -R 1000:1000 /rootfs/home/user

# Ensure paths expected by guest-init + guest-agent exist
RUN set -eux; \
  mkdir -p /rootfs/usr/local/bin; \
  if [ ! -e /rootfs/usr/local/bin/node ]; then ln -s /usr/bin/node /rootfs/usr/local/bin/node; fi; \
  mkdir -p /rootfs/home/user/.deno/bin; \
  if [ ! -e /rootfs/home/user/.deno/bin/deno ]; then ln -s /usr/bin/deno /rootfs/home/user/.deno/bin/deno; fi; \
  chown -R 1000:1000 /rootfs/home/user/.deno

# Guest agent runtime (ESM + dependencies)
COPY --from=guest-agent-builder /src/package.json /rootfs/opt/guest-agent/package.json
COPY --from=guest-agent-builder /src/package-lock.json /rootfs/opt/guest-agent/package-lock.json
COPY --from=guest-agent-builder /src/node_modules /rootfs/opt/guest-agent/node_modules
COPY --from=guest-agent-builder /src/dist /rootfs/opt/guest-agent/dist

# Build ext4 from directory tree then shrink to minimum so we don't ship empty space.
RUN set -eux; \
  truncate -s 1G /rootfs.ext4; \
  mke2fs -t ext4 -F -d /rootfs /rootfs.ext4; \
  e2fsck -pf /rootfs.ext4 || true; \
  resize2fs -M /rootfs.ext4; \
  e2fsck -pf /rootfs.ext4 || true; \
  blocks="$(dumpe2fs -h /rootfs.ext4 2>/dev/null | awk -F: '/Block count/ { gsub(/ /,"",$2); print $2 }')"; \
  bsize="$(dumpe2fs -h /rootfs.ext4 2>/dev/null | awk -F: '/Block size/ { gsub(/ /,"",$2); print $2 }')"; \
  if [ -n "$blocks" ] && [ -n "$bsize" ]; then \
    truncate -s "$((blocks * bsize))" /rootfs.ext4; \
  fi

RUN mkdir -p /out \
  && cp /rootfs.ext4 /out/rootfs.ext4

COPY --from=kernel-builder /build/linux-*/vmlinux /out/vmlinux

FROM scratch AS export
COPY --from=guest-image-builder /out /out

