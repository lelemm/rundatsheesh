#!/bin/bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
API_KEY=${API_KEY:-dev-key}
MANAGER_PORT=${MANAGER_PORT:-3000}
MANAGER_BASE=${MANAGER_BASE:-http://127.0.0.1:${MANAGER_PORT}}
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@example.com}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-dev-password}
ENABLE_SNAPSHOTS=${ENABLE_SNAPSHOTS:-false}
SNAPSHOT_TEMPLATE_CPU=${SNAPSHOT_TEMPLATE_CPU:-1}
SNAPSHOT_TEMPLATE_MEM_MB=${SNAPSHOT_TEMPLATE_MEM_MB:-256}

require_dep() {
  local dep="$1"
  if ! command -v "$dep" >/dev/null 2>&1; then
    echo "Missing dependency: $dep"
    return 1
  fi
}

skip_if_missing_kvm() {
  if [ ! -e /dev/kvm ]; then
    echo "Skipping integration: /dev/kvm not available"
    exit 0
  fi
}

skip_if_missing_vsock() {
  if [ ! -e /dev/vhost-vsock ]; then
    echo "Skipping integration: /dev/vhost-vsock not available (vsock unsupported)"
    exit 0
  fi

  # vhost_vsock may be built-in (not listed in /proc/modules). Accept either.
  if [ ! -e /sys/module/vhost_vsock ] && ! grep -q "^vhost_vsock " /proc/modules; then
    echo "Skipping integration: vhost_vsock module not loaded"
    exit 0
  fi

  if [ ! -e /sys/module/vsock ] && ! grep -q "^vsock " /proc/modules; then
    echo "Skipping integration: vsock module not available"
    exit 0
  fi
}

compute_dev_args() {
  DEV_ARGS=(--device /dev/kvm --device /dev/vhost-vsock --device /dev/net/tun)
  if [ -e /dev/vsock ]; then
    DEV_ARGS+=(--device /dev/vsock)
  else
    echo "Warning: /dev/vsock not available; vsock connect may fail"
  fi
}

