#!/bin/bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)

docker build -f "$ROOT_DIR/services/manager/Dockerfile" -t run-dat-sheesh-manager "$ROOT_DIR"

