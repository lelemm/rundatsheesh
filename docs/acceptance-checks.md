# run-dat-sheesh MVP acceptance checks

Status: not executed (requires Firecracker + guest image + rootfs artifacts).

## Core Functionality Checklist:
- Create VM -> agent health via vsock responds
- Exec returns uid=1000 (user)
- Upload tar.gz -> files appear under /home/user
- Download file/dir works
- Run TS with Deno (strict permissions)
- Firewall allowlist applied in guest

## OverlayFS Mode Checklist:
- Overlay isolation: writes to /tmp in VM A not visible in VM B
- Overlay writes: can write to /tmp, /var/tmp (overlay captures changes)
- Fast provisioning: VM creation < 2s (with overlayfs, typically < 500ms)
- Writes persist: files written to /tmp persist within VM lifecycle
- Disk efficiency: overlay disk starts small (sparse file)
