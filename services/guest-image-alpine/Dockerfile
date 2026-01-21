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

# Shell variant: "busybox" (default, more confined) or "bash" (NVM support)
ARG SHELL_VARIANT=busybox

# Tools needed to assemble + shrink ext4
RUN apk add --no-cache \
  e2fsprogs e2fsprogs-extra \
  util-linux coreutils \
  build-base \
  curl

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
    git \
    musl-utils \
    gcompat libucontext libatomic \
  ; \
  # Ensure apk leaves no cache inside the rootfs.
  rm -rf /rootfs/var/cache/apk/* || true

# Minimal init (PID1), compiled for Alpine (musl); static so it doesn't depend on shared libs in the rootfs.
# Pass SHELL_VARIANT at compile time so guest-init sets JAIL_SHELL env var for guest-agent.
COPY services/guest-image/init/guest-init.c /tmp/guest-init.c
ARG SHELL_VARIANT
RUN gcc -O2 -static -DSHELL_VARIANT=\"${SHELL_VARIANT}\" -o /rootfs/sbin/init /tmp/guest-init.c \
  && chmod +x /rootfs/sbin/init \
  && rm -f /tmp/guest-init.c

# Create runtime layout + untrusted user directory at /home/user (workspace)
# Sandbox shell setup depends on SHELL_VARIANT: busybox (default) or bash (with GNU coreutils)
ARG SHELL_VARIANT
RUN set -eux; \
  mkdir -p /rootfs/home/user /rootfs/opt/guest-agent /rootfs/home/user/.deno /rootfs/home/user/.tmp; \
  # Create user/group deterministically (uid/gid 1000). Alpine uses busybox adduser/addgroup.
  chroot /rootfs /bin/sh -c 'addgroup -g 1000 user || true; adduser -D -u 1000 -G user -s /bin/bash user || true; passwd -l root || true'; \
  # Confined toolchain under /opt/sandbox
  mkdir -p /rootfs/opt/sandbox/bin /rootfs/opt/sandbox/dev /rootfs/opt/sandbox/tmp; \
  mkdir -p /rootfs/opt/sandbox/usr/bin /rootfs/opt/sandbox/etc/ssl/certs; \
  mkdir -p /rootfs/opt/sandbox/home/user /rootfs/opt/sandbox/workspace; \
  # Device nodes inside the /opt/sandbox chroot (needed for both variants)
  mknod -m 666 /rootfs/opt/sandbox/dev/null c 1 3 || true; \
  mknod -m 666 /rootfs/opt/sandbox/dev/zero c 1 5 || true; \
  mknod -m 666 /rootfs/opt/sandbox/dev/random c 1 8 || true; \
  mknod -m 666 /rootfs/opt/sandbox/dev/urandom c 1 9 || true; \
  # Shell variant: busybox (static busybox with applet symlinks)
  if [ "$SHELL_VARIANT" != "bash" ]; then \
    echo "[busybox] Setting up BusyBox sandbox..."; \
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
    cp "$bb_src" /rootfs/opt/sandbox/bin/busybox; \
    chmod 0755 /rootfs/opt/sandbox/bin/busybox; \
    # IMPORTANT: the guest-agent does `chroot --userspec=1000:1000 /opt/sandbox /bin/busybox sh -c ...`
    # so all applet symlinks must be valid *within* that chroot. Install inside a chroot rooted at /opt/sandbox
    # so symlinks target `/bin/busybox` (valid inside the confinement).
    chroot /rootfs/opt/sandbox /bin/busybox --install -s /bin; \
    echo "[busybox] BusyBox sandbox ready"; \
  fi; \
  # Shell variant: bash (bash + GNU coreutils, no busybox)
  if [ "$SHELL_VARIANT" = "bash" ]; then \
    echo "[bash] Setting up Bash + GNU coreutils sandbox..."; \
    stage_ldd() { \
      target="$1"; \
      chroot /rootfs /usr/bin/ldd "$target" 2>/dev/null | awk '{ for (i=1;i<=NF;i++) if (substr($i,1,1)=="/") print $i }' | while read -r dep; do \
        if [ -e "/rootfs$dep" ]; then \
          mkdir -p "/rootfs/opt/sandbox$(dirname "$dep")"; \
          cp -aL "/rootfs$dep" "/rootfs/opt/sandbox$dep"; \
        fi; \
      done; \
    }; \
    # Stage a command: resolve symlink, copy binary, stage deps
    stage_cmd() { \
      cmd="$1"; \
      for path in /rootfs/usr/bin/$cmd /rootfs/bin/$cmd; do \
        if [ -e "$path" ]; then \
          real_path=$(chroot /rootfs readlink -f "${path#/rootfs}"); \
          dest="/rootfs/opt/sandbox${path#/rootfs}"; \
          mkdir -p "$(dirname "$dest")"; \
          cp -aL "/rootfs$real_path" "$dest"; \
          stage_ldd "$real_path"; \
          echo "[bash]   staged: $cmd -> $real_path"; \
          return 0; \
        fi; \
      done; \
      echo "[bash]   warning: $cmd not found"; \
      return 1; \
    }; \
    # Stage bash
    cp -aL /rootfs/bin/bash /rootfs/opt/sandbox/bin/bash; \
    stage_ldd /bin/bash; \
    # Create /bin/sh symlink to bash
    ln -sf bash /rootfs/opt/sandbox/bin/sh; \
    # Stage GNU coreutils - all essential commands for NVM and general use
    for cmd in ls head tail sort cut tr dirname basename wc cat tee mkdir rm mv cp chmod chown ln readlink mktemp sleep date touch env id whoami uname expr seq test printf echo true false yes xargs find; do \
      stage_cmd "$cmd" || true; \
    done; \
    # Stage grep, sed, awk - text processing
    for cmd in grep sed awk gawk; do \
      stage_cmd "$cmd" || true; \
    done; \
    # Stage compression tools (required for tar -z/-j operations)
    for cmd in gzip gunzip zcat bzip2 bunzip2 xz unxz; do \
      stage_cmd "$cmd" || true; \
    done; \
    # Stage curl and wget for downloads
    for cmd in curl wget; do \
      stage_cmd "$cmd" || true; \
    done; \
    # Stage gcompat (glibc compatibility layer) for NVM-installed Node.js binaries
    # NVM downloads glibc-based Node.js binaries which need /lib/ld-linux-x86-64.so.2
    if [ -e /rootfs/lib/ld-linux-x86-64.so.2 ]; then \
      mkdir -p /rootfs/opt/sandbox/lib /rootfs/opt/sandbox/lib64; \
      cp -aL /rootfs/lib/ld-linux-x86-64.so.2 /rootfs/opt/sandbox/lib/ld-linux-x86-64.so.2; \
      ln -sf ../lib/ld-linux-x86-64.so.2 /rootfs/opt/sandbox/lib64/ld-linux-x86-64.so.2; \
      echo "[bash]   staged: ld-linux-x86-64.so.2 (glibc loader shim)"; \
    fi; \
    # Stage libgcompat.so and its symlinks (libc.so.6, libcrypt.so.1, etc.)
    for lib in /rootfs/lib/libgcompat.so*; do \
      if [ -e "$lib" ]; then \
        cp -aL "$lib" "/rootfs/opt/sandbox/lib/$(basename "$lib")"; \
        echo "[bash]   staged: $(basename "$lib")"; \
      fi; \
    done; \
    # Stage glibc compat symlinks (libc.so.6 -> libgcompat.so.0, etc.)
    for link in libc.so.6 libcrypt.so.1 libpthread.so.0 librt.so.1 libm.so.6 libdl.so.2; do \
      if [ -L "/rootfs/lib/$link" ]; then \
        cp -a "/rootfs/lib/$link" "/rootfs/opt/sandbox/lib/$link"; \
        echo "[bash]   staged: $link (gcompat symlink)"; \
      fi; \
    done; \
    # Stage libobstack (required by some glibc programs)
    for lib in /rootfs/usr/lib/libobstack.so*; do \
      if [ -e "$lib" ]; then \
        mkdir -p /rootfs/opt/sandbox/usr/lib; \
        cp -aL "$lib" "/rootfs/opt/sandbox/usr/lib/$(basename "$lib")"; \
        echo "[bash]   staged: $(basename "$lib")"; \
      fi; \
    done; \
    # Stage libucontext (required by gcompat for setcontext/makecontext)
    for lib in /rootfs/usr/lib/libucontext.so*; do \
      if [ -e "$lib" ]; then \
        cp -aL "$lib" "/rootfs/opt/sandbox/usr/lib/$(basename "$lib")"; \
        echo "[bash]   staged: $(basename "$lib")"; \
      fi; \
    done; \
    # Also check /lib for libucontext
    for lib in /rootfs/lib/libucontext.so*; do \
      if [ -e "$lib" ]; then \
        cp -aL "$lib" "/rootfs/opt/sandbox/lib/$(basename "$lib")"; \
        echo "[bash]   staged: $(basename "$lib") (from /lib)"; \
      fi; \
    done; \
    # Stage libatomic (required by Node.js for atomic operations)
    for lib in /rootfs/usr/lib/libatomic.so*; do \
      if [ -e "$lib" ]; then \
        cp -aL "$lib" "/rootfs/opt/sandbox/usr/lib/$(basename "$lib")"; \
        echo "[bash]   staged: $(basename "$lib")"; \
      fi; \
    done; \
    chown -R 1000:1000 /rootfs/opt/sandbox/bin /rootfs/opt/sandbox/usr/bin /rootfs/opt/sandbox/lib /rootfs/opt/sandbox/lib64 /rootfs/opt/sandbox/usr/lib 2>/dev/null || true; \
    echo "[bash] Bash sandbox ready"; \
  fi; \
  chown -R 1000:1000 /rootfs/home/user

# Ensure paths expected by guest-init + guest-agent exist
RUN set -eux; \
  mkdir -p /rootfs/usr/local/bin; \
  if [ ! -e /rootfs/usr/local/bin/node ]; then ln -s /usr/bin/node /rootfs/usr/local/bin/node; fi; \
  mkdir -p /rootfs/home/user/.deno/bin; \
  if [ ! -e /rootfs/home/user/.deno/bin/deno ]; then ln -s /usr/bin/deno /rootfs/home/user/.deno/bin/deno; fi; \
  chown -R 1000:1000 /rootfs/home/user/.deno

# For bash variant: install NVM to a fixed location in the sandbox
# NOTE: /home/user inside the sandbox is bind-mounted from the real /home/user at runtime,
# so we can't put NVM or .bashrc there in the image. Instead:
# - NVM scripts go to /opt/sandbox/opt/nvm (persistent in image)
# - NVM_DIR is set to /workspace/.nvm (so installed versions persist in /home/user/.nvm)
# - .bashrc goes to /opt/sandbox/etc/skel/.bashrc (sourced by jail.ts)
ARG SHELL_VARIANT
RUN set -eux; \
  if [ "$SHELL_VARIANT" = "bash" ]; then \
    echo "[bash] Installing NVM for bash variant..."; \
    # Download and extract NVM to /opt/sandbox/opt/nvm (fixed location in image)
    NVM_VERSION="v0.40.1"; \
    mkdir -p /rootfs/opt/sandbox/opt/nvm; \
    curl -L "https://github.com/nvm-sh/nvm/archive/refs/tags/${NVM_VERSION}.tar.gz" | \
      tar -xz -C /rootfs/opt/sandbox/opt/nvm --strip-components=1; \
    chown -R 1000:1000 /rootfs/opt/sandbox/opt/nvm; \
    # Create .bashrc at /opt/sandbox/etc/skel/.bashrc (sourced by jail.ts for bash variant)
    # NVM_DIR=/workspace/.nvm ensures installed Node versions persist across exec calls
    # (since /workspace is bind-mounted from the real /home/user)
    mkdir -p /rootfs/opt/sandbox/etc/skel; \
    printf '%s\n' \
      'export NVM_DIR="/workspace/.nvm"' \
      '[ -s "/opt/nvm/nvm.sh" ] && . "/opt/nvm/nvm.sh"' \
      > /rootfs/opt/sandbox/etc/skel/.bashrc; \
    chmod 644 /rootfs/opt/sandbox/etc/skel/.bashrc; \
    echo "[bash] NVM installed successfully at /opt/nvm, NVM_DIR=/workspace/.nvm"; \
  fi

# Stage git into /opt/sandbox so `exec` (which chroots to /opt/sandbox) can run it.
RUN set -eux; \
  if [ -x /rootfs/usr/bin/git ]; then \
    mkdir -p /rootfs/opt/sandbox/usr/bin; \
    cp -a /rootfs/usr/bin/git /rootfs/opt/sandbox/usr/bin/git; \
    execPath="$(chroot /rootfs /usr/bin/git --exec-path)"; \
    if [ -n "$execPath" ] && [ -d "/rootfs${execPath}" ]; then \
      mkdir -p "/rootfs/opt/sandbox${execPath}"; \
      cp -a "/rootfs${execPath}/." "/rootfs/opt/sandbox${execPath}/"; \
    fi; \
    if [ -d /rootfs/usr/share/git-core ]; then \
      mkdir -p /rootfs/opt/sandbox/usr/share/git-core; \
      cp -a /rootfs/usr/share/git-core/. /rootfs/opt/sandbox/usr/share/git-core/; \
    fi; \
    if [ -f /rootfs/etc/ssl/certs/ca-certificates.crt ]; then \
      mkdir -p /rootfs/opt/sandbox/etc/ssl/certs; \
      cp -a /rootfs/etc/ssl/certs/ca-certificates.crt /rootfs/opt/sandbox/etc/ssl/certs/ca-certificates.crt; \
    fi; \
    # Some libcurl builds look for /etc/ssl/cert.pem (Alpine-style). Provide it inside the sandbox.
    if [ -f /rootfs/opt/sandbox/etc/ssl/certs/ca-certificates.crt ]; then \
      mkdir -p /rootfs/opt/sandbox/etc/ssl; \
      ln -sfn /etc/ssl/certs/ca-certificates.crt /rootfs/opt/sandbox/etc/ssl/cert.pem; \
    fi; \
    # Also provide it in the main rootfs for non-chrooted tooling.
    if [ -f /rootfs/etc/ssl/certs/ca-certificates.crt ]; then \
      mkdir -p /rootfs/etc/ssl; \
      ln -sfn /etc/ssl/certs/ca-certificates.crt /rootfs/etc/ssl/cert.pem; \
    fi; \
    stage_ldd() { \
      target="$1"; \
      chroot /rootfs /usr/bin/ldd "$target" 2>/dev/null | awk '{ for (i=1;i<=NF;i++) if (substr($i,1,1)=="/") print $i }' | while read -r dep; do \
        if [ -e "/rootfs$dep" ]; then \
          mkdir -p "/rootfs/opt/sandbox$(dirname "$dep")"; \
          # Follow symlinks so the sandbox contains real loader/libs (e.g. /lib/ld-musl-*.so.1 is a symlink on some builds).
          cp -aL "/rootfs$dep" "/rootfs/opt/sandbox$dep"; \
        fi; \
      done; \
    }; \
    stage_ldd /usr/bin/git; \
    if [ -n "${execPath:-}" ] && [ -d "/rootfs${execPath}" ]; then \
      find "/rootfs${execPath}" -maxdepth 1 -type f -perm -111 2>/dev/null | sed 's|^/rootfs||' | while read -r helper; do \
        stage_ldd "$helper"; \
      done; \
    fi; \
    # Keep ownership consistent with the rest of /home/user (exec runs as uid/gid 1000).
    chown -R 1000:1000 /rootfs/opt/sandbox/usr /rootfs/opt/sandbox/etc 2>/dev/null || true; \
  fi

# Stage node + npm into /opt/sandbox so `/exec` can run `npm install` (offline installs still need npm).
RUN set -eux; \
  if [ -x /rootfs/usr/bin/node ]; then \
    mkdir -p /rootfs/opt/sandbox/usr/bin /rootfs/opt/sandbox/usr/lib /rootfs/opt/sandbox/usr/share; \
    cp -a /rootfs/usr/bin/node /rootfs/opt/sandbox/usr/bin/node; \
    if [ -e /rootfs/usr/bin/npm ]; then cp -a /rootfs/usr/bin/npm /rootfs/opt/sandbox/usr/bin/npm; fi; \
    if [ -e /rootfs/usr/bin/npx ]; then cp -a /rootfs/usr/bin/npx /rootfs/opt/sandbox/usr/bin/npx; fi; \
    if [ -d /rootfs/usr/lib/node_modules ]; then \
      mkdir -p /rootfs/opt/sandbox/usr/lib/node_modules; \
      cp -a /rootfs/usr/lib/node_modules/. /rootfs/opt/sandbox/usr/lib/node_modules/; \
    fi; \
    # Node's Intl APIs (used by npm) require ICU data, which Alpine provides under /usr/share/icu.
    # When we chroot into /opt/sandbox, that path must exist inside the sandbox as well.
    if [ -d /rootfs/usr/share/icu ]; then \
      mkdir -p /rootfs/opt/sandbox/usr/share/icu; \
      cp -a /rootfs/usr/share/icu/. /rootfs/opt/sandbox/usr/share/icu/; \
    fi; \
    stage_ldd_node() { \
      target="$1"; \
      chroot /rootfs /usr/bin/ldd "$target" 2>/dev/null | awk '{ for (i=1;i<=NF;i++) if (substr($i,1,1)=="/") print $i }' | while read -r dep; do \
        if [ -e "/rootfs$dep" ]; then \
          mkdir -p "/rootfs/opt/sandbox$(dirname "$dep")"; \
          cp -aL "/rootfs$dep" "/rootfs/opt/sandbox$dep"; \
        fi; \
      done; \
    }; \
    stage_ldd_node /usr/bin/node; \
    # /usr/bin/env is used by npm's shebang on some distros.
    if [ -e /rootfs/usr/bin/env ]; then \
      mkdir -p /rootfs/opt/sandbox/usr/bin; \
      cp -aL /rootfs/usr/bin/env /rootfs/opt/sandbox/usr/bin/env; \
    fi; \
    chown -R 1000:1000 /rootfs/opt/sandbox/usr 2>/dev/null || true; \
  fi

# Stage deno + tar into /opt/sandbox so `/run-ts` and tar file ops can run inside the jail.
RUN set -eux; \
  stage_ldd() { \
    target="$1"; \
    chroot /rootfs /usr/bin/ldd "$target" 2>/dev/null | awk '{ for (i=1;i<=NF;i++) if (substr($i,1,1)=="/") print $i }' | while read -r dep; do \
      if [ -e "/rootfs$dep" ]; then \
        mkdir -p "/rootfs/opt/sandbox$(dirname "$dep")"; \
        cp -aL "/rootfs$dep" "/rootfs/opt/sandbox$dep"; \
      fi; \
    done; \
  }; \
  if [ -x /rootfs/usr/bin/deno ]; then \
    mkdir -p /rootfs/opt/sandbox/usr/bin; \
    cp -a /rootfs/usr/bin/deno /rootfs/opt/sandbox/usr/bin/deno; \
    stage_ldd /usr/bin/deno; \
  fi; \
  if [ -x /rootfs/bin/tar ]; then \
    mkdir -p /rootfs/opt/sandbox/bin; \
    rm -f /rootfs/opt/sandbox/bin/tar; \
    cp -a /rootfs/bin/tar /rootfs/opt/sandbox/bin/tar; \
    stage_ldd /bin/tar; \
  fi; \
  chown -R 1000:1000 /rootfs/opt/sandbox/usr /rootfs/opt/sandbox/bin 2>/dev/null || true

# Guest agent runtime (ESM + dependencies)
COPY --from=guest-agent-builder /src/package.json /rootfs/opt/guest-agent/package.json
COPY --from=guest-agent-builder /src/package-lock.json /rootfs/opt/guest-agent/package-lock.json
COPY --from=guest-agent-builder /src/node_modules /rootfs/opt/guest-agent/node_modules
COPY --from=guest-agent-builder /src/dist /rootfs/opt/guest-agent/dist

# Build ext4 from directory tree then shrink to minimum so we don't ship empty space.
RUN set -eux; \
  truncate -s 1G /rootfs.ext4; \
  # NOTE: Some e2fsprogs builds have been observed to fail during `-d` population with:
  #   "__populate_fs: Extent block checksum does not match extent block while writing file ..."
  # Disabling metadata checksums avoids that codepath and is still compatible with our kernel (5.10)
  # and offline resize workflow.
  mke2fs -t ext4 -F -O ^metadata_csum,^metadata_csum_seed,^orphan_file -d /rootfs /rootfs.ext4; \
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

