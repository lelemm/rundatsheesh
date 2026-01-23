import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ExecRunner } from "../types/interfaces.js";
import type { ExecRequest, ExecResult, RunJsRequest, RunTsRequest } from "../types/agent.js";
import { resolveWorkspacePathToChroot, resolveWorkspacePathToHost } from "../files/pathPolicy.js";
import { JAIL_GROUP_ID, JAIL_USER_ID, runInJailShell, shellQuoteSingle } from "./jail.js";
import { SANDBOX_ROOT } from "../config/constants.js";

export class ExecRunnerImpl implements ExecRunner {
  async exec(payload: ExecRequest): Promise<ExecResult> {
    const cwd = await resolveCwd(payload.cwd);
    return runInJailShell(payload.cmd, { cwdInWorkspace: cwd, env: payload.env, timeoutMs: payload.timeoutMs });
  }

  async runTs(payload: RunTsRequest): Promise<ExecResult> {
    const cwd = await resolveCwd(payload.path ? path.dirname(payload.path) : undefined);
    const { entry, cleanupPaths, resultPath } = await prepareRunTsEntry(payload);
    const denoBin = "/usr/bin/deno";

    // Ensure /tmp inside the chroot is writable by the jail user (for TMPDIR).
    const tmpDirHost = path.join(SANDBOX_ROOT, "tmp");
    await fs.mkdir(tmpDirHost, { recursive: true });
    await fs.chown(tmpDirHost, JAIL_USER_ID, JAIL_GROUP_ID).catch(() => undefined);

    const extraEnv = parseEnvArray(payload.env);
    const allowEnvNames = Object.keys(extraEnv);

    const args = [
      "run",
      "--quiet",
      "--allow-read=/workspace,/tmp,/etc/resolv.conf,/etc/hosts,/etc/nsswitch.conf,/etc/ssl/certs/ca-certificates.crt",
      "--allow-write=/workspace,/tmp"
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
        TMPDIR: "/tmp",
        // Disable ANSI colors in Deno output (still strip as a fallback below).
        NO_COLOR: "1",
        TERM: "dumb",
        ...extraEnv
      },
      timeoutMs: payload.timeoutMs
    })
      .then(async (result) => {
        const parsed = resultPath ? await readResultFile(resultPath) : undefined;
        return {
          exitCode: result.exitCode,
          stdout: stripAnsi(result.stdout),
          stderr: stripAnsi(result.stderr),
          ...(parsed?.result !== undefined ? { result: parsed.result } : {}),
          ...(parsed?.error !== undefined ? { error: parsed.error } : {})
        };
      })
      .finally(async () => {
        // Delete any files created to execute this request.
        for (const p of cleanupPaths) {
          await fs.rm(resolveWorkspacePathToHost(p), { force: true }).catch(() => undefined);
        }
        if (resultPath) {
          await fs.rm(resolveWorkspacePathToHost(resultPath), { force: true }).catch(() => undefined);
        }
    });
  }

  async runJs(payload: RunJsRequest): Promise<ExecResult> {
    const cwd = await resolveCwd(payload.path ? path.dirname(payload.path) : undefined);
    const { entry, cleanupPaths, resultPath } = await prepareRunJsEntry(payload);
    const nodeBin = "/usr/bin/node";

    const extraEnv = parseEnvArray(payload.env);
    const args = [...(payload.nodeFlags ?? []), entry, ...(payload.args ?? [])];

    // NOTE: run-js is executed inside the same chroot jail as /exec.
    const cmd = `${shellQuoteSingle(nodeBin)} ${args.map((a) => shellQuoteSingle(a)).join(" ")}`;
    return runInJailShell(cmd, { cwdInWorkspace: cwd, env: extraEnv, timeoutMs: payload.timeoutMs })
      .then(async (result) => {
        const parsed = resultPath ? await readResultFile(resultPath) : undefined;
        return {
          exitCode: result.exitCode,
          // Preserve ANSI in Node output; the admin UI renders it like a real console.
          stdout: result.stdout,
          stderr: result.stderr,
          ...(parsed?.result !== undefined ? { result: parsed.result } : {}),
          ...(parsed?.error !== undefined ? { error: parsed.error } : {})
        };
      })
      .finally(async () => {
        // Delete any files created to execute this request.
        for (const p of cleanupPaths) {
          await fs.rm(resolveWorkspacePathToHost(p), { force: true }).catch(() => undefined);
        }
        if (resultPath) {
          await fs.rm(resolveWorkspacePathToHost(resultPath), { force: true }).catch(() => undefined);
        }
      });
  }
}

