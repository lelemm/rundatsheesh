import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StorageProvider } from "../types/interfaces.js";

const execFileAsync = promisify(execFile);

export interface LocalStorageOptions {
  baseRootfsPath: string;
  storageRoot: string;
  rootfsCloneMode?: "auto" | "reflink" | "copy";
}

export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly options: LocalStorageOptions) {}

  async prepareVmStorage(vmId: string): Promise<{ rootfsPath: string; logsDir: string }> {
    const vmDir = path.join(this.options.storageRoot, vmId);
    const logsDir = path.join(vmDir, "logs");
    await fs.mkdir(vmDir, { recursive: true });
    await fs.mkdir(logsDir, { recursive: true });

    const rootfsPath = path.join(vmDir, "rootfs.ext4");
    await cloneRootfs(this.options.baseRootfsPath, rootfsPath, this.options.rootfsCloneMode ?? "auto");

    return { rootfsPath, logsDir };
  }

  async prepareVmStorageFromDisk(vmId: string, diskSrcPath: string): Promise<{ rootfsPath: string; logsDir: string }> {
    const vmDir = path.join(this.options.storageRoot, vmId);
    const logsDir = path.join(vmDir, "logs");
    await fs.mkdir(vmDir, { recursive: true });
    await fs.mkdir(logsDir, { recursive: true });

    const rootfsPath = path.join(vmDir, "rootfs.ext4");
    await this.cloneDisk(diskSrcPath, rootfsPath);
    return { rootfsPath, logsDir };
  }

  async cleanupVmStorage(vmId: string): Promise<void> {
    const vmDir = path.join(this.options.storageRoot, vmId);
    await fs.rm(vmDir, { recursive: true, force: true });
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
