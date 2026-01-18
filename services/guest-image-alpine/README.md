# run-dat-sheesh guest image (Alpine)

Builds:
- `dist/vmlinux`
- `dist/rootfs.ext4`

This image aims to be as small as possible on disk by shrinking the ext4 to the minimum filesystem size after creation.

## Build

```bash
./services/guest-image-alpine/build.sh
```

Notes:
- Requires Docker.
- Produces an Alpine-based rootfs with the same guest-agent runtime expectations as the Debian image:
  - `node` at `/usr/local/bin/node` (symlinked to `/usr/bin/node`)
  - `socat` at `/usr/bin/socat`
  - `deno` available via `/home/user/.deno/bin/deno` (symlinked to `/usr/bin/deno`)

