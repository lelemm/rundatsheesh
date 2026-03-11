#!/bin/bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
INTEGRATION_IMAGE="${INTEGRATION_IMAGE:-}"

DIST_DIR="$ROOT_DIR/dist/images"
DEBIAN_OUT_DIR="$DIST_DIR/debian"
DEBIAN_BASH_OUT_DIR="$DIST_DIR/debian-bash"
ALPINE_OUT_DIR="$DIST_DIR/alpine"
ALPINE_BASH_OUT_DIR="$DIST_DIR/alpine-bash"

mkdir -p "$DEBIAN_OUT_DIR" "$DEBIAN_BASH_OUT_DIR" "$ALPINE_OUT_DIR" "$ALPINE_BASH_OUT_DIR"

is_valid_integration_image() {
  case "$1" in
    ""|debian|debian-bash|alpine|alpine-bash) return 0 ;;
    *) return 1 ;;
  esac
}

should_build() {
  local image="$1"
  [ -z "$INTEGRATION_IMAGE" ] || [ "$INTEGRATION_IMAGE" = "$image" ]
}

copy_artifacts() {
  local src_dir="$1"
  local out_dir="$2"
  chmod 0644 "$src_dir/vmlinux" "$src_dir/rootfs.ext4" 2>/dev/null || true
  cp -f "$src_dir/vmlinux" "$out_dir/vmlinux"
  cp -f "$src_dir/rootfs.ext4" "$out_dir/rootfs.ext4"
}

if ! is_valid_integration_image "$INTEGRATION_IMAGE"; then
  echo "[guest-images] invalid INTEGRATION_IMAGE='$INTEGRATION_IMAGE' (expected: debian|debian-bash|alpine|alpine-bash)" >&2
  exit 1
fi

if [ -n "$INTEGRATION_IMAGE" ]; then
  echo "[guest-images] target image set: $INTEGRATION_IMAGE"
fi

if should_build "debian"; then
  echo "[guest-images] building debian guest image (busybox)..."
  SHELL_VARIANT=busybox "$ROOT_DIR/services/guest-image/build.sh"
  echo "[guest-images] copying debian (busybox) artifacts..."
  copy_artifacts "$ROOT_DIR/services/guest-image/dist" "$DEBIAN_OUT_DIR"
fi

if should_build "debian-bash"; then
  echo "[guest-images] building debian guest image (bash)..."
  SHELL_VARIANT=bash "$ROOT_DIR/services/guest-image/build.sh"
  echo "[guest-images] copying debian (bash) artifacts..."
  copy_artifacts "$ROOT_DIR/services/guest-image/dist" "$DEBIAN_BASH_OUT_DIR"
fi

if should_build "alpine" || should_build "alpine-bash"; then
  if [ ! -x "$ROOT_DIR/services/guest-image-alpine/build.sh" ]; then
    echo "[guest-images] missing: services/guest-image-alpine/build.sh (alpine builder not yet added)" >&2
    exit 1
  fi
fi

if should_build "alpine"; then
  echo "[guest-images] building alpine guest image (busybox)..."
  SHELL_VARIANT=busybox "$ROOT_DIR/services/guest-image-alpine/build.sh"
  echo "[guest-images] copying alpine (busybox) artifacts..."
  copy_artifacts "$ROOT_DIR/services/guest-image-alpine/dist" "$ALPINE_OUT_DIR"
fi

if should_build "alpine-bash"; then
  echo "[guest-images] building alpine guest image (bash)..."
  SHELL_VARIANT=bash "$ROOT_DIR/services/guest-image-alpine/build.sh"
  echo "[guest-images] copying alpine (bash) artifacts..."
  copy_artifacts "$ROOT_DIR/services/guest-image-alpine/dist" "$ALPINE_BASH_OUT_DIR"
fi

echo "[guest-images] done"
ls -la "$DIST_DIR" || true
