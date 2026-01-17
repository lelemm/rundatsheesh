run-dat-sheesh status overview

What is implemented
- Manager API (Fastify) with VM lifecycle + exec/run-ts/files endpoints.
- Firecracker integration (spawn, API socket config, vsock device).
- Host networking (TAP + NAT for outbound when enabled).
- Storage provider that clones rootfs per VM.
- Guest agent endpoints: /health, /exec, /run-ts, /files/upload, /files/download.
- Guest agent hardening:
  - Executes as user uid/gid 1000.
  - Enforces /home/user path confinement.
  - Tar extraction rejects traversal and symlinks.
  - Deno runs with strict read/write permissions.
- Dockerized manager image with Firecracker binary installed.
- Guest image build pipeline (kernel + rootfs + agent + Deno/Node), now modularized:
  - Kernel build script with required virtio/vsock/serial options.
  - Rootfs build script with retries for debootstrap and Node/Deno install.
  - Minimal rootfs overlay + dedicated C init (PID1) that brings up loopback and starts agent + socat bridge.
- Vsock agent transport is reliable:
  - Uses Firecracker vsock UDS handshake ("CONNECT <port>" -> "OK <port>") before sending HTTP.
  - Retries handshake-only/empty responses until the guest is ready.
  - Correct HTTP response parsing so exec/run-ts return stdout/stderr.
- Integration test script that boots a VM and verifies exec/file/TS flows.
- Makefile with verify target: deps -> build -> test (unit + integration).
- Guest firewall allowlist implementation.
- Consider snapshots/overlay for faster VM provisioning.


What is missing or incomplete
- Manager reconciliation on startup for orphaned VMs/resources.
- Logging endpoints and audit trail are not implemented.
- Hardening beyond MVP (jailer, overlay/snapshot disks, per-exec sandbox).
- Robust error mapping in manager API (currently minimal).

Next recommended steps
- Add reconciler for cleanup on manager startup.
- Add logs endpoint(s) for Firecracker/agent output.

