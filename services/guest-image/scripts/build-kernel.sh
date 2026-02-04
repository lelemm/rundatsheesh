#!/bin/bash
set -euo pipefail

: "${KERNEL_VERSION:?KERNEL_VERSION is required}"
: "${KERNEL_CONFIG_URL:?KERNEL_CONFIG_URL is required}"

WORKDIR=${1:-/build}

mkdir -p "$WORKDIR"
cd "$WORKDIR"

curl -L "https://cdn.kernel.org/pub/linux/kernel/v5.x/linux-${KERNEL_VERSION}.tar.xz" -o linux.tar.xz
tar -xf linux.tar.xz

cd "$WORKDIR/linux-${KERNEL_VERSION}"

set -e
# The upstream Firecracker kernel config URL can move. Prefer it when available,
# but fall back to a sane baseline config so builds don't depend on Docker cache.
if curl -fsSL "${KERNEL_CONFIG_URL}" -o .config; then
  make olddefconfig
else
  echo "Warning: failed to fetch KERNEL_CONFIG_URL=${KERNEL_CONFIG_URL}; falling back to x86_64_defconfig"
  make x86_64_defconfig
fi

# Ensure the guest kernel supports virtio-mmio block (rootfs), virtio-vsock (agent),
# ext4 rootfs, and a serial console on ttyS0 (Firecracker exposes an 8250 UART at 0x3f8).
# Also ensure critical drivers are built-in (no modules in the guest).
./scripts/config -e DEVTMPFS -e DEVTMPFS_MOUNT -e TMPFS -e EXT4_FS
# Firecracker uses virtio-mmio; device discovery commonly relies on `virtio_mmio.device=...`
# kernel cmdline entries, which require CONFIG_VIRTIO_MMIO_CMDLINE_DEVICES=y.
./scripts/config -e VIRTIO -e VIRTIO_MMIO -e VIRTIO_MMIO_CMDLINE_DEVICES -e VIRTIO_BLK -e VIRTIO_NET
./scripts/config -e VSOCKETS -e VIRTIO_VSOCKETS -e VIRTIO_VSOCKETS_COMMON
./scripts/config -e SERIAL_8250 -e SERIAL_8250_CONSOLE -e SERIAL_CORE -e SERIAL_CORE_CONSOLE
# Enable overlayfs for copy-on-write root filesystem (base rootfs + per-VM overlay)
./scripts/config -e OVERLAY_FS
make olddefconfig
make -j"$(nproc)" vmlinux

