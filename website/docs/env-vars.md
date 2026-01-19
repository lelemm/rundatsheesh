---
title: Environment variables
---

This page lists env vars used by the **manager** (host side) and **guest agent** (inside the VM).

## Manager (`services/manager`)

### Required
- `API_KEY`: required; expected in `X-API-Key` for all `/v1/*` endpoints (unless using an admin session cookie).
- `ADMIN_EMAIL`: required; admin console login email.
- `ADMIN_PASSWORD`: required; admin console login password.

### Common
- `PORT` (default `3000`): HTTP port for the manager.
- `STORAGE_ROOT` (default `/var/lib/run-dat-sheesh`): per-VM storage, logs, snapshots.
- `IMAGES_DIR` (default `${STORAGE_ROOT}/images`): where uploaded guest images (kernel/rootfs) are stored.
- `AGENT_VSOCK_PORT` (default `8080`): vsock port used to reach the guest agent.

### Guest image selection
- `KERNEL_PATH` (optional): “built-in” kernel image path inside the container.
- `BASE_ROOTFS_PATH` (optional): “built-in” base rootfs path inside the container.
- `DNS_SERVER_IP` (optional): override the DNS resolver (nameserver) configured inside microVMs.
  - Default: unset (guest uses the VM gateway IP as DNS).
  - Set this if your gateway does not provide DNS, e.g. `1.1.1.1` (and ensure your egress allowlist permits it).

### Database
- `DB_DIALECT` (default `sqlite`): `sqlite` or `postgres`.
- `SQLITE_PATH` (default `./db/manager.db`): sqlite file path (set to `/var/lib/run-dat-sheesh/manager.db` in containers).
- `DATABASE_URL`: required if `DB_DIALECT=postgres`.

### Firecracker / jailer
- `FIRECRACKER_BIN` (default `/usr/local/bin/firecracker`)
- `JAILER_BIN` (default `/usr/local/bin/jailer`)
- `JAILER_CHROOT_BASE_DIR` (default `${STORAGE_ROOT}/jailer`) **must be an absolute path**
- `JAILER_UID` (default `1234`)
- `JAILER_GID` (default `1234`)

### Rootfs provisioning behavior
- `ROOTFS_CLONE_MODE` (default `auto`): `auto`, `reflink`, or `copy`.

### Snapshots
- `ENABLE_SNAPSHOTS` (default `false`)
- `SNAPSHOT_TEMPLATE_CPU` (default `1`)
- `SNAPSHOT_TEMPLATE_MEM_MB` (default `256`)

### Limits (resource safety)
- `MAX_VMS` (default `20`)
- `MAX_CPU` (default `4`)
- `MAX_MEM_MB` (default `2048`)
- `MAX_ALLOW_IPS` (default `64`)
- `MAX_EXEC_TIMEOUT_MS` (default `120000`)
- `MAX_RUNTS_TIMEOUT_MS` (default `120000`)

### Vsock transport tuning
- `VSOCK_RETRY_ATTEMPTS` (default `30`)
- `VSOCK_RETRY_DELAY_MS` (default `100`)
- `VSOCK_TIMEOUT_MS` (default `15000`)
- `VSOCK_HEALTH_TIMEOUT_MS` (default `15000`)
- `VSOCK_BINARY_TIMEOUT_MS` (default `30000`)
- `VSOCK_MAX_JSON_RESPONSE_BYTES` (default `2000000`)
- `VSOCK_MAX_BINARY_RESPONSE_BYTES` (default `50000000`)

## Guest agent (`services/guest-agent`)

The guest init sets `PORT=8080` when starting the agent.

- `PORT` (default `8080`): HTTP port the guest agent listens on inside the VM.

