---
title: run-dat-sheesh
slug: /
---

`run-dat-sheesh` is an **API-only Firecracker microVM sandbox runner**.

It runs untrusted code **inside a Firecracker microVM**, with a host-side **manager API** (Fastify) that provisions microVMs and proxies requests to a guest-side **agent** (Fastify) over **vsock**.

## Architecture (high level)

```mermaid
flowchart LR
  Client[Client] -->|HTTPS| Caddy[Caddy]
  Caddy -->|HTTP| Manager[Manager_API]
  Manager -->|Firecracker_API| Firecracker[Firecracker]
  Manager -->|vsock_over_UDS| Vsock[Vsock_UDS]
  Vsock -->|CONNECT_8080| Socat[Guest_socat]
  Socat -->|TCP_127.0.0.1:8080| Agent[Guest_Agent]
  Agent --> Exec[Exec_and_RunTS]
  Agent --> Files[Files_TarGz]
  Agent --> Firewall[Firewall_Allowlist]
```

## Quick links
- **Quickstart (Docker Hub)**: see [Quickstart](./quickstart.md)
- **Build guest image**: see [Guest image](./guest-image.md)
- **Environment variables**: see [Env vars](./env-vars.md)
- **API usage**: see [API](./api.md) (or open [Swagger](../swagger))

