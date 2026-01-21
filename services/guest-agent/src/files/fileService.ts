import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FileService } from "../types/interfaces.js";
import { resolveWorkspacePathToChroot, resolveWorkspacePathToHost } from "./pathPolicy.js";
import { JAIL_GROUP_ID, JAIL_USER_ID, spawnInJail, runInJail } from "../exec/jail.js";
import { SANDBOX_ROOT } from "../config/constants.js";
const MAX_UPLOAD_COMPRESSED_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_TAR_ENTRIES = 10_000;

export class TarFileService implements FileService {
  async upload(dest: string, payload: NodeJS.ReadableStream): Promise<void> {
    const destHost = resolveWorkspacePathToHost(dest);
    const destChroot = resolveWorkspacePathToChroot(dest);
    await fs.mkdir(destHost, { recursive: true });
    // Ensure extracted files are writable when extraction runs as uid/gid 1000 inside the jail.
    await fs.chown(destHost, JAIL_USER_ID, JAIL_GROUP_ID).catch(() => undefined);

    // Use /tmp inside the chroot (outside /workspace) so temp files don't interfere with user workflows.
    const tmpName = `upload-${randomUUID()}.tar.gz`;
    const tmpDirHost = path.join(SANDBOX_ROOT, "tmp");
    await fs.mkdir(tmpDirHost, { recursive: true });
    const tmpHost = path.join(tmpDirHost, tmpName);
    const tmpChroot = `/tmp/${tmpName}`;

    await streamToFile(payload, tmpHost, { maxBytes: MAX_UPLOAD_COMPRESSED_BYTES });
    await fs.chown(tmpHost, JAIL_USER_ID, JAIL_GROUP_ID).catch(() => undefined);
    await validateTarInJail(tmpChroot, { maxEntries: MAX_TAR_ENTRIES, maxUncompressedBytes: MAX_UPLOAD_UNCOMPRESSED_BYTES });

    // Extract as uid/gid 1000 and prevent archives from controlling ownership or modes.
    const extract = await runInJail("/bin/tar", ["--no-same-owner", "--no-same-permissions", "--numeric-owner", "-xzf", tmpChroot, "-C", destChroot]);
    if (extract.exitCode !== 0) {
      throw new Error(`Failed to extract archive: ${extract.stderr.slice(0, 500)}`);
    }
    await fs.rm(tmpHost, { force: true }).catch(() => undefined);
  }

  async download(pathInput: string, replyStream: NodeJS.WritableStream): Promise<void> {
    const resolvedHost = resolveWorkspacePathToHost(pathInput);
    const resolvedChroot = resolveWorkspacePathToChroot(pathInput);
    const stats = await fs.stat(resolvedHost);
    const parentChroot = stats.isDirectory() ? resolvedChroot : path.posix.dirname(resolvedChroot);
    const name = stats.isDirectory() ? "." : path.posix.basename(resolvedChroot);

    await new Promise<void>((resolve, reject) => {
      const proc = spawnInJail("/bin/tar", ["-czf", "-", "-C", parentChroot, name]);
      proc.stdout.pipe(replyStream);
      proc.stderr.on("data", () => undefined);
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error("Failed to create archive"));
        }
      });
    });
  }
}

async function streamToFile(stream: NodeJS.ReadableStream, target: string, opts: { maxBytes: number }): Promise<void> {
  const handle = await fs.open(target, "w");
  try {
    await new Promise<void>((resolve, reject) => {
      let bytes = 0;
      stream.on("data", async (chunk) => {
        try {
          bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
          if (bytes > opts.maxBytes) {
            // Runtime is always a Node stream (IncomingMessage/Readable), but TS can
            // sometimes infer a web ReadableStream depending on lib settings.
            const anyStream = stream as any;
            if (typeof anyStream?.destroy === "function") {
              anyStream.destroy(new Error(`Upload exceeds max bytes (${opts.maxBytes})`));
            }
            reject(new Error(`Upload exceeds max bytes (${opts.maxBytes})`));
            return;
          }
          await handle.write(chunk);
        } catch (err) {
          reject(err);
        }
      });
      stream.on("error", reject);
      stream.on("end", resolve);
    });
  } finally {
    await handle.close();
  }
}

async function validateTarInJail(
  archiveChrootPath: string,
  opts: { maxEntries: number; maxUncompressedBytes: number }
): Promise<void> {
  // Tar listing can be large; allow a bit more output for validation than generic exec.
  const maxOutputBytes = 6_000_000;
  const listRes = await runInJail("/bin/tar", ["-tzf", archiveChrootPath], { maxOutputBytes });
  if (listRes.exitCode !== 0) {
    throw new Error("Invalid tar archive");
  }
  const list = listRes.stdout;
  const entries = list.split("\n").filter(Boolean);
  if (entries.length > opts.maxEntries) {
    throw new Error("Too many tar entries");
  }
  for (const entry of entries) {
    if (!isSafeTarPath(entry)) {
      throw new Error("Invalid tar entry");
    }
  }

  const verboseRes = await runInJail("/bin/tar", ["-tvzf", archiveChrootPath], { maxOutputBytes });
  if (verboseRes.exitCode !== 0) {
    throw new Error("Invalid tar archive");
  }
  const verbose = verboseRes.stdout;
  const lines = verbose.split("\n").filter(Boolean);
  let totalSize = 0;
  for (const line of lines) {
    const typeChar = line.trim().charAt(0);
    // Reject links and special files (devices/fifos/sockets).
    if (typeChar === "l" || typeChar === "h" || typeChar === "b" || typeChar === "c" || typeChar === "p" || typeChar === "s") {
      throw new Error("Tar contains disallowed entry type");
    }
    if (typeChar !== "-" && typeChar !== "d") {
      throw new Error("Tar contains unknown entry type");
    }

    // Best-effort uncompressed size accounting: GNU tar's -tv format puts size at tokens[2].
    const tokens = line.trim().split(/\s+/);
    const size = Number(tokens[2]);
    if (Number.isFinite(size) && size > 0) {
      totalSize += size;
      if (totalSize > opts.maxUncompressedBytes) {
        throw new Error("Tar exceeds uncompressed size limit");
      }
    }
  }
}

function isSafeTarPath(entry: string): boolean {
  if (entry.startsWith("/")) {
    return false;
  }
  const normalized = path.posix.normalize(entry);
  if (normalized.startsWith("..")) {
    return false;
  }
  return true;
}
