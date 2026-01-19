## run-dat-sheesh

API-only **Firecracker microVM sandbox runner**.

It runs untrusted code **inside a Firecracker microVM**, exposes a small manager API to create/stop VMs and execute commands, and communicates with a guest-side agent over **vsock**.

### What’s in this repo

- **`services/manager` (manager API)**: Node.js + Fastify API that provisions/controls Firecracker microVMs, manages VM networking/storage, and proxies requests to the guest agent over vsock.
- **`services/guest-agent` (guest agent)**: Node.js + Fastify app that runs *inside* the microVM and provides `/exec`, `/run-ts`, `/files/*`, `/firewall/*` endpoints.
- **`services/guest-image` (guest image build)**: Docker build pipeline that produces `vmlinux` + `rootfs.ext4` artifacts used to boot the microVM.
  - Includes a minimal PID1 init (`services/guest-image/init/guest-init.c`) that brings up loopback and starts the agent + a vsock<->TCP bridge (via `socat`).
- **`tests/integration`**: integration suite that boots a VM and verifies exec/files/run-ts flows (skips automatically if KVM/vsock are unavailable).
- **`n8n-nodes-run-dat-seesh/`**: an n8n community node package to talk to the manager API (separate from the core runner).

### High-level architecture

- The **manager** runs “host-side” orchestration logic in a privileged container (needs `/dev/kvm` + vsock device + `NET_ADMIN` for TAP/NAT).
- The **guest agent** runs inside the VM and executes as user **`user` (uid/gid 1000)**.
- File upload/download is done via **tar.gz streams** and is confined to **`/workspace`**; traversal and symlinks are rejected.
- TypeScript execution uses **Deno** inside the guest.

---

## Running with Docker Compose (recommended)

### Prerequisites (host)

- **Docker** (Compose v2: `docker compose ...`)
- **CPU virtualization enabled** (Intel VT-x / AMD-V)
- **Linux kernel modules/devices**:
  - KVM: `/dev/kvm`
  - vsock: `/dev/vhost-vsock` (and kernel modules `vsock` + `vhost_vsock`)
  - (Networking) TUN/TAP support is typically required for guest networking: `/dev/net/tun`

### Build guest artifacts (kernel + rootfs)

The compose file mounts `./services/guest-image/dist` into the manager container at `/artifacts`, so you must build these first:

```bash
./scripts/build-guest-image.sh
```

You should now have:

- `services/guest-image/dist/vmlinux`
- `services/guest-image/dist/rootfs.ext4`

### Start the manager

```bash
# Copy env.example -> .env and edit values (recommended)
cp env.example .env

# Then start (Caddy will be the public entrypoint on :443/:80)
docker compose up --build
```

Manager API:

- **Base URL**: `https://<RDS_DOMAIN>` (for local dev: `https://localhost`)
- **Auth header**: `X-API-Key: <API_KEY>`
- **Swagger UI**: `https://<RDS_DOMAIN>/docs`
- **OpenAPI JSON**: `https://<RDS_DOMAIN>/openapi.json`

### Quick API example

Create a VM:

```bash
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -d '{"cpu":1,"memMb":256,"allowIps":["172.16.0.1/32"],"outboundInternet":true}' \
  https://localhost/v1/vms
```

Execute a command:

```bash
VM_ID="<put-id-here>"
curl -sS -H "X-API-Key: dev-key" \
  -H "content-type: application/json" \
  -d '{"cmd":"id && echo hello"}' \
  "https://localhost/v1/vms/${VM_ID}/exec"
```

Note: when using `RDS_DOMAIN=localhost`, Caddy uses a locally-issued TLS cert; you may need `curl -k` unless you trust Caddy’s local CA.

---

## Environment variables

### Manager (`services/manager`)

These are read by the manager container at startup:

- **`API_KEY` (required)**: API key expected in the `X-API-Key` header for all `/v1/*` endpoints (docs/spec endpoints remain public).
- **`PORT` (default `3000`)**: HTTP port the manager binds to.
- **`KERNEL_PATH` (required)**: path to the guest kernel image (`vmlinux`) *inside the container*.
  - Compose default: `/artifacts/vmlinux`
