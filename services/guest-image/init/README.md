## guest-init (PID1)

This directory contains the minimal C init program used as `/sbin/init` inside the guest rootfs.

It is compiled into the rootfs during the guest image Docker build (see `services/guest-image/Dockerfile`).

