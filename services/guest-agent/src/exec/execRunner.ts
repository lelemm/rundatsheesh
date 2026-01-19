import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ExecRunner } from "../types/interfaces.js";
import type { ExecRequest, ExecResult, RunTsRequest } from "../types/agent.js";
import { resolveWorkspacePathToChroot, resolveWorkspacePathToHost } from "../files/pathPolicy.js";
import { JAIL_GROUP_ID, JAIL_USER_ID, runInJailShell, shellQuoteSingle } from "./jail.js";

export class ExecRunnerImpl implements ExecRunner {
  async exec(payload: ExecRequest): Promise<ExecResult> {
    const cwd = await resolveCwd(payload.cwd);
    return runInJailShell(payload.cmd, { cwdInWorkspace: cwd, env: payload.env, timeoutMs: payload.timeoutMs });
  }

  async runTs(payload: RunTsRequest): Promise<ExecResult> {
    const cwd = await resolveCwd(payload.path ? path.dirname(payload.path) : undefined);
    const entry = await resolveEntryPath(payload);
    const denoBin = "/usr/bin/deno";

    const extraEnv = parseEnvArray(payload.env);
    const allowEnvNames = Object.keys(extraEnv);

    const args = [
      "run",
      "--quiet",
      "--allow-read=/workspace",
      "--allow-write=/workspace"
    ];
    if (allowEnvNames.length) {
      // Allow access only to the explicitly provided env vars.
      args.push(`--allow-env=${allowEnvNames.join(",")}`);
    }
    if (payload.allowNet) {
      args.push("--allow-net");
    }
    if (payload.denoFlags) {
      args.push(...payload.denoFlags);
    }
    args.push(entry, ...(payload.args ?? []));

    // NOTE: run-ts is now executed inside the same chroot jail as /exec.
    const cmd = `${shellQuoteSingle(denoBin)} ${args.map((a) => shellQuoteSingle(a)).join(" ")}`;
    return runInJailShell(cmd, {
      cwdInWorkspace: cwd,
      env: {
        DENO_DIR: "/workspace/.deno",
        TMPDIR: "/workspace/.tmp",
        // Disable ANSI colors in Deno output (still strip as a fallback below).
        NO_COLOR: "1",
        TERM: "dumb",
        ...extraEnv
      },
      timeoutMs: payload.timeoutMs
    })
      .then((result) => ({
        exitCode: result.exitCode,
        stdout: stripAnsi(result.stdout),
        stderr: stripAnsi(result.stderr)
      }))
      .finally(async () => {
      if (payload.code) {
        // Delete the host-side file (same underlying mount as /workspace).
        await fs.rm(resolveWorkspacePathToHost(entry), { force: true }).catch(() => undefined);
      }
    });
  }
}

async function resolveEntryPath(payload: RunTsRequest): Promise<string> {
  if (payload.path) {
    return resolveWorkspacePathToChroot(payload.path);
  }
  if (!payload.code) {
    throw new Error("path or code is required");
  }
  // Write the snippet directly under /workspace so relative imports resolve as if executed from /workspace.
  // (Deno resolves relative module specifiers based on the module file location, not process cwd.)
  const dirHost = resolveWorkspacePathToHost("/workspace");
  await fs.mkdir(dirHost, { recursive: true });
  const filename = `.run-ts-snippet-${randomUUID()}.ts`;
  const fullHostPath = path.join(dirHost, filename);
  await fs.writeFile(fullHostPath, payload.code, { encoding: "utf-8", mode: 0o644 });
  await fs.chown(fullHostPath, JAIL_USER_ID, JAIL_GROUP_ID);
  return resolveWorkspacePathToChroot(`/workspace/${filename}`);
}

async function resolveCwd(input?: string): Promise<string> {
  if (!input) {
    return "/workspace";
  }
  try {
    const resolvedHost = resolveWorkspacePathToHost(input);
    await fs.stat(resolvedHost);
    return resolveWorkspacePathToChroot(input);
  } catch {
    return "/workspace";
  }
}

function parseEnvArray(env?: string[]): Record<string, string> {
  if (!env) return {};
  if (!Array.isArray(env)) {
    throw new Error("env must be an array of strings in the format KEY=value");
  }
  const out: Record<string, string> = {};
  for (const entry of env) {
    if (typeof entry !== "string") {
      throw new Error("env entries must be strings in the format KEY=value");
    }
    const idx = entry.indexOf("=");
    if (idx <= 0) {
      throw new Error(`Invalid env entry (expected KEY=value): ${entry}`);
    }
    const key = entry.slice(0, idx);
    const value = entry.slice(idx + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid env var name: ${key}`);
    }
    out[key] = value;
  }
  return out;
}

function stripAnsi(input: string): string {
  // Based on widely-used ANSI stripping patterns (covers CSI and other escape sequences).
  return input.replace(
    /[\u001B\u009B][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}
