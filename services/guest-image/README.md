# run-dat-sheesh guest image

Builds:
- `dist/vmlinux`
- `dist/rootfs.ext4`

## Build

```bash
./services/guest-image/build.sh
```

Notes:
- Requires Docker.
- Build downloads kernel sources and compiles a Firecracker-compatible kernel.
- Rootfs includes guest agent, Deno, Node, and a `user` account.
