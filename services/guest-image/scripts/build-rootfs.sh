#!/bin/bash
set -euo pipefail

: "${DEBIAN_MIRROR:?DEBIAN_MIRROR is required}"
: "${DEBIAN_SUITE:?DEBIAN_SUITE is required}"
: "${NODE_VERSION:?NODE_VERSION is required}"

# Shell variant: "busybox" (default) or "bash" (NVM support)
SHELL_VARIANT=${SHELL_VARIANT:-busybox}

ROOTFS_DIR=${1:-/rootfs}

mkdir -p "$ROOTFS_DIR"

# debootstrap occasionally flakes in some environments due to transient mirror/DNS/IPv6 issues.
# Use HTTPS by default and retry a few times to make builds reliable.
set -eu
for attempt in 1 2 3 4 5; do
  echo "debootstrap attempt ${attempt}/5 (suite=${DEBIAN_SUITE}, mirror=${DEBIAN_MIRROR})"
  if debootstrap --variant=minbase --include=libffi8,ca-certificates,libcap2,libselinux1,libsepol2 "${DEBIAN_SUITE}" "$ROOTFS_DIR" "${DEBIAN_MIRROR}"; then
    break
  fi
  if [ "$attempt" -eq 5 ]; then
    echo "debootstrap failed after 5 attempts" >&2
    exit 1
  fi
  echo "debootstrap failed (attempt ${attempt}); cleaning and retrying..." >&2
  find "$ROOTFS_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  sleep $((attempt * 2))
done

mkdir -p "$ROOTFS_DIR/tmp"
cat >"$ROOTFS_DIR/tmp/provision.sh" <<EOF
#!/bin/bash
set -euo pipefail

SHELL_VARIANT="$SHELL_VARIANT"

useradd -m -u 1000 -s /bin/bash user
passwd -l root || true

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates bash coreutils tar gzip unzip \
  iproute2 iptables nftables socat curl busybox-static \
  git
