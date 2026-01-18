#!/bin/bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
IMAGE_NAME=${IMAGE_NAME:-run-dat-sheesh-manager}

BUILD_ARGS=()
if [ "${NO_CACHE:-0}" = "1" ]; then
  BUILD_ARGS+=(--no-cache)
fi
if [ "${PULL:-1}" = "1" ]; then
  BUILD_ARGS+=(--pull)
fi

docker build "${BUILD_ARGS[@]}" -f "$ROOT_DIR/services/manager/Dockerfile" -t "$IMAGE_NAME" "$ROOT_DIR"

