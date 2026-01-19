import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ExecRunner } from "../types/interfaces.js";
import type { ExecRequest, ExecResult, RunTsRequest } from "../types/agent.js";
import { SANDBOX_ROOT, USER_HOME } from "../config/constants.js";
import { resolveUserPath } from "../files/pathPolicy.js";

const USER_ID = 1000;
const GROUP_ID = 1000;
const MAX_OUTPUT_BYTES = 1_000_000;

export class ExecRunnerImpl implements ExecRunner {
  async exec(payload: ExecRequest): Promise<ExecResult> {
    const cwd = await resolveCwd(payload.cwd);
    return runSandboxedShell(payload.cmd, {
      cwd,
      env: payload.env,
      timeoutMs: payload.timeoutMs
    });
  }

  async runTs(payload: RunTsRequest): Promise<ExecResult> {
    const cwd = await resolveCwd(payload.path ? path.dirname(payload.path) : undefined);
    const entry = await resolveEntryPath(payload);
    const denoBin = "/home/user/.deno/bin/deno";

    const args = [
      "run",
      "--quiet",
      "--allow-read=/home/user",
      "--allow-write=/home/user"
    ];
    if (payload.allowNet) {
      args.push("--allow-net");
    }
    if (payload.denoFlags) {
      args.push(...payload.denoFlags);
    }
    args.push(entry, ...(payload.args ?? []));

    return runCommand([denoBin, args], {
      cwd,
      env: {
        DENO_DIR: "/home/user/.deno",
        TMPDIR: "/home/user/.tmp"
      },
      timeoutMs: payload.timeoutMs
    }).finally(async () => {
      if (payload.code) {
        await fs.rm(entry, { force: true });
      }
    });
  }
}

async function resolveEntryPath(payload: RunTsRequest): Promise<string> {
  if (payload.path) {
    return resolveUserPath(payload.path);
  }
  if (!payload.code) {
    throw new Error("path or code is required");
  }
  const dir = resolveUserPath("/home/user/.tmp");
  await fs.mkdir(dir, { recursive: true });
  const filename = `snippet-${randomUUID()}.ts`;
  const fullPath = path.join(dir, filename);
  await fs.writeFile(fullPath, payload.code, { encoding: "utf-8", mode: 0o644 });
  await fs.chown(fullPath, USER_ID, GROUP_ID);
  return fullPath;
}

async function resolveCwd(input?: string): Promise<string> {
  if (!input) {
    return USER_HOME;
  }
  try {
    const resolved = resolveUserPath(input);
    await fs.stat(resolved);
    return resolved;
  } catch {
    return USER_HOME;
  }
}

async function runCommand(
  [cmd, args]: [string, string[]],
  options: { cwd: string; env?: Record<string, string>; timeoutMs?: number }
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      uid: USER_ID,
      gid: GROUP_ID
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const timeoutMs = options.timeoutMs ?? 30_000;

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ exitCode: -1, stdout, stderr: stderr + "\nTimeout exceeded" });
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdoutBytes += Buffer.byteLength(text);
      if (stdoutBytes <= MAX_OUTPUT_BYTES) {
        stdout += text;
      }
    });
    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderrBytes += Buffer.byteLength(text);
      if (stderrBytes <= MAX_OUTPUT_BYTES) {
        stderr += text;
      }
    });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

function shellQuoteSingle(str: string): string {
  // Safe single-quote escape for POSIX shells: ' -> '\''.
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

function buildMinimalEnv(extra?: Record<string, string>) {
  // Do NOT inherit the guest-agent process env to avoid leaking internals.
  // Provide a minimal, predictable environment inside the chroot.
  return {
    // Prefer /usr/bin over /usr/sbin so we pick GNU/coreutils `chroot` on Alpine
    // (BusyBox `chroot` may not support flags like `--userspec`).
    // Include /usr/local/bin so Node/npm (installed there on Debian images) is available in /exec.
    PATH: "/usr/local/bin:/usr/bin:/usr/sbin:/bin:/sbin",
    // Keep HOME writable (bind-mounted from real /home/user) so tools like npm can create caches.
    HOME: "/home/user",
    USER: "user",
    LOGNAME: "user",
    SHELL: "/bin/sh",
    LANG: "C.UTF-8",
    TMPDIR: "/home/user/.tmp",
    ...extra
  };
}

async function runSandboxedShell(
  cmd: string,
  options: { cwd: string; env?: Record<string, string>; timeoutMs?: number }
): Promise<ExecResult> {
  // Hard confinement: chroot to a dedicated sandbox root (not /home/user) so /home/user exists
  // normally inside the chroot and we avoid symlink loops (/workspace <-> /home/user).
  //
  // The guest-agent bind-mounts the real /home/user into:
  // - ${SANDBOX_ROOT}/home/user
  // - ${SANDBOX_ROOT}/workspace
  const root = SANDBOX_ROOT;

  // Convert the resolved host path (/home/user/...) into a chroot path under /workspace.
  const rel = path.relative(USER_HOME, options.cwd);
  const cwdInChroot = rel && rel !== "." ? `/workspace/${rel}` : "/workspace";

  // Invoke BusyBox explicitly so we don't depend on /bin/sh symlink existing in the chroot.
  const script = `cd ${shellQuoteSingle(cwdInChroot)} && ${cmd}`;

  return runRootCommand(["chroot", ["--userspec=1000:1000", root, "/bin/busybox", "sh", "-c", script]], {
    env: buildMinimalEnv(options.env),
    timeoutMs: options.timeoutMs
  });
}

async function runRootCommand(
  [cmd, args]: [string, string[]],
  options: { env?: Record<string, string>; timeoutMs?: number }
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      env: options.env
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const timeoutMs = options.timeoutMs ?? 30_000;

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ exitCode: -1, stdout, stderr: stderr + "\nTimeout exceeded" });
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdoutBytes += Buffer.byteLength(text);
      if (stdoutBytes <= MAX_OUTPUT_BYTES) {
        stdout += text;
      }
    });
    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderrBytes += Buffer.byteLength(text);
      if (stderrBytes <= MAX_OUTPUT_BYTES) {
        stderr += text;
      }
    });
    proc.on("error", (err) => {
      clearTimeout(timeout);
      const msg = String((err as any)?.message ?? err);
      resolve({ exitCode: -1, stdout, stderr: (stderr ? stderr + "\n" : "") + msg });
    });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}
