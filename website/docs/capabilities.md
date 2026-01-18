---
title: Capabilities (what the sandbox can do)
---

## Core capabilities

- **MicroVM lifecycle**: create/start/stop/destroy Firecracker microVMs via the manager API.
- **Command execution**: run shell commands inside the VM as uid/gid **1000** (user `user`).
- **TypeScript execution**: run TypeScript via **Deno** (`run-ts`), with restricted permissions.
- **Files API**: upload/download **tar.gz** archives, restricted to `/home/user` (symlinks/traversal rejected).
- **Networking controls**:
  - per-VM firewall allowlist (`allowIps`) + optional `outboundInternet`
  - guest networking configured by the manager (tap/NAT on host; eth0 in guest)
- **Snapshots (optional)**:
  - enabled by `ENABLE_SNAPSHOTS=true`
  - snapshot/restore flows preserve a disk baseline so `/home/user` files (e.g. uploaded SDK) can be reused

## Isolation properties (important)

This is not “just containers”:
- untrusted code runs inside a **Firecracker microVM**
- `exec` is additionally **chrooted** to `/home/user` so the guest OS filesystem is not visible

## What untrusted code can access

- **File system**: only `/home/user` (both for `exec` and for `run-ts` read/write permissions)
- **Network**:
  - controlled by allowlist + `outboundInternet` policy
  - `run-ts` can request `allowNet`, but it is still subject to the firewall policy applied by the manager/agent

## Output limits

The guest agent caps stdout/stderr buffering (to avoid memory blowups) and supports timeouts per request.

