---
title: Build from source
---

## Repo layout

- `services/manager`: Manager API (host-side orchestration)
- `services/guest-agent`: Guest agent (inside the VM)
- `services/guest-image`: Guest image build pipeline (kernel + rootfs.ext4)
- `tests/integration`: integration tests

## Install dependencies

From the repo root:

```bash
make deps
```

## Build everything

```bash
make build
```

This builds:
- manager + admin UI
- guest agent
- guest images (via `./scripts/build-guest-images.sh`)
- manager docker image (via `./scripts/build-manager-image.sh`)

## Run integration tests

```bash
make integration
```

Integration tests require host KVM/vsock. If unavailable, tests may skip automatically.

