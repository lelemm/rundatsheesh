import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import type { FirecrackerManager } from "../types/interfaces.js";
import type { VmRecord } from "../types/vm.js";
import { firecrackerApiSocketPath, firecrackerVsockUdsPath } from "./socketPaths.js";

export interface FirecrackerOptions {
  firecrackerBin: string;
  apiSocketDir: string;
}

export class FirecrackerManagerImpl implements FirecrackerManager {
  private readonly processes = new Map<string, ReturnType<typeof spawn>>();

  constructor(private readonly options: FirecrackerOptions) {}

  async createAndStart(vm: VmRecord, rootfsPath: string, kernelPath: string, tapName: string): Promise<void> {
    const apiSock = firecrackerApiSocketPath(this.options.apiSocketDir, vm.id);
    await fs.mkdir(this.options.apiSocketDir, { recursive: true });

    // Configure Firecracker to write detailed logs/metrics to the VM logs dir.
    const fcLogPath = path.join(vm.logsDir, "firecracker.log");
    const fcMetricsPath = path.join(vm.logsDir, "firecracker.metrics");

    // Firecracker expects these paths to be valid and writable at startup.
    await fs.mkdir(vm.logsDir, { recursive: true });
    await fs.appendFile(fcLogPath, "");
    await fs.appendFile(fcMetricsPath, "");

    const proc = spawn(
      this.options.firecrackerBin,
      [
        "--api-sock",
        apiSock,
        "--id",
        vm.id,
        "--log-path",
        fcLogPath,
        "--level",
        "Debug",
        "--show-level",
        "--show-log-origin",
        "--metrics-path",
        fcMetricsPath
      ],
      {
      stdio: ["ignore", "pipe", "pipe"]
      }
    );
    this.processes.set(vm.id, proc);

    // Capture microVM serial output (console=ttyS0) and Firecracker logs for debugging.
    // This is especially useful when the guest agent fails to come up.
    try {
      const stdoutLog = createWriteStream(path.join(vm.logsDir, "firecracker.stdout.log"), { flags: "a" });
      const stderrLog = createWriteStream(path.join(vm.logsDir, "firecracker.stderr.log"), { flags: "a" });
      proc.stdout?.pipe(stdoutLog);
      proc.stderr?.pipe(stderrLog);
      proc.on("close", () => {
        stdoutLog.end();
        stderrLog.end();
      });
    } catch {
      // Best-effort only; do not fail VM start if logging can't be initialized.
    }

    await waitForSocket(apiSock);

    await this.request(apiSock, "PUT", "/machine-config", {
      vcpu_count: vm.cpu,
      mem_size_mib: vm.memMb,
      smt: false
    });

    await this.request(apiSock, "PUT", "/boot-source", {
      kernel_image_path: kernelPath,
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

    await this.request(apiSock, "PUT", "/drives/rootfs", {
      drive_id: "rootfs",
      path_on_host: rootfsPath,
      is_root_device: true,
      is_read_only: false
    });

    await this.request(apiSock, "PUT", "/network-interfaces/eth0", {
      iface_id: "eth0",
      host_dev_name: tapName,
      guest_mac: generateMac(vm.id)
    });

    await this.request(apiSock, "PUT", "/vsock", {
      guest_cid: vm.vsockCid,
      uds_path: firecrackerVsockUdsPath(this.options.apiSocketDir, vm.id)
    });

    await this.request(apiSock, "PUT", "/actions", {
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
    const apiSock = firecrackerApiSocketPath(this.options.apiSocketDir, vm.id);
    await fs.mkdir(this.options.apiSocketDir, { recursive: true });

    const fcLogPath = path.join(vm.logsDir, "firecracker.log");
    const fcMetricsPath = path.join(vm.logsDir, "firecracker.metrics");
    await fs.mkdir(vm.logsDir, { recursive: true });
    await fs.appendFile(fcLogPath, "");
    await fs.appendFile(fcMetricsPath, "");

    const proc = spawn(
      this.options.firecrackerBin,
      [
        "--api-sock",
        apiSock,
        "--id",
        vm.id,
        "--log-path",
        fcLogPath,
        "--level",
        "Debug",
        "--show-level",
        "--show-log-origin",
        "--metrics-path",
        fcMetricsPath
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    this.processes.set(vm.id, proc);

    try {
      const stdoutLog = createWriteStream(path.join(vm.logsDir, "firecracker.stdout.log"), { flags: "a" });
      const stderrLog = createWriteStream(path.join(vm.logsDir, "firecracker.stderr.log"), { flags: "a" });
      proc.stdout?.pipe(stdoutLog);
      proc.stderr?.pipe(stderrLog);
      proc.on("close", () => {
        stdoutLog.end();
        stderrLog.end();
      });
    } catch {
      // Best-effort only.
    }

    await waitForSocket(apiSock);

    // Configure devices similarly to the boot path; snapshot load expects a compatible config.
    await this.request(apiSock, "PUT", "/machine-config", {
      vcpu_count: vm.cpu,
      mem_size_mib: vm.memMb,
      smt: false
    });

    await this.request(apiSock, "PUT", "/boot-source", {
      kernel_image_path: kernelPath,
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

    await this.request(apiSock, "PUT", "/drives/rootfs", {
      drive_id: "rootfs",
      path_on_host: rootfsPath,
      is_root_device: true,
      is_read_only: false
    });

    await this.request(apiSock, "PUT", "/network-interfaces/eth0", {
      iface_id: "eth0",
      host_dev_name: tapName,
      guest_mac: generateMac(vm.id)
    });

    await this.request(apiSock, "PUT", "/vsock", {
      guest_cid: vm.vsockCid,
      uds_path: firecrackerVsockUdsPath(this.options.apiSocketDir, vm.id)
    });

    await this.request(apiSock, "PUT", "/snapshot/load", {
      snapshot_path: snapshot.statePath,
      mem_file_path: snapshot.memPath
    });

    await this.request(apiSock, "PUT", "/actions", { action_type: "Resume" });
  }

  async createSnapshot(vm: VmRecord, snapshot: { memPath: string; statePath: string }): Promise<void> {
    const apiSock = firecrackerApiSocketPath(this.options.apiSocketDir, vm.id);
    await fs.mkdir(path.dirname(snapshot.memPath), { recursive: true });
    await fs.mkdir(path.dirname(snapshot.statePath), { recursive: true });

    await this.request(apiSock, "PUT", "/actions", { action_type: "Pause" });
    await this.request(apiSock, "PUT", "/snapshot/create", {
      snapshot_type: "Full",
      snapshot_path: snapshot.statePath,
      mem_file_path: snapshot.memPath
    });
    await this.request(apiSock, "PUT", "/actions", { action_type: "Resume" });
  }

  async stop(vm: VmRecord): Promise<void> {
    const apiSock = firecrackerApiSocketPath(this.options.apiSocketDir, vm.id);
    await this.request(apiSock, "PUT", "/actions", { action_type: "SendCtrlAltDel" }).catch(() => undefined);
  }

  async destroy(vm: VmRecord): Promise<void> {
    const proc = this.processes.get(vm.id);
    if (proc) {
      proc.kill("SIGTERM");
      this.processes.delete(vm.id);
    }
    await fs.rm(firecrackerApiSocketPath(this.options.apiSocketDir, vm.id), { force: true });
    await fs.rm(firecrackerVsockUdsPath(this.options.apiSocketDir, vm.id), { force: true });
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
  while (Date.now() - start < timeoutMs) {
    try {
      await fs.stat(socketPath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Firecracker API socket not ready");
}
