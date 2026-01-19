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

    const args = [
      "run",
      "--quiet",
      "--allow-read=/workspace",
      "--allow-write=/workspace"
    ];
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
        TMPDIR: "/workspace/.tmp"
      },
      timeoutMs: payload.timeoutMs
    }).finally(async () => {
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
  const dirHost = resolveWorkspacePathToHost("/workspace/.tmp");
  await fs.mkdir(dirHost, { recursive: true });
  const filename = `snippet-${randomUUID()}.ts`;
  const fullHostPath = path.join(dirHost, filename);
  await fs.writeFile(fullHostPath, payload.code, { encoding: "utf-8", mode: 0o644 });
  await fs.chown(fullHostPath, JAIL_USER_ID, JAIL_GROUP_ID);
  return resolveWorkspacePathToChroot(`/workspace/.tmp/${filename}`);
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
