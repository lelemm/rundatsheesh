#!/bin/bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
OUT_DIR="$ROOT_DIR/services/guest-image/dist"

# Shell variant: "busybox" (default) or "bash" (NVM support)
SHELL_VARIANT=${SHELL_VARIANT:-busybox}

echo "[debian] building with SHELL_VARIANT=$SHELL_VARIANT"

mkdir -p "$OUT_DIR"

docker build -f "$ROOT_DIR/services/guest-image/Dockerfile" \
  --progress=plain \
  --network host \
  --build-arg SHELL_VARIANT="$SHELL_VARIANT" \
  --output type=local,dest="$OUT_DIR" \
  "$ROOT_DIR"

if [ -d "$OUT_DIR/out" ]; then
  mv "$OUT_DIR/out/vmlinux" "$OUT_DIR/vmlinux"
  mv "$OUT_DIR/out/rootfs.ext4" "$OUT_DIR/rootfs.ext4"
  rmdir "$OUT_DIR/out"
fi

ls -la "$OUT_DIR"
