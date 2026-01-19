---
title: Guest image (kernel + rootfs)
---

The manager boots Firecracker microVMs from a **kernel** (`vmlinux`) plus a **root filesystem** (`rootfs.ext4`).

## Build a guest image (Debian)

From the repo root:

```bash
./scripts/build-guest-image.sh
```

Outputs:
- `services/guest-image/dist/vmlinux`
- `services/guest-image/dist/rootfs.ext4`

There is also a convenience builder that produces both Debian + Alpine artifacts under `./dist/images/*`:

```bash
make guest-images
```

## What a guest image must have to work

At minimum, a compatible image must provide:

### 1) A working `/sbin/init` (PID 1)

This project uses a tiny C init (`services/guest-image/init/guest-init.c`) compiled into the rootfs as `/sbin/init`.

It is responsible for:
- mounting `/proc`, `/sys`, `/dev`
- bringing up loopback (`lo`) so `127.0.0.1` works
- starting the guest agent
- starting a **vsock -> TCP** bridge via `socat`

### 2) Guest agent reachable on vsock port 8080

The manager speaks HTTP over vsock. In the default image:
- guest agent listens on TCP `127.0.0.1:8080`
- `socat VSOCK-LISTEN:8080,fork TCP:127.0.0.1:8080` bridges vsock to the agent

Guest agent endpoints include:
- `POST /exec`
- `POST /run-ts`
- `POST /files/upload` (tar.gz)
- `GET /files/download` (tar.gz)
- `POST /firewall/allowlist`

### 3) User isolation model: uid/gid 1000 and `/workspace`

The guest image creates a user `user` with uid/gid **1000** and a writable workspace mapped at `/workspace` (backed by `/home/user` on disk).

Important behavior:
- `exec` runs **chrooted** and treats `/workspace` as the only supported filesystem root for user operations
- file upload/download is restricted to **`/workspace`** and uses tar.gz streams
- symlinks and traversal are rejected

### 4) Toolchain inside the jail (BusyBox + staged tools)

Because `exec` runs inside a minimal chroot jail, a small toolchain is available there (BusyBox plus staged binaries like `git`, `node`, `npm`, `tar`, and `deno`).

### 5) Deno for `run-ts`

`run-ts` uses **Deno** and executes with restricted permissions:
- `--allow-read=/workspace` (plus minimal `/etc/*` reads needed for DNS + TLS)
- `--allow-write=/workspace`
- optional `--allow-net` if requested (and still subject to firewall allowlist)
- env vars: when the API request includes `env: ["KEY=value", ...]`, `run-ts` will allow access to only those keys (so `Deno.env.get("KEY")` works)
- structured return: scripts can call `result.set(value)` / `result.error(err)` and the manager will include `result` / `error` fields in the response JSON

## Uploading images to the manager

You can either:
- set `KERNEL_PATH` + `BASE_ROOTFS_PATH` (for “built-in” base images inside the manager container), or
- upload images via the **Images** API/UI (artifacts stored under `IMAGES_DIR`)

