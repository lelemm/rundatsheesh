#!/bin/bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)

"$ROOT_DIR/services/guest-image/build.sh"

