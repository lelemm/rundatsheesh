---
title: Quickstart (Docker Hub)
---

This runs the **published manager image**: `lelemm/rundatsheesh:latest`.

## 1) Create `.env`

Copy the repo defaults and set required values:

```bash
cp env.example .env
```

Required:
- `API_KEY`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

## 2) Prepare host directories

```bash
mkdir -p ./data ./images
```

## 3) Run with Docker Compose

Example compose (minimal) that uses Docker Hub instead of building locally:

```yaml
services:
  manager:
    image: lelemm/rundatsheesh:latest
    read_only: true
    security_opt:
      - no-new-privileges:true
      - seccomp=unconfined
      - apparmor=unconfined
    cap_drop: [ "ALL" ]
    cap_add:
      - NET_ADMIN
      - SYS_ADMIN
      - SYS_CHROOT
      - SETUID
      - SETGID
      - MKNOD
      - CHOWN
      - DAC_OVERRIDE
      - DAC_READ_SEARCH
    tmpfs: [ "/tmp", "/run" ]
    environment:
      API_KEY: ${API_KEY}
      ADMIN_EMAIL: ${ADMIN_EMAIL}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      PORT: 3000
      STORAGE_ROOT: /var/lib/run-dat-sheesh
      IMAGES_DIR: /var/lib/run-dat-sheesh/images
      AGENT_VSOCK_PORT: 8080
    ports:
      - "3000:3000"
    volumes:
      - ./data:/var/lib/run-dat-sheesh
      - ./images:/var/lib/run-dat-sheesh/images
    devices:
      - /dev/kvm:/dev/kvm
      - /dev/vhost-vsock:/dev/vhost-vsock
      - /dev/net/tun:/dev/net/tun
    sysctls:
      net.ipv4.ip_forward: "1"
      net.ipv4.conf.all.forwarding: "1"
      net.ipv4.conf.default.forwarding: "1"
```

Start:

```bash
docker compose up -d
```

## 4) Open the UI + API docs

- Admin UI: `http://localhost:3000/` (login at `/login/`)
- Docusaurus docs: `http://localhost:3000/docs/`
- Swagger UI: `http://localhost:3000/swagger`
- OpenAPI JSON: `http://localhost:3000/openapi.json`

## 5) Upload a guest image

The manager needs a **kernel** (`vmlinux`) and **rootfs** (`rootfs.ext4`). Build one locally (see [Guest image](./guest-image.md)) or upload one you already have:

- UI: go to **Images** and upload `vmlinux` + `rootfs.ext4`
- Then set it as the default image and create VMs.