async function prepareRunTsEntry(payload: RunTsRequest): Promise<{ entry: string; cleanupPaths: string[]; resultPath?: string }> {
  // We always execute a wrapper as the entrypoint so a built-in `result` helper is available,
  // and so we can persist a structured {result,error} payload to a known file.
  const id = randomUUID();
  const cleanupPaths: string[] = [];
  const resultPath = `/workspace/.run-ts-result-${id}.json`;
  const wrapperPath = `/workspace/.run-ts-wrapper-${id}.ts`;

  const dirHostWorkspace = resolveWorkspacePathToHost("/workspace");
  await fs.mkdir(dirHostWorkspace, { recursive: true });
  // Ensure /workspace is writable by the jail user so Deno can write files (result, TMPDIR, etc).
  await fs.chown(dirHostWorkspace, JAIL_USER_ID, JAIL_GROUP_ID).catch(() => undefined);

  let targetUrl = "";
  if (payload.path) {
    // Import the target module by absolute file URL so its relative imports still resolve against its own location.
    targetUrl = `file://${resolveWorkspacePathToChroot(payload.path)}`;
  } else if (payload.code) {
    // Keep the snippet as its own module so stack traces point to it.
    const snippetPath = `/workspace/.run-ts-snippet-${id}.ts`;
    const fullHostPath = path.join(dirHostWorkspace, path.posix.basename(snippetPath));
    await fs.writeFile(fullHostPath, payload.code, { encoding: "utf-8", mode: 0o644 });
    await fs.chown(fullHostPath, JAIL_USER_ID, JAIL_GROUP_ID);
    cleanupPaths.push(snippetPath);
    targetUrl = `file://${resolveWorkspacePathToChroot(snippetPath)}`;
  } else {
    throw new Error("path or code is required");
  }

  const wrapperCode = buildRunTsWrapper({ targetUrl, resultPath });
  const wrapperHostPath = path.join(dirHostWorkspace, path.posix.basename(wrapperPath));
  await fs.writeFile(wrapperHostPath, wrapperCode, { encoding: "utf-8", mode: 0o644 });
  await fs.chown(wrapperHostPath, JAIL_USER_ID, JAIL_GROUP_ID);
  cleanupPaths.push(wrapperPath);

  return {
    entry: resolveWorkspacePathToChroot(wrapperPath),
    cleanupPaths,
    resultPath
  };
}

