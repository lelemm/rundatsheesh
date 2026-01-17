import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FileService } from "../types/interfaces.js";
import { resolveUserPath } from "./pathPolicy.js";
import { USER_HOME } from "../config/constants.js";

const execFileAsync = promisify(execFile);
const USER_ID = 1000;
const GROUP_ID = 1000;
const MAX_UPLOAD_COMPRESSED_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_TAR_ENTRIES = 10_000;

export class TarFileService implements FileService {
  async upload(dest: string, payload: NodeJS.ReadableStream): Promise<void> {
    const destPath = resolveUserPath(dest);
    await fs.mkdir(destPath, { recursive: true });
    // Ensure extracted files are writable when extraction runs as uid/gid 1000.
    await fs.chown(destPath, USER_ID, GROUP_ID).catch(() => undefined);

    const tmpDir = resolveUserPath(path.join(USER_HOME, ".tmp"));
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.chown(tmpDir, USER_ID, GROUP_ID).catch(() => undefined);
    const tmpPath = path.join(tmpDir, `upload-${randomUUID()}.tar.gz`);

    await streamToFile(payload, tmpPath, { maxBytes: MAX_UPLOAD_COMPRESSED_BYTES });
    await fs.chown(tmpPath, USER_ID, GROUP_ID).catch(() => undefined);
    await validateTar(tmpPath, { maxEntries: MAX_TAR_ENTRIES, maxUncompressedBytes: MAX_UPLOAD_UNCOMPRESSED_BYTES });

    // Extract as uid/gid 1000 and prevent archives from controlling ownership or modes.
    await execFileAsync(
      "tar",
      ["--no-same-owner", "--no-same-permissions", "--numeric-owner", "-xzf", tmpPath, "-C", destPath],
      { uid: USER_ID, gid: GROUP_ID }
    );
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
  }

  async download(pathInput: string, replyStream: NodeJS.WritableStream): Promise<void> {
    const resolved = resolveUserPath(pathInput);
    const stats = await fs.stat(resolved);
    const parent = stats.isDirectory() ? resolved : path.dirname(resolved);
    const name = stats.isDirectory() ? "." : path.basename(resolved);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("tar", ["-czf", "-", "-C", parent, name]);
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

async function validateTar(archivePath: string, opts: { maxEntries: number; maxUncompressedBytes: number }): Promise<void> {
  const { stdout: list } = await execFileAsync("tar", ["-tzf", archivePath]);
  const entries = list.split("\n").filter(Boolean);
  if (entries.length > opts.maxEntries) {
    throw new Error("Too many tar entries");
  }
  for (const entry of entries) {
    if (!isSafeTarPath(entry)) {
      throw new Error("Invalid tar entry");
    }
  }

  const { stdout: verbose } = await execFileAsync("tar", ["-tvzf", archivePath]);
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
