import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StorageProvider } from "../types/interfaces.js";
import { jailerRootDir } from "../firecracker/socketPaths.js";

const execFileAsync = promisify(execFile);

export interface LocalStorageOptions {
  baseRootfsPath: string;
  storageRoot: string;
  kernelSrcPath: string;
  jailerChrootBaseDir: string;
  rootfsCloneMode?: "auto" | "reflink" | "copy";
}

export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly options: LocalStorageOptions) {}

  async prepareVmStorage(vmId: string): Promise<{ rootfsPath: string; logsDir: string; kernelPath: string }> {
    const jailRoot = jailerRootDir(this.options.jailerChrootBaseDir, vmId);
    const logsDir = path.join(jailRoot, "logs");
    const runDir = path.join(jailRoot, "run");
    await fs.mkdir(jailRoot, { recursive: true });
    await fs.mkdir(logsDir, { recursive: true });
    await fs.mkdir(runDir, { recursive: true });

    const kernelPath = path.join(jailRoot, "vmlinux");
    await fs.copyFile(this.options.kernelSrcPath, kernelPath);

    const rootfsPath = path.join(jailRoot, "rootfs.ext4");
    await cloneRootfs(this.options.baseRootfsPath, rootfsPath, this.options.rootfsCloneMode ?? "auto");
    // Firecracker runs as an unprivileged uid/gid after jailer drops privileges.
    // Ensure it can open the backing disk for read/write.
    await fs.chmod(rootfsPath, 0o666).catch(() => undefined);

    return { rootfsPath, logsDir, kernelPath };
  }

  async prepareVmStorageFromDisk(vmId: string, diskSrcPath: string): Promise<{ rootfsPath: string; logsDir: string; kernelPath: string }> {
    const jailRoot = jailerRootDir(this.options.jailerChrootBaseDir, vmId);
    const logsDir = path.join(jailRoot, "logs");
    const runDir = path.join(jailRoot, "run");
    await fs.mkdir(jailRoot, { recursive: true });
    await fs.mkdir(logsDir, { recursive: true });
    await fs.mkdir(runDir, { recursive: true });

    const kernelPath = path.join(jailRoot, "vmlinux");
    await fs.copyFile(this.options.kernelSrcPath, kernelPath);

    const rootfsPath = path.join(jailRoot, "rootfs.ext4");
    await this.cloneDisk(diskSrcPath, rootfsPath);
    await fs.chmod(rootfsPath, 0o666).catch(() => undefined);
    return { rootfsPath, logsDir, kernelPath };
  }

  async cleanupVmStorage(vmId: string): Promise<void> {
    // VM metadata lives under STORAGE_ROOT/<vmId>, while runtime artifacts live under the jailer chroot base.
    await fs.rm(path.join(this.options.storageRoot, vmId), { recursive: true, force: true });
    await fs.rm(path.join(this.options.jailerChrootBaseDir, vmId), { recursive: true, force: true });
  }

  async getSnapshotArtifactPaths(
    snapshotId: string
  ): Promise<{ dir: string; memPath: string; statePath: string; diskPath: string; metaPath: string }> {
    const dir = path.join(this.options.storageRoot, "snapshots", snapshotId);
    await fs.mkdir(dir, { recursive: true });
    return {
      dir,
      memPath: path.join(dir, "mem.snap"),
      statePath: path.join(dir, "vmstate.snap"),
      diskPath: path.join(dir, "disk.ext4"),
      metaPath: path.join(dir, "meta.json")
    };
  }

  async listSnapshots(): Promise<string[]> {
    const dir = path.join(this.options.storageRoot, "snapshots");
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }

  async readSnapshotMeta(snapshotId: string): Promise<import("../types/snapshot.js").SnapshotMeta | null> {
    const p = await this.getSnapshotArtifactPaths(snapshotId);
    try {
      const text = await fs.readFile(p.metaPath, "utf-8");
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async cloneDisk(src: string, dest: string): Promise<void> {
    await cloneRootfs(src, dest, this.options.rootfsCloneMode ?? "auto");
  }
}

async function cloneRootfs(src: string, dest: string, mode: "auto" | "reflink" | "copy"): Promise<void> {
  if (mode === "copy") {
    await fs.copyFile(src, dest);
    return;
  }

  // Best-effort CoW clone: instant on reflink-capable filesystems (btrfs/xfs),
  // and falls back to a full copy when unsupported.
  try {
    await execFileAsync("cp", ["--reflink=auto", src, dest]);
    return;
  } catch (err) {
    if (mode === "reflink") {
      throw err;
    }
    await fs.copyFile(src, dest);
  }
}
