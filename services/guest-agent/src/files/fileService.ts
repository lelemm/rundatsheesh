import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FileService } from "../types/interfaces.js";
import { resolveUserPath } from "./pathPolicy.js";
import { USER_HOME } from "../config/constants.js";

const execFileAsync = promisify(execFile);

export class TarFileService implements FileService {
  async upload(dest: string, payload: NodeJS.ReadableStream): Promise<void> {
    const destPath = resolveUserPath(dest);
    await fs.mkdir(destPath, { recursive: true });

    const tmpDir = resolveUserPath(path.join(USER_HOME, ".tmp"));
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpPath = path.join(tmpDir, `upload-${randomUUID()}.tar.gz`);

    await streamToFile(payload, tmpPath);
    await validateTar(tmpPath);

    await execFileAsync("tar", ["-xzf", tmpPath, "-C", destPath]);
    await fs.rm(tmpPath, { force: true });
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

async function streamToFile(stream: NodeJS.ReadableStream, target: string): Promise<void> {
  const handle = await fs.open(target, "w");
  try {
    await new Promise<void>((resolve, reject) => {
      stream.on("data", async (chunk) => {
        try {
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

async function validateTar(archivePath: string): Promise<void> {
  const { stdout: list } = await execFileAsync("tar", ["-tzf", archivePath]);
  const entries = list.split("\n").filter(Boolean);
  for (const entry of entries) {
    if (!isSafeTarPath(entry)) {
      throw new Error("Invalid tar entry");
    }
  }

  const { stdout: verbose } = await execFileAsync("tar", ["-tvzf", archivePath]);
  const lines = verbose.split("\n").filter(Boolean);
  for (const line of lines) {
    const typeChar = line.trim().charAt(0);
    if (typeChar === "l" || typeChar === "h") {
      throw new Error("Symlinks and hardlinks are not allowed");
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
