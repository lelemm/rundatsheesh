#!/bin/bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
OUT_DIR="$ROOT_DIR/services/guest-image/dist"

mkdir -p "$OUT_DIR"

docker build -f "$ROOT_DIR/services/guest-image/Dockerfile" \
  --progress=plain \
  --output type=local,dest="$OUT_DIR" \
  "$ROOT_DIR"

if [ -d "$OUT_DIR/out" ]; then
  mv "$OUT_DIR/out/vmlinux" "$OUT_DIR/vmlinux"
  mv "$OUT_DIR/out/rootfs.ext4" "$OUT_DIR/rootfs.ext4"
  rmdir "$OUT_DIR/out"
fi

ls -la "$OUT_DIR"
