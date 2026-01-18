---
title: System requirements
---

## Host requirements

`run-dat-sheesh` is designed to run on **Linux** hosts with hardware virtualization enabled.

- **Docker** with Compose v2 (`docker compose ...`)
- **CPU virtualization enabled** (Intel VT-x / AMD-V)
- **Devices**
  - `/dev/kvm` (KVM acceleration)
  - `/dev/vhost-vsock` (vsock transport)
  - `/dev/net/tun` (TUN/TAP for VM networking)

## Kernel modules (common)

Intel:

```bash
sudo modprobe kvm
sudo modprobe kvm_intel
sudo modprobe vsock
sudo modprobe vhost_vsock
sudo modprobe tun
```

AMD:

```bash
sudo modprobe kvm
sudo modprobe kvm_amd
sudo modprobe vsock
sudo modprobe vhost_vsock
sudo modprobe tun
```

Verify:

```bash
ls -la /dev/kvm /dev/vhost-vsock /dev/net/tun
```

## Container privileges

The manager container orchestrates Firecracker + networking. In Compose, it runs hardened (read-only rootfs, `no-new-privileges`, dropped caps) and then selectively adds required caps:

- `NET_ADMIN`
- `SYS_ADMIN`, `SYS_CHROOT`
- `SETUID`, `SETGID`
- `MKNOD`, `CHOWN`
- `DAC_OVERRIDE`, `DAC_READ_SEARCH`

These are required for Firecracker jailer and for configuring TAP/NAT on the host network namespace.

