# run-dat-sheesh MVP acceptance checks

Status: not executed (requires Firecracker + guest image + rootfs artifacts).

Checklist:
- Create VM -> agent health via vsock responds
- Exec returns uid=1000 (user)
- Upload tar.gz -> files appear under /home/user
- Download file/dir works
- Run TS with Deno (strict permissions)
- Firewall allowlist applied in guest
