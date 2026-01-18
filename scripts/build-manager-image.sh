#!/bin/bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
IMAGE_NAME=${IMAGE_NAME:-run-dat-sheesh-manager}

docker build -f "$ROOT_DIR/services/manager/Dockerfile" -t "$IMAGE_NAME" "$ROOT_DIR"

