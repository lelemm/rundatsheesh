# run-dat-sheesh manager Docker

## Build

```bash
./scripts/build-manager-image.sh
```

## Run (docker-compose)

```bash
API_KEY=dev-key docker compose up --build
```

Requirements:
- Host has `/dev/kvm` available.
- Container runs with `--privileged` and `NET_ADMIN`.
- Guest artifacts available at `services/guest-image/dist/vmlinux` and `rootfs.ext4`.

## Separation of concerns (high level)

- **Manager** (`services/manager`): Fastify API and host-side orchestration (Firecracker process, networking, storage, vsock transport to the guest).
- **Guest agent** (`services/guest-agent`): Fastify API running inside the microVM (exec/run-ts/files/firewall endpoints).
- **Guest image build** (`services/guest-image`): Docker build pipeline producing kernel + rootfs artifacts for the microVM.
  - PID1 init is compiled from `services/guest-image/init/guest-init.c`.
  - Rootfs/kernel provisioning steps are organized under `services/guest-image/scripts/`.
  - Static rootfs overlay lives under `services/guest-image/rootfs-overlay/`.

Environment variables:
- `API_KEY` (required)
- `KERNEL_PATH` (default `/artifacts/vmlinux` in compose)
- `BASE_ROOTFS_PATH` (default `/artifacts/rootfs.ext4` in compose)
- `STORAGE_ROOT` (default `/var/lib/run-dat-sheesh`)
- `AGENT_VSOCK_PORT` (default `8080`)
- `ROOTFS_CLONE_MODE` (default `auto`; one of `auto|reflink|copy`)
- `ENABLE_SNAPSHOTS` (default `false`)
- `SNAPSHOT_TEMPLATE_CPU` (default `1`)
- `SNAPSHOT_TEMPLATE_MEM_MB` (default `256`)
