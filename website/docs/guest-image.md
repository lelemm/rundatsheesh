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

### 3) User isolation model: uid/gid 1000 and `/home/user`

The guest image creates a user `user` with uid/gid **1000** and a home directory `/home/user`.

Important behavior:
- `exec` runs **chrooted to `/home/user`** (so `/etc`, `/proc`, `/usr`, etc. are not visible to untrusted code)
- file upload/download is restricted to **`/home/user`** and uses tar.gz streams
- symlinks and traversal are rejected

### 4) Toolchain inside `/home/user` (BusyBox)

Because `exec` is chrooted to `/home/user`, a minimal command environment is installed there:
- `/home/user/bin/busybox` plus symlinks (via `busybox --install -s`)
- minimal `/home/user/dev/*` nodes like `null`, `zero`, `urandom`, etc.

### 5) Deno for `run-ts`

`run-ts` uses **Deno** installed into `/home/user/.deno` and executes with restricted permissions:
- `--allow-read=/home/user`
- `--allow-write=/home/user`
- optional `--allow-net` if requested (and still subject to firewall allowlist)

## Uploading images to the manager

You can either:
- set `KERNEL_PATH` + `BASE_ROOTFS_PATH` (for “built-in” base images inside the manager container), or
- upload images via the **Images** API/UI (artifacts stored under `IMAGES_DIR`)

