import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import type { FirecrackerManager } from "../types/interfaces.js";
import type { VmRecord } from "../types/vm.js";
import {
  firecrackerApiSocketPath,
  firecrackerVsockUdsPath,
  inChrootPathForHostPath,
  jailerRootDir,
  jailerVmDir
} from "./socketPaths.js";

export interface FirecrackerOptions {
  firecrackerBin: string;
  jailerBin: string;
  jailerChrootBaseDir: string;
  jailerUid: number;
  jailerGid: number;
}

export class FirecrackerManagerImpl implements FirecrackerManager {
  private readonly processes = new Map<string, ReturnType<typeof spawn>>();

  constructor(private readonly options: FirecrackerOptions) {}

  async createAndStart(vm: VmRecord, rootfsPath: string, kernelPath: string, tapName: string): Promise<void> {
    const jailRoot = jailerRootDir(this.options.jailerChrootBaseDir, vm.id);
    const apiSockHost = firecrackerApiSocketPath(this.options.jailerChrootBaseDir, vm.id);
    await fs.rm(apiSockHost, { force: true }).catch(() => undefined);

    // Configure Firecracker to write detailed logs/metrics to the VM logs dir.
    const fcLogPath = path.join(vm.logsDir, "firecracker.log");
    const fcMetricsPath = path.join(vm.logsDir, "firecracker.metrics");

    // Firecracker expects these paths to be valid and writable at startup.
    await fs.mkdir(vm.logsDir, { recursive: true });
    // Firecracker runs as an unprivileged uid/gid after jailer drops privileges.
    // Make sure it can write its log/metrics files even if the manager created them as root.
    await fs.chmod(vm.logsDir, 0o777).catch(() => undefined);
    await fs.appendFile(fcLogPath, "");
    await fs.appendFile(fcMetricsPath, "");
    await fs.chmod(fcLogPath, 0o666).catch(() => undefined);
    await fs.chmod(fcMetricsPath, 0o666).catch(() => undefined);

    const apiSockInChroot = inChrootPathForHostPath(jailRoot, apiSockHost);
    const fcLogInChroot = inChrootPathForHostPath(jailRoot, fcLogPath);
    const fcMetricsInChroot = inChrootPathForHostPath(jailRoot, fcMetricsPath);

    const proc = spawn(
      this.options.jailerBin,
      [
        "--id",
        vm.id,
        "--exec-file",
        this.options.firecrackerBin,
        "--uid",
        String(this.options.jailerUid),
        "--gid",
        String(this.options.jailerGid),
        "--chroot-base-dir",
        this.options.jailerChrootBaseDir,
        "--",
        "--api-sock",
        apiSockInChroot,
        "--log-path",
        fcLogInChroot,
        "--level",
        "Debug",
        "--show-level",
        "--show-log-origin",
        "--metrics-path",
        fcMetricsInChroot
      ],
      {
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    this.processes.set(vm.id, proc);

    // Keep a small preview of jailer/firecracker stderr/stdout so failures are diagnosable
    // even when the API socket never comes up.
    const stdoutPreview: Buffer[] = [];
    const stderrPreview: Buffer[] = [];
    const capPreview = (arr: Buffer[], chunk: Buffer) => {
      const max = 8 * 1024;
      const current = arr.reduce((n, b) => n + b.length, 0);
      if (current >= max) return;
      arr.push(chunk.subarray(0, Math.min(chunk.length, max - current)));
    };
    proc.stdout?.on("data", (c) => capPreview(stdoutPreview, Buffer.from(c)));
    proc.stderr?.on("data", (c) => capPreview(stderrPreview, Buffer.from(c)));

    // Capture microVM serial output (console=ttyS0) and Firecracker logs for debugging.
    // This is especially useful when the guest agent fails to come up.
    try {
      const stdoutLog = createWriteStream(path.join(vm.logsDir, "firecracker.stdout.log"), { flags: "a" });
      const stderrLog = createWriteStream(path.join(vm.logsDir, "firecracker.stderr.log"), { flags: "a" });
      // Never crash the manager on log I/O errors (e.g., permission changes inside the jail root).
      stdoutLog.on("error", () => undefined);
      stderrLog.on("error", () => undefined);
      proc.stdout?.pipe(stdoutLog);
      proc.stderr?.pipe(stderrLog);
      proc.on("close", () => {
        stdoutLog.end();
        stderrLog.end();
      });
    } catch {
      // Best-effort only; do not fail VM start if logging can't be initialized.
    }

    try {
      await waitForSocket(apiSockHost, 15000);
    } catch (err) {
      const stderrText = Buffer.concat(stderrPreview).toString("utf-8");
      const stdoutText = Buffer.concat(stdoutPreview).toString("utf-8");
      throw new Error(
        `Firecracker API socket not ready (vmId=${vm.id}, exitCode=${proc.exitCode ?? "null"}): ${String(
          (err as any)?.message ?? err
        )}\n[jailer-stdout]\n${stdoutText}\n[jailer-stderr]\n${stderrText}`
      );
    }

    await this.request(apiSockHost, "PUT", "/machine-config", {
      vcpu_count: vm.cpu,
      mem_size_mib: vm.memMb,
      smt: false
    });

    const kernelInChroot = inChrootPathForHostPath(jailRoot, kernelPath);
    const rootfsInChroot = inChrootPathForHostPath(jailRoot, rootfsPath);

    await this.request(apiSockHost, "PUT", "/boot-source", {
      kernel_image_path: kernelInChroot,
      // rootfs is attached as the first virtio-blk device (typically /dev/vda)
      boot_args:
        [
          "console=ttyS0,115200",
          "earlycon=uart8250,io,0x3f8,115200n8",
          "reboot=k",
          "panic=1",
          "pci=off",
          "root=/dev/vda",
          "rootfstype=ext4",
          "rw",
          "rootwait",
          "init=/sbin/init",
          // Bring up guest networking without userspace DHCP/systemd.
          // Format: ip=<client-ip>::<gateway-ip>:<netmask>:<hostname>:<device>:<autoconf>
          `ip=${vm.guestIp}::172.16.0.1:255.255.255.0::eth0:off`
        ].join(" ")
    });

    await this.request(apiSockHost, "PUT", "/drives/rootfs", {
      drive_id: "rootfs",
      path_on_host: rootfsInChroot,
      is_root_device: true,
      is_read_only: false
    });

    await this.request(apiSockHost, "PUT", "/network-interfaces/eth0", {
      iface_id: "eth0",
      host_dev_name: tapName,
      guest_mac: generateMac(vm.id)
    });

    const vsockUdsHost = firecrackerVsockUdsPath(this.options.jailerChrootBaseDir, vm.id);
    const vsockUdsInChroot = inChrootPathForHostPath(jailRoot, vsockUdsHost);
    await this.request(apiSockHost, "PUT", "/vsock", {
      guest_cid: vm.vsockCid,
      uds_path: vsockUdsInChroot
    });

    await this.request(apiSockHost, "PUT", "/actions", {
      action_type: "InstanceStart"
    });
  }

  async restoreFromSnapshot(
    vm: VmRecord,
    rootfsPath: string,
    kernelPath: string,
    tapName: string,
    snapshot: { memPath: string; statePath: string }
  ): Promise<void> {
    const jailRoot = jailerRootDir(this.options.jailerChrootBaseDir, vm.id);
    const apiSockHost = firecrackerApiSocketPath(this.options.jailerChrootBaseDir, vm.id);
    await fs.rm(apiSockHost, { force: true }).catch(() => undefined);

    const fcLogPath = path.join(vm.logsDir, "firecracker.log");
    const fcMetricsPath = path.join(vm.logsDir, "firecracker.metrics");
    await fs.mkdir(vm.logsDir, { recursive: true });
    await fs.chmod(vm.logsDir, 0o777).catch(() => undefined);
    await fs.appendFile(fcLogPath, "");
    await fs.appendFile(fcMetricsPath, "");
    await fs.chmod(fcLogPath, 0o666).catch(() => undefined);
    await fs.chmod(fcMetricsPath, 0o666).catch(() => undefined);

    const apiSockInChroot = inChrootPathForHostPath(jailRoot, apiSockHost);
    const fcLogInChroot = inChrootPathForHostPath(jailRoot, fcLogPath);
    const fcMetricsInChroot = inChrootPathForHostPath(jailRoot, fcMetricsPath);

    const proc = spawn(
      this.options.jailerBin,
      [
        "--id",
        vm.id,
        "--exec-file",
        this.options.firecrackerBin,
        "--uid",
        String(this.options.jailerUid),
        "--gid",
        String(this.options.jailerGid),
        "--chroot-base-dir",
        this.options.jailerChrootBaseDir,
        "--",
        "--api-sock",
        apiSockInChroot,
        "--log-path",
        fcLogInChroot,
        "--level",
        "Debug",
        "--show-level",
        "--show-log-origin",
        "--metrics-path",
        fcMetricsInChroot
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    this.processes.set(vm.id, proc);

    const stdoutPreview: Buffer[] = [];
    const stderrPreview: Buffer[] = [];
    const capPreview = (arr: Buffer[], chunk: Buffer) => {
      const max = 8 * 1024;
      const current = arr.reduce((n, b) => n + b.length, 0);
      if (current >= max) return;
      arr.push(chunk.subarray(0, Math.min(chunk.length, max - current)));
    };
    proc.stdout?.on("data", (c) => capPreview(stdoutPreview, Buffer.from(c)));
    proc.stderr?.on("data", (c) => capPreview(stderrPreview, Buffer.from(c)));

    try {
      const stdoutLog = createWriteStream(path.join(vm.logsDir, "firecracker.stdout.log"), { flags: "a" });
      const stderrLog = createWriteStream(path.join(vm.logsDir, "firecracker.stderr.log"), { flags: "a" });
      stdoutLog.on("error", () => undefined);
      stderrLog.on("error", () => undefined);
      proc.stdout?.pipe(stdoutLog);
      proc.stderr?.pipe(stderrLog);
      proc.on("close", () => {
        stdoutLog.end();
        stderrLog.end();
      });
    } catch {
      // Best-effort only.
    }

    try {
      await waitForSocket(apiSockHost, 15000);
    } catch (err) {
      const stderrText = Buffer.concat(stderrPreview).toString("utf-8");
      const stdoutText = Buffer.concat(stdoutPreview).toString("utf-8");
      throw new Error(
        `Firecracker API socket not ready (vmId=${vm.id}, exitCode=${proc.exitCode ?? "null"}): ${String(
          (err as any)?.message ?? err
        )}\n[jailer-stdout]\n${stdoutText}\n[jailer-stderr]\n${stderrText}`
      );
    }

    // Configure devices similarly to the boot path; snapshot load expects a compatible config.
    await this.request(apiSockHost, "PUT", "/machine-config", {
      vcpu_count: vm.cpu,
      mem_size_mib: vm.memMb,
      smt: false
    });

    const kernelInChroot = inChrootPathForHostPath(jailRoot, kernelPath);
    const rootfsInChroot = inChrootPathForHostPath(jailRoot, rootfsPath);

    await this.request(apiSockHost, "PUT", "/boot-source", {
      kernel_image_path: kernelInChroot,
      boot_args:
        [
          "console=ttyS0,115200",
          "earlycon=uart8250,io,0x3f8,115200n8",
          "reboot=k",
          "panic=1",
          "pci=off",
          "root=/dev/vda",
          "rootfstype=ext4",
          "rw",
          "rootwait",
          "init=/sbin/init",
          `ip=${vm.guestIp}::172.16.0.1:255.255.255.0::eth0:off`
        ].join(" ")
    });

    await this.request(apiSockHost, "PUT", "/drives/rootfs", {
      drive_id: "rootfs",
      path_on_host: rootfsInChroot,
      is_root_device: true,
      is_read_only: false
    });

    await this.request(apiSockHost, "PUT", "/network-interfaces/eth0", {
      iface_id: "eth0",
      host_dev_name: tapName,
      guest_mac: generateMac(vm.id)
    });

    const vsockUdsHost = firecrackerVsockUdsPath(this.options.jailerChrootBaseDir, vm.id);
    const vsockUdsInChroot = inChrootPathForHostPath(jailRoot, vsockUdsHost);
    await this.request(apiSockHost, "PUT", "/vsock", {
      guest_cid: vm.vsockCid,
      uds_path: vsockUdsInChroot
    });

    // Snapshot artifacts live under STORAGE_ROOT/snapshots, which is outside the jail chroot.
    // Copy them into the jail root and load via in-chroot paths.
    const snapDir = path.join(jailRoot, "snapshot-in");
    await fs.mkdir(snapDir, { recursive: true });
    const stateHost = path.join(snapDir, "vmstate.snap");
    const memHost = path.join(snapDir, "mem.snap");
    await fs.copyFile(snapshot.statePath, stateHost);
    await fs.copyFile(snapshot.memPath, memHost);

    await this.request(apiSockHost, "PUT", "/snapshot/load", {
      snapshot_path: inChrootPathForHostPath(jailRoot, stateHost),
      mem_file_path: inChrootPathForHostPath(jailRoot, memHost)
    });

    await this.request(apiSockHost, "PATCH", "/vm", { state: "Resumed" });
  }

  async createSnapshot(vm: VmRecord, snapshot: { memPath: string; statePath: string }): Promise<void> {
    const jailRoot = jailerRootDir(this.options.jailerChrootBaseDir, vm.id);
    const apiSockHost = firecrackerApiSocketPath(this.options.jailerChrootBaseDir, vm.id);
    await fs.mkdir(path.dirname(snapshot.memPath), { recursive: true });
    await fs.mkdir(path.dirname(snapshot.statePath), { recursive: true });

    const outDir = path.join(jailRoot, "snapshot-out");
    await fs.mkdir(outDir, { recursive: true });
    const stateHost = path.join(outDir, "vmstate.snap");
    const memHost = path.join(outDir, "mem.snap");

    await this.request(apiSockHost, "PATCH", "/vm", { state: "Paused" });
    await this.request(apiSockHost, "PUT", "/snapshot/create", {
      snapshot_type: "Full",
      snapshot_path: inChrootPathForHostPath(jailRoot, stateHost),
      mem_file_path: inChrootPathForHostPath(jailRoot, memHost)
    });
    await this.request(apiSockHost, "PATCH", "/vm", { state: "Resumed" });

    // Copy the snapshot artifacts out of the jail root into the requested storage paths.
    await fs.copyFile(stateHost, snapshot.statePath);
    await fs.copyFile(memHost, snapshot.memPath);
  }

  async stop(vm: VmRecord): Promise<void> {
    const apiSockHost = firecrackerApiSocketPath(this.options.jailerChrootBaseDir, vm.id);
    await this.request(apiSockHost, "PUT", "/actions", { action_type: "SendCtrlAltDel" }).catch(() => undefined);
  }

  async destroy(vm: VmRecord): Promise<void> {
    const proc = this.processes.get(vm.id);
    if (proc) {
      proc.kill("SIGTERM");
      this.processes.delete(vm.id);
    }
    // Remove the entire jail subtree (sockets, logs, staged snapshots, etc.).
    await fs.rm(jailerVmDir(this.options.jailerChrootBaseDir, vm.id), { recursive: true, force: true });
  }

  private request<T>(socketPath: string, method: string, pathName: string, body?: T): Promise<void> {
    const payload = body ? JSON.stringify(body) : "";
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          method,
          path: pathName,
          socketPath,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload)
          }
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            res.resume();
            resolve();
            return;
          }
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => reject(new Error(`Firecracker API ${res.statusCode}: ${data}`)));
        }
      );

      req.on("error", reject);
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }
}

function generateMac(seed: string) {
  const hash = Buffer.from(seed.replace(/-/g, "")).slice(0, 6);
  hash[0] = (hash[0] & 0xfe) | 0x02;
  return Array.from(hash)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(":");
}

async function waitForSocket(socketPath: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      await fs.stat(socketPath);
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect({ path: socketPath });
        const onError = (err: unknown) => {
          socket.destroy();
          reject(err);
        };
        socket.once("error", onError);
        socket.once("connect", () => {
          socket.end();
          resolve();
        });
      });
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const suffix = lastError ? ` (${String((lastError as any)?.message ?? lastError)})` : "";
  throw new Error(`Firecracker API socket not ready${suffix}`);
}