async function prepareRunJsEntry(payload: RunJsRequest): Promise<{ entry: string; cleanupPaths: string[]; resultPath?: string }> {
  // We always execute a wrapper as the entrypoint so a built-in `result` helper is available,
  // and so we can persist a structured {result,error} payload to a known file.
  const id = randomUUID();
  const cleanupPaths: string[] = [];
  const resultPath = `/workspace/.run-js-result-${id}.json`;
  const wrapperPath = `/workspace/.run-js-wrapper-${id}.js`;

  const dirHostWorkspace = resolveWorkspacePathToHost("/workspace");
  await fs.mkdir(dirHostWorkspace, { recursive: true });
  // Ensure /workspace is writable by the jail user so Node can write files (result, npm caches, etc).
  await fs.chown(dirHostWorkspace, JAIL_USER_ID, JAIL_GROUP_ID).catch(() => undefined);

  let targetUrl = "";
  if (payload.path) {
    // Import the target module by absolute file URL so its relative imports still resolve against its own location.
    targetUrl = `file://${resolveWorkspacePathToChroot(payload.path)}`;
  } else if (payload.code) {
    // Keep the snippet as its own module so stack traces point to it.
    const snippetPath = `/workspace/.run-js-snippet-${id}.js`;
    const fullHostPath = path.join(dirHostWorkspace, path.posix.basename(snippetPath));
    await fs.writeFile(fullHostPath, payload.code, { encoding: "utf-8", mode: 0o644 });
    await fs.chown(fullHostPath, JAIL_USER_ID, JAIL_GROUP_ID);
    cleanupPaths.push(snippetPath);
    targetUrl = `file://${resolveWorkspacePathToChroot(snippetPath)}`;
  } else {
    throw new Error("path or code is required");
  }

  const wrapperCode = buildRunJsWrapper({ targetUrl, resultPath });
  const wrapperHostPath = path.join(dirHostWorkspace, path.posix.basename(wrapperPath));
  await fs.writeFile(wrapperHostPath, wrapperCode, { encoding: "utf-8", mode: 0o644 });
  await fs.chown(wrapperHostPath, JAIL_USER_ID, JAIL_GROUP_ID);
  cleanupPaths.push(wrapperPath);

  return {
    entry: resolveWorkspacePathToChroot(wrapperPath),
    cleanupPaths,
    resultPath
  };
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

async function readResultFile(resultPath: string): Promise<{ result?: unknown; error?: unknown } | undefined> {
  try {
    const text = await fs.readFile(resolveWorkspacePathToHost(resultPath), "utf-8");
    if (!text) return undefined;
    const parsed = JSON.parse(text) as any;
    if (!parsed || typeof parsed !== "object") return undefined;
    return { result: parsed.result, error: parsed.error };
  } catch {
    return undefined;
  }
}

function buildRunTsWrapper(input: { targetUrl: string; resultPath: string }): string {
  // IMPORTANT: This file runs in the guest VM (Deno).
  // It provides a built-in global `result` helper to capture structured output and errors.
  // The helper persists to a file so the guest-agent can return it in the API response.
  return [
    `const __RESULT_PATH__ = ${JSON.stringify(input.resultPath)};`,
    `let __result = undefined;`,
    `let __error = undefined;`,
    `let __exitCode = 0;`,
    ``,
    `function __serializeError(e) {`,
    `  // Always return an object to avoid Fastify/AJV coercing strings to {"0":"T","1":"y",...}`,
    `  if (typeof e === "string") {`,
    `    return { name: "Error", message: e };`,
    `  }`,
    `  if (e && typeof e === "object") {`,
    `    const hasErrorShape = ("name" in e) || ("message" in e) || ("stack" in e);`,
    `    if (hasErrorShape) {`,
    `      const name = String(e.name ?? "Error");`,
    `      const message = String(e.message ?? e.toString?.() ?? "");`,
    `      const stack = typeof e.stack === "string" ? e.stack : undefined;`,
    `      return { name, message, ...(stack ? { stack } : {}) };`,
    `    }`,
    `    // Plain object without error shape - return as-is`,
    `    return e;`,
    `  }`,
    `  // Primitive values (number, boolean, null, undefined) - wrap in message`,
    `  return { name: "Error", message: String(e) };`,
    `}`,
    ``,
    `function __safeStringify(value) {`,
    `  const seen = new WeakSet();`,
    `  return JSON.stringify(value, (_k, v) => {`,
    `    if (typeof v === "bigint") return v.toString();`,
    `    if (v && typeof v === "object") {`,
    `      if (seen.has(v)) return "[Circular]";`,
    `      seen.add(v);`,
    `    }`,
    `    return v;`,
    `  });`,
    `}`,
    ``,
    `globalThis.result = {`,
    `  set: (v) => { __result = v; },`,
    `  error: (e) => { __error = __serializeError(e); __exitCode = 1; },`,
    `};`,
    ``,
    `async function __writeResult() {`,
    `  try {`,
    `    const payload = { result: __result, error: __error };`,
    `    await Deno.writeTextFile(__RESULT_PATH__, __safeStringify(payload));`,
    `  } catch {`,
    `    // ignore`,
    `  }`,
    `}`,
    ``,
    `try {`,
    `  await import(${JSON.stringify(input.targetUrl)});`,
    `} catch (e) {`,
    `  __error = __serializeError(e);`,
    `  __exitCode = 1;`,
    `} finally {`,
    `  await __writeResult();`,
    `  if (__exitCode !== 0 && typeof Deno !== "undefined") Deno.exit(__exitCode);`,
    `}`,
    ``
  ].join("\n");
}

function buildRunJsWrapper(input: { targetUrl: string; resultPath: string }): string {
  // IMPORTANT: This file runs in the guest VM (Node.js).
  // It provides a built-in global `result` helper to capture structured output and errors.
  // The helper persists to a file so the guest-agent can return it in the API response.
  return [
    `const fs = require("node:fs");`,
    `const __RESULT_PATH__ = ${JSON.stringify(input.resultPath)};`,
    `let __result = undefined;`,
    `let __error = undefined;`,
    `let __exitCode = 0;`,
    ``,
    `function __serializeError(e) {`,
    `  // Always return an object to avoid Fastify/AJV coercing strings to {"0":"T","1":"y",...}`,
    `  if (typeof e === "string") {`,
    `    return { name: "Error", message: e };`,
    `  }`,
    `  if (e && typeof e === "object") {`,
    `    const hasErrorShape = ("name" in e) || ("message" in e) || ("stack" in e);`,
    `    if (hasErrorShape) {`,
    `      const name = String(e.name ?? "Error");`,
    `      const message = String(e.message ?? (typeof e.toString === "function" ? e.toString() : ""));`,
    `      const stack = typeof e.stack === "string" ? e.stack : undefined;`,
    `      return { name, message, ...(stack ? { stack } : {}) };`,
    `    }`,
    `    // Plain object without error shape - return as-is`,
    `    return e;`,
    `  }`,
    `  // Primitive values (number, boolean, null, undefined) - wrap in message`,
    `  return { name: "Error", message: String(e) };`,
    `}`,
    ``,
    `function __safeStringify(value) {`,
    `  const seen = new WeakSet();`,
    `  return JSON.stringify(value, (_k, v) => {`,
    `    if (typeof v === "bigint") return v.toString();`,
    `    if (v && typeof v === "object") {`,
    `      if (seen.has(v)) return "[Circular]";`,
    `      seen.add(v);`,
    `    }`,
    `    return v;`,
    `  });`,
    `}`,
    ``,
    `globalThis.result = {`,
    `  set: (v) => { __result = v; },`,
    `  error: (e) => { __error = __serializeError(e); __exitCode = 1; },`,
    `};`,
    ``,
    `function __writeResultSync() {`,
    `  try {`,
    `    const payload = { result: __result, error: __error };`,
    `    fs.writeFileSync(__RESULT_PATH__, __safeStringify(payload), { encoding: "utf-8" });`,
    `  } catch {`,
    `    // ignore`,
    `  }`,
    `}`,
    ``,
    `(async () => {`,
    `  try {`,
    `    await import(${JSON.stringify(input.targetUrl)});`,
    `  } catch (e) {`,
    `    __error = __serializeError(e);`,
    `    __exitCode = 1;`,
    `  } finally {`,
    `    __writeResultSync();`,
    `    if (__exitCode !== 0) process.exit(__exitCode);`,
    `  }`,
    `})().catch((e) => {`,
    `  __error = __serializeError(e);`,
    `  __exitCode = 1;`,
    `  __writeResultSync();`,
    `  process.exit(1);`,
    `});`,
    ``
  ].join("\n");
}

function stripAnsi(input: string): string {
  // Based on widely-used ANSI stripping patterns (covers CSI and other escape sequences).
  return input.replace(
    /[\u001B\u009B][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}
