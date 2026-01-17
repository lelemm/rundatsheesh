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

chroot "$ROOTFS_DIR" /bin/bash -c "set -e; \
  useradd -m -u 1000 -s /bin/bash user; \
  passwd -l root; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
    ca-certificates bash coreutils tar gzip unzip \
    iproute2 iptables nftables socat curl busybox-static; \
  apt-get clean; \
  rm -rf /var/lib/apt/lists/*; \
  mkdir -p /home/user /opt/guest-agent /home/user/.deno /home/user/.tmp; \
  \
  # Create a minimal chroot-able toolchain under /home/user so untrusted exec can be confined
  # to /home/user without access to the guest OS filesystem (/etc, /proc, /usr, ...).
  mkdir -p /home/user/bin /home/user/dev /home/user/tmp; \
  cp /bin/busybox /home/user/bin/busybox; \
  chmod 0755 /home/user/bin/busybox; \
  /home/user/bin/busybox --install -s /home/user/bin; \
  \
  # Minimal device nodes for common tooling (avoid failures for redirects etc).
  # These nodes are inside the chroot (/home/user) and do not expose host devices.
  mknod -m 666 /home/user/dev/null c 1 3 || true; \
  mknod -m 666 /home/user/dev/zero c 1 5 || true; \
  mknod -m 666 /home/user/dev/random c 1 8 || true; \
  mknod -m 666 /home/user/dev/urandom c 1 9 || true; \
  \
  chown -R 1000:1000 /home/user; \
  chown -R 1000:1000 /home/user/.deno /home/user/.tmp /home/user/tmp"

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

