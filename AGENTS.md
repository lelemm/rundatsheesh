This repository is an API-only Firecracker sandbox runner called run-dat-sheesh.

Overview
- Manager service: Node.js + Fastify API that provisions and controls Firecracker microVMs.
- Guest agent: Node.js Fastify app running inside the microVM, reachable via vsock.
- Guest image: build pipeline that produces a Firecracker-compatible kernel + rootfs.

Architecture summary
- Manager API runs in a privileged Docker container with /dev/kvm and NET_ADMIN.
- Manager orchestrates microVM lifecycle and talks to the guest agent over vsock
  using socat as a minimal transport.
- All untrusted execution inside the VM runs as user "user" (uid/gid 1000).
- File operations are restricted to /home/user and use tar.gz streams.

Key paths
- Manager service: services/manager
- Guest agent: services/guest-agent
- Guest image build: services/guest-image
- Integration tests: tests/integration/run.sh

Primary commands
- Build guest artifacts: ./scripts/build-guest-image.sh
- Run integration test: make integration
- Full validation: make verify

Important behavior and constraints
- Manager expects env vars:
  - API_KEY, KERNEL_PATH, BASE_ROOTFS_PATH, STORAGE_ROOT, AGENT_VSOCK_PORT
- Guest init bridges vsock -> TCP for the agent via socat.
- File uploads/downloads are tar.gz; symlinks and traversal are rejected.
- Deno is used for TypeScript execution inside the VM.

Known issue to investigate
- Integration exec currently returns {} instead of stdout.
  This likely indicates an incomplete vsock HTTP response read or a guest-side
  response issue. Reproduce via tests/integration/run.sh and inspect raw vsock
  response if needed.
