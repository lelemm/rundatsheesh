#!/bin/bash
set -euo pipefail

: "${DEBIAN_MIRROR:?DEBIAN_MIRROR is required}"
: "${DEBIAN_SUITE:?DEBIAN_SUITE is required}"
: "${NODE_VERSION:?NODE_VERSION is required}"

ROOTFS_DIR=${1:-/rootfs}

mkdir -p "$ROOTFS_DIR"

# debootstrap occasionally flakes in some environments due to transient mirror/DNS/IPv6 issues.
# Use HTTPS by default and retry a few times to make builds reliable.
set -eu
for attempt in 1 2 3 4 5; do
  echo "debootstrap attempt ${attempt}/5 (suite=${DEBIAN_SUITE}, mirror=${DEBIAN_MIRROR})"
  if debootstrap --variant=minbase --include=libffi8,ca-certificates "${DEBIAN_SUITE}" "$ROOTFS_DIR" "${DEBIAN_MIRROR}"; then
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
cat >"$ROOTFS_DIR/tmp/provision.sh" <<'EOF'
#!/bin/bash
set -euo pipefail

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
mkdir -p "$SANDBOX_ROOT/bin" "$SANDBOX_ROOT/dev" "$SANDBOX_ROOT/tmp" "$SANDBOX_ROOT/usr/bin" "$SANDBOX_ROOT/etc/ssl/certs"
mkdir -p "$SANDBOX_ROOT/home/user" "$SANDBOX_ROOT/workspace"

# BusyBox toolchain inside the sandbox (exec uses: chroot $SANDBOX_ROOT /bin/busybox sh -c ...)
cp /bin/busybox "$SANDBOX_ROOT/bin/busybox"
chmod 0755 "$SANDBOX_ROOT/bin/busybox"
chroot "$SANDBOX_ROOT" /bin/busybox --install -s /bin

stage_file_into_user_chroot() {
  local f="$1"
  if [ ! -e "$f" ]; then
    return 0
  fi
  mkdir -p "$SANDBOX_ROOT$(dirname "$f")"
  # Follow symlinks so the sandbox contains real loader/libs (e.g. /lib64/ld-linux-*.so.2 is often a symlink).
  cp -aL "$f" "$SANDBOX_ROOT$f"
}

stage_bin_into_user_chroot() {
  local bin="$1"
  if [ ! -x "$bin" ]; then
    echo "missing executable: $bin" >&2
    exit 1
  fi
  mkdir -p "$SANDBOX_ROOT$(dirname "$bin")"
  cp -a "$bin" "$SANDBOX_ROOT$bin"
}

stage_ldd_deps_into_user_chroot() {
  local target="$1"
  if ! command -v ldd >/dev/null 2>&1; then
    echo "ldd not found in guest rootfs; cannot stage deps for $target" >&2
    exit 1
  fi
  # Some git helpers under /usr/lib/git-core are shell/perl scripts (not ELF),
  # and `ldd` returns non-zero for those. Treat that as "no deps to stage".
  local out=""
  if ! out="$(ldd "$target" 2>/dev/null)"; then
    return 0
  fi
  printf "%s\n" "$out" | awk '{ for (i=1;i<=NF;i++) if (substr($i,1,1)=="/") print $i }' | while read -r dep; do
    stage_file_into_user_chroot "$dep"
  done
}

# Stage git into sandbox so `exec` (which chroots to $SANDBOX_ROOT) can run it.
echo "Staging git into sandbox chroot ($SANDBOX_ROOT)..."
stage_bin_into_user_chroot /usr/bin/git

if [ -d /usr/lib/git-core ]; then
  mkdir -p "$SANDBOX_ROOT/usr/lib/git-core"
  cp -a /usr/lib/git-core/. "$SANDBOX_ROOT/usr/lib/git-core/"
fi

if [ -d /usr/libexec/git-core ]; then
  mkdir -p "$SANDBOX_ROOT/usr/libexec/git-core"
  cp -a /usr/libexec/git-core/. "$SANDBOX_ROOT/usr/libexec/git-core/"
fi

if [ -d /usr/share/git-core ]; then
  mkdir -p "$SANDBOX_ROOT/usr/share/git-core"
  cp -a /usr/share/git-core/. "$SANDBOX_ROOT/usr/share/git-core/"
fi

# TLS CA bundle for https remotes
stage_file_into_user_chroot /etc/ssl/certs/ca-certificates.crt

# Stage shared libs needed by git + its helper binaries into sandbox so the chroot can run them.
stage_ldd_deps_into_user_chroot /usr/bin/git

if [ -d /usr/lib/git-core ]; then
  find /usr/lib/git-core -maxdepth 1 -type f -perm -111 2>/dev/null | while read -r helper; do
    stage_ldd_deps_into_user_chroot "$helper"
  done
fi

if [ -d /usr/libexec/git-core ]; then
  find /usr/libexec/git-core -maxdepth 1 -type f -perm -111 2>/dev/null | while read -r helper; do
    stage_ldd_deps_into_user_chroot "$helper"
  done
fi

# Minimal device nodes for common tooling (avoid failures for redirects etc).
# These nodes are inside the sandbox chroot and do not expose host devices.
mknod -m 666 "$SANDBOX_ROOT/dev/null" c 1 3 || true
mknod -m 666 "$SANDBOX_ROOT/dev/zero" c 1 5 || true
mknod -m 666 "$SANDBOX_ROOT/dev/random" c 1 8 || true
mknod -m 666 "$SANDBOX_ROOT/dev/urandom" c 1 9 || true

chown -R 1000:1000 /home/user
chown -R 1000:1000 /home/user/.deno /home/user/.tmp /home/user/tmp
EOF
chmod +x "$ROOTFS_DIR/tmp/provision.sh"
chroot "$ROOTFS_DIR" /bin/bash /tmp/provision.sh
rm -f "$ROOTFS_DIR/tmp/provision.sh"

# Install Deno
mkdir -p "$ROOTFS_DIR/tmp"
curl -L "https://deno.land/install.sh" -o "$ROOTFS_DIR/tmp/install-deno.sh"
chroot "$ROOTFS_DIR" /bin/bash -c "su - user -c 'DENO_INSTALL=/home/user/.deno bash /tmp/install-deno.sh'"
rm -f "$ROOTFS_DIR/tmp/install-deno.sh"

# Install Node (tarball)
curl -L "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz
mkdir -p "$ROOTFS_DIR/usr/local"
tar -xf /tmp/node.tar.xz -C "$ROOTFS_DIR/usr/local" --strip-components=1
rm -f /tmp/node.tar.xz