wait_for_manager() {
  local api_key="$1"
  for i in {1..60}; do
    if curl -sf -H "X-API-Key: $api_key" "$MANAGER_BASE/v1/vms" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

skip_if_missing_kvm
skip_if_missing_vsock
require_dep docker || exit 1
require_dep curl || exit 1
require_dep make || exit 1
require_dep node || exit 1

compute_dev_args

echo "Building guest artifacts (kernel + rootfs)..."
make -C "$ROOT_DIR" guest-images

echo "Building manager docker image..."
docker build --progress=plain -f "$ROOT_DIR/services/manager/Dockerfile" -t run-dat-sheesh-manager "$ROOT_DIR"

echo "Starting manager container..."
RDS_DATA_DIR="$(mktemp -d)"
RDS_IMAGES_DIR="$(mktemp -d)"
# With `--cap-drop ALL`, even root in the container does NOT have CAP_DAC_OVERRIDE,
# so bind-mounted host directories must be writable by the container's uid/gid via normal permissions.
# mktemp defaults to 0700; make it world-writable so the container can write.
#
# IMPORTANT: do NOT set the sticky bit here (1777). The manager container commonly writes files as uid 0
# on the host mount, and sticky directories prevent non-owners from cleaning them up, leaving VM folders behind.
chmod 0777 "$RDS_DATA_DIR"
chmod 0777 "$RDS_IMAGES_DIR"
CID=$(docker run -d \
  "${DEV_ARGS[@]}" \
  --read-only \
  --security-opt no-new-privileges:true \
  --security-opt seccomp=unconfined \
  --security-opt apparmor=unconfined \
  --cap-drop ALL \
  --cap-add NET_ADMIN \
  --cap-add SYS_ADMIN \
  --cap-add SYS_CHROOT \
  --cap-add SETUID \
  --cap-add SETGID \
  --cap-add MKNOD \
  --cap-add CHOWN \
  --cap-add DAC_OVERRIDE \
  --cap-add DAC_READ_SEARCH \
  --tmpfs /tmp \
  --tmpfs /run \
  --sysctl net.ipv4.ip_forward=1 \
  --sysctl net.ipv4.conf.all.forwarding=1 \
  --sysctl net.ipv4.conf.default.forwarding=1 \
  -e API_KEY="$API_KEY" \
  -e ADMIN_EMAIL="$ADMIN_EMAIL" \
  -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e PORT="$MANAGER_PORT" \
  -e STORAGE_ROOT=/var/lib/run-dat-sheesh \
  -e IMAGES_DIR=/var/lib/run-dat-sheesh/images \
  -e AGENT_VSOCK_PORT=8080 \
  -e ROOTFS_CLONE_MODE="${ROOTFS_CLONE_MODE:-auto}" \
  -e ENABLE_SNAPSHOTS="$ENABLE_SNAPSHOTS" \
  -e SNAPSHOT_TEMPLATE_CPU="$SNAPSHOT_TEMPLATE_CPU" \
  -e SNAPSHOT_TEMPLATE_MEM_MB="$SNAPSHOT_TEMPLATE_MEM_MB" \
  -p "${MANAGER_PORT}:${MANAGER_PORT}" \
  -v "$RDS_IMAGES_DIR:/var/lib/run-dat-sheesh/images" \
  -v "$RDS_DATA_DIR:/var/lib/run-dat-sheesh" \
  run-dat-sheesh-manager)

FAILED=0
cleanup() {
  if [ "${FAILED:-0}" -ne 0 ]; then
    echo "=== manager logs (failure) ==="
    docker logs "$CID" || true
  fi
  docker stop "$CID" >/dev/null 2>&1 || true
  docker rm -f "$CID" >/dev/null 2>&1 || true
  rm -rf "$RDS_DATA_DIR" >/dev/null 2>&1 || true
  rm -rf "$RDS_IMAGES_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Waiting for manager..."
wait_for_manager "$API_KEY" || { echo "Manager did not become ready"; FAILED=1; exit 1; }

echo "Uploading Debian + Alpine guest images..."
create_image() {
  local name="$1"
  local description="$2"
  local res
  res=$(curl -sf -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"description\":\"$description\"}" \
    "$MANAGER_BASE/v1/images")
  node -e 'const fs=require("fs"); const s=fs.readFileSync(0,"utf8"); const j=JSON.parse(s); process.stdout.write(j.id);' <<<"$res"
}

upload_file() {
  local image_id="$1"
  local kind="$2"   # kernel|rootfs
  local file_path="$3"
  # Use streaming upload; some curl builds can OOM on very large --data-binary payloads.
  curl -sf -X PUT -H "X-API-Key: $API_KEY" -H "Content-Type: application/octet-stream" \
    --upload-file "$file_path" \
    "$MANAGER_BASE/v1/images/$image_id/$kind" >/dev/null
}

set_default() {
  local image_id="$1"
  curl -sf -X POST -H "X-API-Key: $API_KEY" "$MANAGER_BASE/v1/images/$image_id/set-default" >/dev/null
}

DEBIAN_ID=$(create_image "Debian (integration)" "Built by integration runner")
upload_file "$DEBIAN_ID" "kernel" "$ROOT_DIR/dist/images/debian/vmlinux"
upload_file "$DEBIAN_ID" "rootfs" "$ROOT_DIR/dist/images/debian/rootfs.ext4"
set_default "$DEBIAN_ID"

ALPINE_ID=$(create_image "Alpine (integration)" "Built by integration runner")
upload_file "$ALPINE_ID" "kernel" "$ROOT_DIR/dist/images/alpine/vmlinux"
upload_file "$ALPINE_ID" "rootfs" "$ROOT_DIR/dist/images/alpine/rootfs.ext4"

if [ "$ENABLE_SNAPSHOTS" = "true" ]; then
  echo "Building template snapshot inside manager container..."
  docker exec "$CID" sh -lc 'node dist/index.js snapshot-build' || { echo "Snapshot build failed"; FAILED=1; exit 1; }
fi

echo "Starting test HTTP server inside manager container..."
# Listen on 0.0.0.0 so it stays valid even before the tap interface (172.16.0.1) is created.
docker exec "$CID" sh -lc 'node -e "require(\"http\").createServer((req,res)=>res.end(\"ok\")).listen(18080,\"0.0.0.0\")" >/tmp/test-server.log 2>&1 & echo $! > /tmp/test-server.pid'

export API_KEY
export MANAGER_BASE
export ENABLE_SNAPSHOTS
if [ "$ENABLE_SNAPSHOTS" = "true" ] && [ -n "${SNAPSHOT_MAX_CREATE_MS:-}" ] && [ -z "${MAX_CREATE_MS:-}" ]; then
  export MAX_CREATE_MS="$SNAPSHOT_MAX_CREATE_MS"
else
  export MAX_CREATE_MS=${MAX_CREATE_MS:-}
fi

echo "Running vitest integration suite..."
echo "=== integration: default image (debian) ==="
unset VM_IMAGE_ID
npm -s run test:vitest || { FAILED=1; exit 1; }

echo "=== integration: alpine image ==="
export VM_IMAGE_ID="$ALPINE_ID"
npm -s run test:vitest || { FAILED=1; exit 1; }

