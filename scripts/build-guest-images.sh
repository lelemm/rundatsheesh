#!/bin/bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)

DIST_DIR="$ROOT_DIR/dist/images"
DEBIAN_OUT_DIR="$DIST_DIR/debian"
ALPINE_OUT_DIR="$DIST_DIR/alpine"
ALPINE_BASH_OUT_DIR="$DIST_DIR/alpine-bash"

mkdir -p "$DEBIAN_OUT_DIR" "$ALPINE_OUT_DIR" "$ALPINE_BASH_OUT_DIR"

echo "[guest-images] building debian guest image..."
"$ROOT_DIR/services/guest-image/build.sh"

echo "[guest-images] building alpine guest image (busybox)..."
if [ ! -x "$ROOT_DIR/services/guest-image-alpine/build.sh" ]; then
  echo "[guest-images] missing: services/guest-image-alpine/build.sh (alpine builder not yet added)" >&2
  exit 1
fi
SHELL_VARIANT=busybox "$ROOT_DIR/services/guest-image-alpine/build.sh"

echo "[guest-images] copying alpine (busybox) artifacts..."
chmod 0644 "$ROOT_DIR/services/guest-image-alpine/dist/vmlinux" "$ROOT_DIR/services/guest-image-alpine/dist/rootfs.ext4" 2>/dev/null || true
cp -f "$ROOT_DIR/services/guest-image-alpine/dist/vmlinux" "$ALPINE_OUT_DIR/vmlinux"
cp -f "$ROOT_DIR/services/guest-image-alpine/dist/rootfs.ext4" "$ALPINE_OUT_DIR/rootfs.ext4"

echo "[guest-images] building alpine guest image (bash)..."
SHELL_VARIANT=bash "$ROOT_DIR/services/guest-image-alpine/build.sh"

echo "[guest-images] copying alpine (bash) artifacts..."
chmod 0644 "$ROOT_DIR/services/guest-image-alpine/dist/vmlinux" "$ROOT_DIR/services/guest-image-alpine/dist/rootfs.ext4" 2>/dev/null || true
cp -f "$ROOT_DIR/services/guest-image-alpine/dist/vmlinux" "$ALPINE_BASH_OUT_DIR/vmlinux"
cp -f "$ROOT_DIR/services/guest-image-alpine/dist/rootfs.ext4" "$ALPINE_BASH_OUT_DIR/rootfs.ext4"

echo "[guest-images] copying debian artifacts..."
chmod 0644 "$ROOT_DIR/services/guest-image/dist/vmlinux" "$ROOT_DIR/services/guest-image/dist/rootfs.ext4" 2>/dev/null || true
cp -f "$ROOT_DIR/services/guest-image/dist/vmlinux" "$DEBIAN_OUT_DIR/vmlinux"
cp -f "$ROOT_DIR/services/guest-image/dist/rootfs.ext4" "$DEBIAN_OUT_DIR/rootfs.ext4"

echo "[guest-images] done"
ls -la "$DIST_DIR" || true
