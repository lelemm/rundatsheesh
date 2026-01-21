import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";
import path from "node:path";
import type { ExecResult } from "../types/agent.js";
import { SANDBOX_ROOT } from "../config/constants.js";

const USER_ID = 1000;
const GROUP_ID = 1000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
export const WORKSPACE_ROOT = "/workspace";

// Shell variant: "busybox" (default, more confined) or "bash" (NVM support).
// Set via JAIL_SHELL env var from guest-init at boot time.
const JAIL_SHELL = process.env.JAIL_SHELL || "busybox";

export function shellQuoteSingle(str: string): string {
  // Safe single-quote escape for POSIX shells: ' -> '\''.
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

export function buildJailEnv(extra?: Record<string, string>) {
  // Ensure Node runs without JIT inside the jail to avoid sporadic V8/Turbofan crashes
  // observed in some environments (notably during heavier JS workloads like `npm install`).
  //
  // If the caller provides NODE_OPTIONS, we still prepend `--jitless` so it can't be
  // accidentally dropped.
  const extraNodeOptions = extra?.NODE_OPTIONS;
  const forcedNodeOptions = extraNodeOptions ? `--jitless ${extraNodeOptions}` : "--jitless";
  const { NODE_OPTIONS: _ignored, ...restExtra } = extra ?? {};

  // Do NOT inherit the guest-agent process env to avoid leaking internals.
  // Provide a minimal, predictable environment inside the chroot.
  return {
    // Prefer /usr/bin over /usr/sbin so we pick GNU/coreutils `chroot` on Alpine
    // (BusyBox `chroot` may not support flags like `--userspec`).
    // Include /usr/local/bin so Node/npm (installed there on Debian images) is available in the jail.
    PATH: "/usr/local/bin:/usr/bin:/usr/sbin:/bin:/sbin",
    HOME: "/home/user",
    USER: "user",
    LOGNAME: "user",
    SHELL: "/bin/sh",
    LANG: "C.UTF-8",
    TMPDIR: "/tmp",
    ...restExtra,
    NODE_OPTIONS: forcedNodeOptions
  };
}

export function normalizeWorkspaceCwd(workspaceCwd?: string): string {
  if (!workspaceCwd) return WORKSPACE_ROOT;
  // Assume caller already validated via pathPolicy; normalize defensively anyway.
  const normalized = path.posix.normalize(workspaceCwd);
  if (!normalized.startsWith(WORKSPACE_ROOT + "/") && normalized !== WORKSPACE_ROOT) {
    return WORKSPACE_ROOT;
  }
  return normalized;
}

export function buildChrootArgs(command: string, args: string[]): string[] {
  return ["--userspec=1000:1000", SANDBOX_ROOT, command, ...args];
}

export async function runInJailShell(
  cmd: string,
  opts: { cwdInWorkspace?: string; env?: Record<string, string>; timeoutMs?: number; maxOutputBytes?: number }
): Promise<ExecResult> {
  const cwd = normalizeWorkspaceCwd(opts.cwdInWorkspace);

  if (JAIL_SHELL === "bash") {
    // Bash: source /etc/skel/.bashrc for NVM support, then run command.
    // NOTE: We use /etc/skel/.bashrc (baked into the image) instead of ~/.bashrc
    // because /home/user is bind-mounted at runtime and would override any image .bashrc.
    const script = `source /etc/skel/.bashrc 2>/dev/null || true; cd ${shellQuoteSingle(cwd)} && ${cmd}`;
    return runRootCommand(["chroot", buildChrootArgs("/bin/bash", ["-c", script])], {
      env: buildJailEnv(opts.env),
      timeoutMs: opts.timeoutMs,
      maxOutputBytes: opts.maxOutputBytes
    });
  }

  // Default: BusyBox sh (more confined)
  const script = `cd ${shellQuoteSingle(cwd)} && ${cmd}`;
  return runRootCommand(["chroot", buildChrootArgs("/bin/busybox", ["sh", "-c", script])], {
    env: buildJailEnv(opts.env),
    timeoutMs: opts.timeoutMs,
    maxOutputBytes: opts.maxOutputBytes
  });
}

export async function runInJail(
  command: string,
  args: string[],
  opts?: { env?: Record<string, string>; timeoutMs?: number; maxOutputBytes?: number }
): Promise<ExecResult> {
  return runRootCommand(["chroot", buildChrootArgs(command, args)], {
    env: buildJailEnv(opts?.env),
    timeoutMs: opts?.timeoutMs,
    maxOutputBytes: opts?.maxOutputBytes
  });
}

export function spawnInJail(
  command: string,
  args: string[],
  opts?: { env?: Record<string, string> } & SpawnOptionsWithoutStdio
) {
  // Intentionally does not inherit env.
  return spawn("chroot", buildChrootArgs(command, args), { ...opts, env: buildJailEnv(opts?.env as any) });
}

async function runRootCommand(
  [cmd, args]: [string, string[]],
  options: { env?: Record<string, string>; timeoutMs?: number; maxOutputBytes?: number }
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
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ exitCode: -1, stdout, stderr: stderr + "\nTimeout exceeded" });
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdoutBytes += Buffer.byteLength(text);
      if (stdoutBytes <= maxOutputBytes) {
        stdout += text;
      }
    });
    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderrBytes += Buffer.byteLength(text);
      if (stderrBytes <= maxOutputBytes) {
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

// Export for potential callers that still need raw IDs (e.g., chown on host files).
export const JAIL_USER_ID = USER_ID;
export const JAIL_GROUP_ID = GROUP_ID;