apt-get clean
rm -rf /var/lib/apt/lists/*

mkdir -p /home/user /opt/guest-agent /home/user/.deno /home/user/.tmp /home/user/tmp

# Create a minimal chroot-able toolchain under /opt/sandbox so untrusted exec can be confined
# without having to chroot directly into /home/user (avoids /home/user <-> /workspace alias loops).
SANDBOX_ROOT=/opt/sandbox
mkdir -p "\$SANDBOX_ROOT/bin" "\$SANDBOX_ROOT/dev" "\$SANDBOX_ROOT/tmp" "\$SANDBOX_ROOT/usr/bin" "\$SANDBOX_ROOT/etc/ssl/certs"
mkdir -p "\$SANDBOX_ROOT/home/user" "\$SANDBOX_ROOT/workspace"

stage_file_into_user_chroot() {
  local f="\$1"
  if [ ! -e "\$f" ]; then
    return 0
  fi
  mkdir -p "\$SANDBOX_ROOT\$(dirname "\$f")"
  # Follow symlinks so the sandbox contains real loader/libs (e.g. /lib64/ld-linux-*.so.2 is often a symlink).
  cp -aL "\$f" "\$SANDBOX_ROOT\$f"
}

stage_bin_into_user_chroot() {
  local bin="\$1"
  if [ ! -x "\$bin" ]; then
    echo "missing executable: \$bin" >&2
    exit 1
  fi
  mkdir -p "\$SANDBOX_ROOT\$(dirname "\$bin")"
  cp -a "\$bin" "\$SANDBOX_ROOT\$bin"
}

stage_ldd_deps_into_user_chroot() {
  local target="\$1"
  if ! command -v ldd >/dev/null 2>&1; then
    echo "ldd not found in guest rootfs; cannot stage deps for \$target" >&2
    exit 1
  fi
  # Some git helpers under /usr/lib/git-core are shell/perl scripts (not ELF),
  # and \`ldd\` returns non-zero for those. Treat that as "no deps to stage".
  local out=""
  if ! out="\$(ldd "\$target" 2>/dev/null)"; then
    return 0
  fi
  printf "%s\n" "\$out" | awk '{ for (i=1;i<=NF;i++) if (substr(\$i,1,1)=="/") print \$i }' | while read -r dep; do
    stage_file_into_user_chroot "\$dep"
  done
}

# Shell variant: busybox (static busybox with applet symlinks) - DEFAULT
if [ "\$SHELL_VARIANT" != "bash" ]; then
  echo "[busybox] Setting up BusyBox sandbox..."
  # BusyBox toolchain inside the sandbox (exec uses: chroot \$SANDBOX_ROOT /bin/busybox sh -c ...)
  cp /bin/busybox "\$SANDBOX_ROOT/bin/busybox"
  chmod 0755 "\$SANDBOX_ROOT/bin/busybox"
  chroot "\$SANDBOX_ROOT" /bin/busybox --install -s /bin
  echo "[busybox] BusyBox sandbox ready"
fi

# Shell variant: bash (bash + GNU coreutils, no busybox) - for NVM support
if [ "\$SHELL_VARIANT" = "bash" ]; then
  echo "[bash] Setting up Bash + GNU coreutils sandbox..."
  
  stage_cmd() {
    local cmd="\$1"
    for path in /usr/bin/\$cmd /bin/\$cmd; do
      if [ -e "\$path" ]; then
        real_path=\$(readlink -f "\$path")
        dest="\$SANDBOX_ROOT\${path}"
        mkdir -p "\$(dirname "\$dest")"
        cp -aL "\$real_path" "\$dest"
        stage_ldd_deps_into_user_chroot "\$real_path"
        echo "[bash]   staged: \$cmd -> \$real_path"
        return 0
      fi
    done
    echo "[bash]   warning: \$cmd not found"
    return 1
  }
  
  # Stage bash
  cp -aL /bin/bash "\$SANDBOX_ROOT/bin/bash"
  stage_ldd_deps_into_user_chroot /bin/bash
  # Create /bin/sh symlink to bash
  ln -sf bash "\$SANDBOX_ROOT/bin/sh"
  
  # Stage GNU coreutils - all essential commands for NVM and general use
  for cmd in ls head tail sort cut tr dirname basename wc cat tee mkdir rm mv cp chmod chown ln readlink mktemp sleep date touch env id whoami uname expr seq test printf echo true false yes xargs find; do
    stage_cmd "\$cmd" || true
  done
  
  # Stage grep, sed, awk - text processing
  for cmd in grep sed awk gawk; do
    stage_cmd "\$cmd" || true
  done
  
  # Stage compression tools (required for tar -z/-j operations)
  for cmd in gzip gunzip zcat bzip2 bunzip2 xz unxz; do
    stage_cmd "\$cmd" || true
  done
  
  # Stage curl and wget for downloads
  for cmd in curl wget; do
    stage_cmd "\$cmd" || true
  done
  
  chown -R 1000:1000 "\$SANDBOX_ROOT/bin" "\$SANDBOX_ROOT/usr/bin" 2>/dev/null || true
  echo "[bash] Bash sandbox ready"
fi

# Stage git into sandbox so \`exec\` (which chroots to \$SANDBOX_ROOT) can run it.
echo "Staging git into sandbox chroot (\$SANDBOX_ROOT)..."
stage_bin_into_user_chroot /usr/bin/git

if [ -d /usr/lib/git-core ]; then
  mkdir -p "\$SANDBOX_ROOT/usr/lib/git-core"
  cp -a /usr/lib/git-core/. "\$SANDBOX_ROOT/usr/lib/git-core/"
fi

if [ -d /usr/libexec/git-core ]; then
  mkdir -p "\$SANDBOX_ROOT/usr/libexec/git-core"
  cp -a /usr/libexec/git-core/. "\$SANDBOX_ROOT/usr/libexec/git-core/"
fi

if [ -d /usr/share/git-core ]; then
  mkdir -p "\$SANDBOX_ROOT/usr/share/git-core"
  cp -a /usr/share/git-core/. "\$SANDBOX_ROOT/usr/share/git-core/"
fi

# TLS CA bundle for https remotes
stage_file_into_user_chroot /etc/ssl/certs/ca-certificates.crt

# Some libcurl builds look for /etc/ssl/cert.pem (Alpine-style). Provide it inside the sandbox.
if [ -f "\$SANDBOX_ROOT/etc/ssl/certs/ca-certificates.crt" ]; then
  ln -sfn /etc/ssl/certs/ca-certificates.crt "\$SANDBOX_ROOT/etc/ssl/cert.pem"
fi

# Also provide /etc/ssl/cert.pem in the main rootfs for non-chrooted tooling.
if [ -f /etc/ssl/certs/ca-certificates.crt ]; then
  ln -sfn /etc/ssl/certs/ca-certificates.crt /etc/ssl/cert.pem
fi

# Stage shared libs needed by git + its helper binaries into sandbox so the chroot can run them.
stage_ldd_deps_into_user_chroot /usr/bin/git

if [ -d /usr/lib/git-core ]; then
  find /usr/lib/git-core -maxdepth 1 -type f -perm -111 2>/dev/null | while read -r helper; do
    stage_ldd_deps_into_user_chroot "\$helper"
  done
fi

if [ -d /usr/libexec/git-core ]; then
  find /usr/libexec/git-core -maxdepth 1 -type f -perm -111 2>/dev/null | while read -r helper; do
    stage_ldd_deps_into_user_chroot "\$helper"
  done
fi

# Minimal device nodes for common tooling (avoid failures for redirects etc).
# These nodes are inside the sandbox chroot and do not expose host devices.
mknod -m 666 "\$SANDBOX_ROOT/dev/null" c 1 3 || true
mknod -m 666 "\$SANDBOX_ROOT/dev/zero" c 1 5 || true
mknod -m 666 "\$SANDBOX_ROOT/dev/random" c 1 8 || true
mknod -m 666 "\$SANDBOX_ROOT/dev/urandom" c 1 9 || true

chown -R 1000:1000 /home/user
chown -R 1000:1000 /home/user/.deno /home/user/.tmp /home/user/tmp
EOF
chmod +x "$ROOTFS_DIR/tmp/provision.sh"
chroot "$ROOTFS_DIR" /bin/bash /tmp/provision.sh
rm -f "$ROOTFS_DIR/tmp/provision.sh"

# Install Deno with retry logic (downloads can occasionally fail with bad CRC)
mkdir -p "$ROOTFS_DIR/tmp"
for attempt in 1 2 3; do
  echo "Deno install attempt ${attempt}/3"
  curl -L "https://deno.land/install.sh" -o "$ROOTFS_DIR/tmp/install-deno.sh"
  # Clear any partial/corrupt previous install
  rm -rf "$ROOTFS_DIR/home/user/.deno/bin/deno" || true
  if chroot "$ROOTFS_DIR" /bin/bash -c "su - user -c 'DENO_INSTALL=/home/user/.deno bash /tmp/install-deno.sh'"; then
    # Verify the binary is functional
    if chroot "$ROOTFS_DIR" /bin/bash -c "su - user -c '/home/user/.deno/bin/deno --version'" >/dev/null 2>&1; then
      echo "Deno installed successfully"
      break
    else
      echo "Deno binary verification failed, retrying..."
    fi
  fi
  if [ "$attempt" -eq 3 ]; then
    echo "Deno installation failed after 3 attempts" >&2
    exit 1
  fi
  sleep 2
done
rm -f "$ROOTFS_DIR/tmp/install-deno.sh"

# Stage Deno + GNU tar into the /exec sandbox so /run-ts and files tar operations can run chrooted.
cat >"$ROOTFS_DIR/tmp/stage-deno-tar-into-sandbox.sh" <<'EOF'
#!/bin/bash
set -euo pipefail

SANDBOX_ROOT=/opt/sandbox

stage_file() {
  local f="$1"
  [ -e "$f" ] || return 0
  mkdir -p "$SANDBOX_ROOT$(dirname "$f")"
  cp -aL "$f" "$SANDBOX_ROOT$f"
}

stage_ldd() {
  local target="$1"
  local out=""
  if ! out="$(ldd "$target" 2>/dev/null)"; then
    return 0
  fi
  printf "%s\n" "$out" | awk '{ for (i=1;i<=NF;i++) if (substr($i,1,1)=="/") print $i }' | while read -r dep; do
    stage_file "$dep"
  done
}

echo "Staging deno + tar into sandbox chroot ($SANDBOX_ROOT)..."

# Deno is installed under /home/user/.deno (outside the sandbox). Copy it into /usr/bin inside the sandbox.
if [ -x /home/user/.deno/bin/deno ]; then
  mkdir -p "$SANDBOX_ROOT/usr/bin"
  cp -a /home/user/.deno/bin/deno "$SANDBOX_ROOT/usr/bin/deno"
  stage_ldd /home/user/.deno/bin/deno
fi

# Use GNU tar inside the sandbox (BusyBox tar may not support all flags/output formats we rely on).
if [ -x /bin/tar ]; then
  mkdir -p "$SANDBOX_ROOT/bin"
  rm -f "$SANDBOX_ROOT/bin/tar"
  cp -a /bin/tar "$SANDBOX_ROOT/bin/tar"
  stage_ldd /bin/tar
fi
EOF
chmod +x "$ROOTFS_DIR/tmp/stage-deno-tar-into-sandbox.sh"
chroot "$ROOTFS_DIR" /bin/bash /tmp/stage-deno-tar-into-sandbox.sh
rm -f "$ROOTFS_DIR/tmp/stage-deno-tar-into-sandbox.sh"

# Install Node (tarball)
curl -L "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz
mkdir -p "$ROOTFS_DIR/usr/local"
tar -xf /tmp/node.tar.xz -C "$ROOTFS_DIR/usr/local" --strip-components=1
rm -f /tmp/node.tar.xz

# Stage Node + npm into the /exec sandbox (chroot root: /opt/sandbox).
# Without this, /exec can't run npm install because it only sees the sandbox filesystem.
cat >"$ROOTFS_DIR/tmp/stage-node-into-sandbox.sh" <<'EOF'
#!/bin/bash
set -euo pipefail

SANDBOX_ROOT=/opt/sandbox

stage_file() {
  local f="$1"
  [ -e "$f" ] || return 0
  mkdir -p "$SANDBOX_ROOT$(dirname "$f")"
  cp -aL "$f" "$SANDBOX_ROOT$f"
}

stage_bin() {
  local bin="$1"
  [ -x "$bin" ] || { echo "missing executable: $bin" >&2; exit 1; }
  mkdir -p "$SANDBOX_ROOT$(dirname "$bin")"
  cp -a "$bin" "$SANDBOX_ROOT$bin"
}

stage_ldd() {
  local target="$1"
  local out=""
  if ! out="$(ldd "$target" 2>/dev/null)"; then
    return 0
  fi
  printf "%s\n" "$out" | awk '{ for (i=1;i<=NF;i++) if (substr($i,1,1)=="/") print $i }' | while read -r dep; do
    stage_file "$dep"
  done
}

echo "Staging node/npm into sandbox chroot ($SANDBOX_ROOT)..."

# Node binary + its dynamic deps
stage_bin /usr/local/bin/node
stage_ldd /usr/local/bin/node

# npm/npx are scripts; copy them plus the bundled node_modules tree
if [ -e /usr/local/bin/npm ]; then stage_file /usr/local/bin/npm; fi
if [ -e /usr/local/bin/npx ]; then stage_file /usr/local/bin/npx; fi

if [ -d /usr/local/lib/node_modules ]; then
  mkdir -p "$SANDBOX_ROOT/usr/local/lib/node_modules"
  cp -a /usr/local/lib/node_modules/. "$SANDBOX_ROOT/usr/local/lib/node_modules/"
fi

# Ensure /usr/bin/env exists for shebangs like `#!/usr/bin/env node`
stage_file /usr/bin/env

# ICU data: some Node builds load ICU datasets from /usr/share/icu at runtime.
# When `/exec` chroots into ${SANDBOX_ROOT}, that path must exist inside the sandbox too.
if [ -d /usr/share/icu ]; then
  mkdir -p "$SANDBOX_ROOT/usr/share/icu"
  cp -a /usr/share/icu/. "$SANDBOX_ROOT/usr/share/icu/"
fi
EOF
chmod +x "$ROOTFS_DIR/tmp/stage-node-into-sandbox.sh"
chroot "$ROOTFS_DIR" /bin/bash /tmp/stage-node-into-sandbox.sh
rm -f "$ROOTFS_DIR/tmp/stage-node-into-sandbox.sh"

# For bash variant: install NVM to a fixed location in the sandbox
if [ "$SHELL_VARIANT" = "bash" ]; then
  echo "[bash] Installing NVM for bash variant..."
  cat >"$ROOTFS_DIR/tmp/install-nvm.sh" <<'NVMEOF'
#!/bin/bash
set -eux

SANDBOX_ROOT=/opt/sandbox
NVM_VERSION="v0.40.1"

# Download and extract NVM to /opt/sandbox/opt/nvm (fixed location in image)
mkdir -p "$SANDBOX_ROOT/opt/nvm"
curl -L "https://github.com/nvm-sh/nvm/archive/refs/tags/${NVM_VERSION}.tar.gz" | \
  tar -xz -C "$SANDBOX_ROOT/opt/nvm" --strip-components=1
chown -R 1000:1000 "$SANDBOX_ROOT/opt/nvm"

# Create .bashrc at /opt/sandbox/etc/skel/.bashrc (sourced by jail.ts for bash variant)
# NVM_DIR=/workspace/.nvm ensures installed Node versions persist across exec calls
# (since /workspace is bind-mounted from the real /home/user)
mkdir -p "$SANDBOX_ROOT/etc/skel"
printf '%s\n' \
  'export NVM_DIR="/workspace/.nvm"' \
  '[ -s "/opt/nvm/nvm.sh" ] && . "/opt/nvm/nvm.sh"' \
  > "$SANDBOX_ROOT/etc/skel/.bashrc"
chmod 644 "$SANDBOX_ROOT/etc/skel/.bashrc"

echo "[bash] NVM installed successfully at /opt/nvm, NVM_DIR=/workspace/.nvm"
NVMEOF
  chmod +x "$ROOTFS_DIR/tmp/install-nvm.sh"
  chroot "$ROOTFS_DIR" /bin/bash /tmp/install-nvm.sh
  rm -f "$ROOTFS_DIR/tmp/install-nvm.sh"
fi