- **`BASE_ROOTFS_PATH` (required)**: path to the base guest rootfs (`rootfs.ext4`) *inside the container*.
  - Compose default: `/artifacts/rootfs.ext4`
- **`STORAGE_ROOT` (default `/var/lib/run-dat-sheesh`)**: where per-VM state is stored (cloned rootfs, logs, snapshots).
- **`AGENT_VSOCK_PORT` (default `8080`)**: vsock port used to reach the guest agent.
- **`FIRECRACKER_BIN` (default `firecracker`)**: Firecracker binary path/name in the manager container.
- **`ROOTFS_CLONE_MODE` (default `auto`)**: how to create per-VM rootfs clones from `BASE_ROOTFS_PATH`.
  - `auto`: choose best available
  - `reflink`: copy-on-write clone (requires filesystem support)
  - `copy`: full copy
- **`ENABLE_SNAPSHOTS` (default `false`)**: enable snapshot endpoints and snapshot restore support.
- **`SNAPSHOT_TEMPLATE_CPU` (default `1`)**: vCPU count for the “template snapshot” builder.
- **`SNAPSHOT_TEMPLATE_MEM_MB` (default `256`)**: memory size for the “template snapshot” builder.

### Docker Compose convenience variables

These are only used by `docker-compose.yml` (not read by the app directly):

- **`RUN_DAT_SHEESH_DATA_DIR` (default `./data`)**: host directory mounted to the container’s `STORAGE_ROOT` (`/var/lib/run-dat-sheesh`) for persistence.

### Guest agent (`services/guest-agent`)

Inside the VM, the guest agent reads:

- **`PORT` (default `8080`)**: HTTP port the agent listens on (the guest init/vsock bridge connects to this).

---

## Required kernel modules (host) + how to load them

### What you typically need

- **KVM acceleration**
  - `kvm` + one of `kvm_intel` or `kvm_amd`
  - device: `/dev/kvm`
- **vsock (host transport)**
  - `vsock` + `vhost_vsock`
  - device: `/dev/vhost-vsock` (sometimes also `/dev/vsock`)
- **TUN/TAP (networking)**
  - `tun`
  - device: `/dev/net/tun`

### One-time load for testing

Intel:

```bash
sudo modprobe kvm
sudo modprobe kvm_intel
sudo modprobe vsock
sudo modprobe vhost_vsock
sudo modprobe tun
```

AMD:

```bash
sudo modprobe kvm
sudo modprobe kvm_amd
sudo modprobe vsock
sudo modprobe vhost_vsock
sudo modprobe tun
```

Quick verification:

```bash
ls -la /dev/kvm /dev/vhost-vsock /dev/net/tun
lsmod | egrep '^(kvm|kvm_intel|kvm_amd|vsock|vhost_vsock|tun)\b' || true
```

### Debian/Ubuntu: enable modules permanently

On systemd-based Debian/Ubuntu, create a modules-load file:

```bash
sudo tee /etc/modules-load.d/run-dat-sheesh.conf >/dev/null <<'EOF'
kvm
vsock
vhost_vsock
tun
EOF
```

Then add the CPU-specific KVM module (pick one):

```bash
echo kvm_intel | sudo tee /etc/modules-load.d/kvm-intel.conf >/dev/null
# OR
echo kvm_amd   | sudo tee /etc/modules-load.d/kvm-amd.conf >/dev/null
```

Apply without reboot (or just reboot):

```bash
sudo systemctl restart systemd-modules-load.service
```

Notes:

- If `/dev/kvm` is still missing, ensure virtualization is enabled in BIOS/UEFI and that your CPU exposes `vmx` (Intel) or `svm` (AMD): `egrep -c '(vmx|svm)' /proc/cpuinfo`.
- If you’re running inside a VM, you may need **nested virtualization** enabled by your hypervisor.

---

## Development & verification

### Install deps + build

```bash
make deps
make build
```

### Run tests

```bash
make unit
make integration
```

Full validation:

```bash
make verify
```

