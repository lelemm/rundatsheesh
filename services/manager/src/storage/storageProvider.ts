import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StorageProvider, VmStorageResult } from "../types/interfaces.js";
import { jailerRootDir, jailerVmDir } from "../firecracker/socketPaths.js";

const execFileAsync = promisify(execFile);

export interface LocalStorageOptions {
  storageRoot: string;
  jailerChrootBaseDir: string;
  rootfsCloneMode?: "auto" | "reflink" | "copy";
  enableOverlay?: boolean;
  overlaySizeBytes?: number;
}

export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly options: LocalStorageOptions) {}

  async prepareVmStorage(
    vmId: string,
    input: { kernelSrcPath: string; baseRootfsPath: string; diskSizeBytes?: number }
  ): Promise<VmStorageResult> {
    const jailRoot = jailerRootDir(this.options.jailerChrootBaseDir, vmId);
    const logsDir = path.join(jailRoot, "logs");
    const runDir = path.join(jailRoot, "run");
    await fs.mkdir(jailRoot, { recursive: true });
    await fs.mkdir(logsDir, { recursive: true });
    await fs.mkdir(runDir, { recursive: true });

    const kernelPath = path.join(jailRoot, "vmlinux");
    const rootfsPath = path.join(jailRoot, "rootfs.ext4");

    const enableOverlay = this.options.enableOverlay ?? true;

    if (enableOverlay) {
      // Overlay mode: use hard links for instant provisioning
      // Hard link kernel (instant, shared across VMs)
      await hardLinkOrCopy(input.kernelSrcPath, kernelPath);

      // Hard link base rootfs (instant, shared read-only across VMs)
      await hardLinkOrCopy(input.baseRootfsPath, rootfsPath);

      // Create sparse overlay disk for per-VM writes
      const overlayPath = path.join(jailRoot, "overlay.ext4");
      const overlaySizeBytes = this.options.overlaySizeBytes ?? 512 * 1024 * 1024;
      await createSparseExt4(overlayPath, overlaySizeBytes);

      // Firecracker runs as an unprivileged uid/gid after jailer drops privileges.
      await fs.chmod(rootfsPath, 0o444).catch(() => undefined); // Read-only for base
      await fs.chmod(overlayPath, 0o666).catch(() => undefined); // Read-write for overlay
      await fs.chmod(kernelPath, 0o444).catch(() => undefined); // Read-only for kernel

      return { rootfsPath, overlayPath, logsDir, kernelPath };
    } else {
      // Legacy mode: full copy of rootfs (slower, more disk space)
      await fs.copyFile(input.kernelSrcPath, kernelPath);
      await cloneRootfs(input.baseRootfsPath, rootfsPath, this.options.rootfsCloneMode ?? "auto");

      if (typeof input.diskSizeBytes === "number" && Number.isFinite(input.diskSizeBytes) && input.diskSizeBytes > 0) {
        await ensureExt4Size(rootfsPath, input.diskSizeBytes);
      }

      await fs.chmod(rootfsPath, 0o666).catch(() => undefined);
      return { rootfsPath, overlayPath: null, logsDir, kernelPath };
    }
  }

  async prepareVmStorageFromDisk(
    vmId: string,
    input: { kernelSrcPath: string; diskSrcPath: string; diskSizeBytes?: number }
  ): Promise<VmStorageResult> {
    const jailRoot = jailerRootDir(this.options.jailerChrootBaseDir, vmId);
    const logsDir = path.join(jailRoot, "logs");
    const runDir = path.join(jailRoot, "run");
    await fs.mkdir(jailRoot, { recursive: true });
    await fs.mkdir(logsDir, { recursive: true });
    await fs.mkdir(runDir, { recursive: true });

    const kernelPath = path.join(jailRoot, "vmlinux");
    await fs.copyFile(input.kernelSrcPath, kernelPath);

    const rootfsPath = path.join(jailRoot, "rootfs.ext4");
    await this.cloneDisk(input.diskSrcPath, rootfsPath);
    if (typeof input.diskSizeBytes === "number" && Number.isFinite(input.diskSizeBytes) && input.diskSizeBytes > 0) {
      await ensureExt4Size(rootfsPath, input.diskSizeBytes);
    }
    await fs.chmod(rootfsPath, 0o666).catch(() => undefined);

    // For disk-based provisioning (snapshots), we need the overlay if it exists
    const overlayPath = path.join(jailRoot, "overlay.ext4");
    const hasOverlay = await fs.stat(overlayPath).then(() => true).catch(() => false);

    return { rootfsPath, overlayPath: hasOverlay ? overlayPath : null, logsDir, kernelPath };
  }

  async cleanupVmStorage(vmId: string): Promise<void> {
    // VM metadata lives under STORAGE_ROOT/<vmId>, while runtime artifacts live under the jailer chroot base.
    await fs.rm(path.join(this.options.storageRoot, vmId), { recursive: true, force: true });
    await fs.rm(path.join(this.options.jailerChrootBaseDir, vmId), { recursive: true, force: true });
  }

  async cleanupJailerVmDir(vmId: string): Promise<void> {
    await fs.rm(jailerVmDir(this.options.jailerChrootBaseDir, vmId), { recursive: true, force: true });
  }

  /**
   * Get a persistent disk path for a VM's rootfs that survives jailer cleanup.
   * This is used during stop/start cycles to preserve user data.
   */
  persistentDiskPath(vmId: string): string {
    return path.join(this.options.storageRoot, "vms", vmId, "rootfs.ext4");
  }

  /**
   * Save the VM's rootfs from the jailer directory to persistent storage.
   * Called before jailer cleanup during stop.
   */
  async saveDiskToPersistent(vmId: string, currentRootfsPath: string): Promise<void> {
    const persistPath = this.persistentDiskPath(vmId);
    await fs.mkdir(path.dirname(persistPath), { recursive: true });
    await this.cloneDisk(currentRootfsPath, persistPath);
  }

  /**
   * Check if a persistent disk exists for a VM.
   */
  async hasPersistentDisk(vmId: string): Promise<boolean> {
    try {
      await fs.access(this.persistentDiskPath(vmId));
      return true;
    } catch {
      return false;
    }
  }

  async getSnapshotArtifactPaths(
    snapshotId: string
  ): Promise<{ dir: string; memPath: string; statePath: string; diskPath: string; overlayPath: string; metaPath: string }> {
    const dir = path.join(this.options.storageRoot, "snapshots", snapshotId);
    await fs.mkdir(dir, { recursive: true });
    return {
      dir,
      memPath: path.join(dir, "mem.snap"),
      statePath: path.join(dir, "vmstate.snap"),
      diskPath: path.join(dir, "disk.ext4"),
      overlayPath: path.join(dir, "overlay.ext4"),
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

/**
 * Create a hard link from src to dest.
 * Falls back to copy if hard link fails (e.g., cross-filesystem).
 */
async function hardLinkOrCopy(src: string, dest: string): Promise<void> {
  try {
    await fs.link(src, dest);
  } catch (err) {
    // Hard link failed (likely cross-filesystem), fall back to copy
    await fs.copyFile(src, dest);
  }
}

/**
 * Create a sparse ext4 filesystem.
 * The file starts at 0 actual bytes on disk but can grow up to sizeBytes.
 */
async function createSparseExt4(filePath: string, sizeBytes: number): Promise<void> {
  // Create sparse file (instant, no actual disk allocation)
  await execFileAsync("truncate", ["-s", String(sizeBytes), filePath]);
  // Format as ext4 with minimal reserved blocks
  // -F: force (don't ask questions)
  // -m 0: no reserved blocks for root (maximize usable space)
  // -O ^has_journal: disable journal for faster writes (acceptable for ephemeral overlay)
  await execFileAsync("mkfs.ext4", ["-F", "-m", "0", "-O", "^has_journal", filePath]);
}

async function ensureExt4Size(diskPath: string, requestedBytes: number): Promise<void> {
  const st = await fs.stat(diskPath);
  if (requestedBytes <= st.size) return;

  await fs.truncate(diskPath, requestedBytes);
  // Best-effort: ensure filesystem is consistent and then grow to fill the new file size.
  // -p: automatic repair (safe defaults), -f: force check, but keep it conservative.
  await execFileAsync("e2fsck", ["-pf", diskPath]).catch(() => undefined);
  await execFileAsync("resize2fs", [diskPath]).catch((err) => {
    // If resize fails, leave the disk file larger but filesystem unchanged; VM boot may fail.
    // Surface the error so the API call fails loudly.
    throw err;
  });
}
