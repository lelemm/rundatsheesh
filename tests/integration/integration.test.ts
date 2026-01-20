import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const API_KEY = process.env.API_KEY ?? "dev-key";
const MANAGER_BASE = process.env.MANAGER_BASE ?? "http://127.0.0.1:3000";
const MAX_CREATE_MS = process.env.MAX_CREATE_MS ? Number(process.env.MAX_CREATE_MS) : null;
const ENABLE_SNAPSHOTS = (process.env.ENABLE_SNAPSHOTS ?? "false").toLowerCase() === "true";
const VM_IMAGE_ID = process.env.VM_IMAGE_ID || "";

function mustExec(cmd: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: "inherit" | "pipe" }) {
  return execFileSync(cmd, args, {
    cwd: opts?.cwd,
    env: opts?.env,
    stdio: (opts?.stdio ?? "inherit") as any
  });
}

async function waitForManager(): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${MANAGER_BASE}/v1/vms`, { headers: { "X-API-Key": API_KEY } });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await delay(1000);
  }
  throw new Error("Manager did not become ready");
}

async function apiJson<T>(method: string, url: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(url, {
    method,
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as T) : ({} as T);
  return { status: res.status, json };
}

async function apiBinary(method: string, url: string, body?: Uint8Array): Promise<{ status: number; buf: Buffer }> {
  const headers: Record<string, string> = { "X-API-Key": API_KEY };
  if (body !== undefined) {
    headers["Content-Type"] = "application/gzip";
  }
  const res = await fetch(url, {
    method,
    headers,
    // Node's fetch supports Uint8Array, but lib.dom types can be picky depending on TS config.
    body: body === undefined ? undefined : (body as any)
  });
  const ab = await res.arrayBuffer();
  return { status: res.status, buf: Buffer.from(ab) };
}

type ExecResult = { exitCode: number; stdout: string; stderr: string; result?: any; error?: any };
type VmPublic = {
  id: string;
  state: string;
  cpu: number;
  memMb: number;
  guestIp: string;
  outboundInternet: boolean;
  createdAt: string;
  provisionMode?: "boot" | "snapshot";
};
type SnapshotMeta = { id: string; kind: string; createdAt: string; cpu: number; memMb: number; sourceVmId?: string; hasDisk: boolean };

async function createVm(payload: { cpu: number; memMb: number; allowIps: string[]; outboundInternet: boolean }): Promise<VmPublic> {
  const started = Date.now();
  const { status, json } = await apiJson<VmPublic>("POST", `${MANAGER_BASE}/v1/vms`, {
    ...payload,
    ...(VM_IMAGE_ID ? { imageId: VM_IMAGE_ID } : {})
  });
  expect(status).toBe(201);
  expect(json.id).toBeTruthy();
  const elapsedMs = Date.now() - started;
  // eslint-disable-next-line no-console
  console.info("[it] vm create timing", { elapsedMs, payload, provisionMode: json.provisionMode });
  if (MAX_CREATE_MS != null) {
    expect(elapsedMs).toBeLessThanOrEqual(MAX_CREATE_MS);
  }
  return json;
}

async function deleteVm(vmId: string): Promise<void> {
  const res = await fetch(`${MANAGER_BASE}/v1/vms/${vmId}`, { method: "DELETE", headers: { "X-API-Key": API_KEY } });
  // best-effort
  if (!res.ok && res.status !== 404) {
    // eslint-disable-next-line no-console
    console.warn("Failed to delete VM", { vmId, status: res.status });
  }
}

async function getVm(vmId: string): Promise<VmPublic> {
  const { status, json } = await apiJson<VmPublic>("GET", `${MANAGER_BASE}/v1/vms/${vmId}`);
  expect(status).toBe(200);
  return json;
}

async function createSnapshot(vmId: string): Promise<SnapshotMeta> {
  const { status, json } = await apiJson<SnapshotMeta>("POST", `${MANAGER_BASE}/v1/vms/${vmId}/snapshots`);
  expect(status).toBe(201);
  expect(json.id).toBeTruthy();
  expect(json.hasDisk).toBe(true);
  return json;
}

async function listSnapshots(): Promise<SnapshotMeta[]> {
  const { status, json } = await apiJson<SnapshotMeta[]>("GET", `${MANAGER_BASE}/v1/snapshots`);
  expect(status).toBe(200);
  return json;
}

async function vmExec(vmId: string, cmd: string): Promise<ExecResult> {
  const { status, json } = await apiJson<ExecResult>("POST", `${MANAGER_BASE}/v1/vms/${vmId}/exec`, { cmd });
  expect(status).toBe(200);
  if (json.exitCode !== 0) {
    // eslint-disable-next-line no-console
    console.error("[it] exec nonzero", { vmId, cmd, exitCode: json.exitCode, stdout: json.stdout, stderr: json.stderr });
  }
  return json;
}

async function vmRunTs(vmId: string, code: string): Promise<ExecResult> {
  const { status, json } = await apiJson<ExecResult>("POST", `${MANAGER_BASE}/v1/vms/${vmId}/run-ts`, { code });
  expect(status).toBe(200);
  if (json.exitCode !== 0) {
    // eslint-disable-next-line no-console
    console.error("[it] run-ts nonzero", { vmId, exitCode: json.exitCode, stdout: json.stdout, stderr: json.stderr });
  }
  return json;
}

async function vmRunTsWithEnv(vmId: string, code: string, env: string[]): Promise<ExecResult> {
  const { status, json } = await apiJson<ExecResult>("POST", `${MANAGER_BASE}/v1/vms/${vmId}/run-ts`, { code, env });
  expect(status).toBe(200);
  if (json.exitCode !== 0) {
    // eslint-disable-next-line no-console
    console.error("[it] run-ts(env) nonzero", { vmId, exitCode: json.exitCode, stdout: json.stdout, stderr: json.stderr });
  }
  return json;
}

async function vmRunTsPath(vmId: string, path: string): Promise<ExecResult> {
  const { status, json } = await apiJson<ExecResult>("POST", `${MANAGER_BASE}/v1/vms/${vmId}/run-ts`, { path });
  expect(status).toBe(200);
  return json;
}

describe.sequential("run-dat-sheesh integration (vitest)", () => {
  let vmDeny = "";
  let vmOk = "";
  let tmpDir = "";
  let uploadBuf: Uint8Array | null = null;
  let sdkUploadBuf: Uint8Array | null = null;
  let npmPkgUploadBuf: Uint8Array | null = null;

  const cleanupTmpDir = () => {
    // Best-effort: keep /tmp clean even when tests fail.
    try {
      if (tmpDir && tmpDir.startsWith(os.tmpdir())) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  };

  beforeAll(async () => {
    await waitForManager();
    // eslint-disable-next-line no-console
    console.info("[it] snapshots enabled?", { ENABLE_SNAPSHOTS, MAX_CREATE_MS });

    vmDeny = (await createVm({ cpu: 1, memMb: 256, allowIps: ["1.2.3.4/32"], outboundInternet: true })).id;
    vmOk = (await createVm({ cpu: 1, memMb: 256, allowIps: ["172.16.0.1/32"], outboundInternet: true })).id;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "run-dat-sheesh-it-"));
    // Backstop cleanup for abrupt exits (SIGINT, etc). Vitest should run afterAll, but don't rely on it.
    process.once("exit", cleanupTmpDir);
    process.once("SIGINT", () => {
      cleanupTmpDir();
      process.exit(130);
    });
    process.once("SIGTERM", () => {
      cleanupTmpDir();
      process.exit(143);
    });

    const helloPath = path.join(tmpDir, "hello.txt");
    fs.writeFileSync(helloPath, "hello run-dat-sheesh", "utf-8");
    const uploadTar = path.join(tmpDir, "upload.tar.gz");
    mustExec("tar", ["-czf", uploadTar, "-C", tmpDir, "hello.txt"], { stdio: "inherit" });
    uploadBuf = new Uint8Array(fs.readFileSync(uploadTar));

    // Prepare a tiny "SDK" + an app entrypoint that imports it.
    const sdkDir = path.join(tmpDir, "sdk");
    const appDir = path.join(tmpDir, "app");
    fs.mkdirSync(sdkDir, { recursive: true });
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(sdkDir, "mod.ts"), 'export function greet(name: string) { return `hello ${name}`; }\n', "utf-8");
    fs.writeFileSync(
      path.join(appDir, "main.ts"),
      'import { greet } from "file:///workspace/sdk/mod.ts";\nconsole.log(greet("world"));\n',
      "utf-8"
    );
    const sdkTar = path.join(tmpDir, "sdk-upload.tar.gz");
    mustExec("tar", ["-czf", sdkTar, "-C", tmpDir, "sdk", "app"], { stdio: "inherit" });
    sdkUploadBuf = new Uint8Array(fs.readFileSync(sdkTar));

    // Prepare a tiny local npm package to install offline (no internet dependency).
    const npmPkgDir = path.join(tmpDir, "npm-pkg");
    fs.mkdirSync(npmPkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(npmPkgDir, "package.json"),
      JSON.stringify({ name: "rds-it-pkg", version: "1.0.0", main: "index.js" }, null, 2) + "\n",
      "utf-8"
    );
    fs.writeFileSync(path.join(npmPkgDir, "index.js"), 'module.exports = () => "ok";\n', "utf-8");
    const npmTar = path.join(tmpDir, "npm-pkg.tar.gz");
    mustExec("tar", ["-czf", npmTar, "-C", tmpDir, "npm-pkg"], { stdio: "inherit" });
    npmPkgUploadBuf = new Uint8Array(fs.readFileSync(npmTar));
  });

  afterAll(async () => {
    try {
      if (vmDeny) await deleteVm(vmDeny);
      if (vmOk) await deleteVm(vmOk);
    } finally {
      cleanupTmpDir();
    }
  });

  it("allowIps: denies non-allowlisted destination", async () => {
    // Use `run-ts` (Deno) instead of `exec` because `exec` is confined to a BusyBox-only chroot under /home/user,
    // so common HTTP clients (curl/wget) may not exist.
    const deny = await vmRunTs(
      vmDeny,
      [
        'const url = "http://172.16.0.1:18080/";',
        "const ctrl = new AbortController();",
        "const t = setTimeout(() => ctrl.abort(), 2000);",
        "try {",
        "  const res = await fetch(url, { signal: ctrl.signal });",
        "  const text = await res.text();",
        "  console.log(text);",
        "} catch (err) {",
        "  console.error(String(err));",
        "  Deno.exit(2);",
        "} finally {",
        "  clearTimeout(t);",
        "}"
      ].join("\n")
    );
    expect(deny.exitCode).not.toBe(0);
  });

  it("allowIps: allows allowlisted destination", async () => {
    const allow = await vmRunTs(
      vmOk,
      [
        'const url = "http://172.16.0.1:18080/";',
        "const ctrl = new AbortController();",
        "const t = setTimeout(() => ctrl.abort(), 2000);",
        "try {",
        "  const res = await fetch(url, { signal: ctrl.signal });",
        "  const text = await res.text();",
        "  console.log(text);",
        "} catch (err) {",
        "  console.error(String(err));",
        "  Deno.exit(2);",
        "} finally {",
        "  clearTimeout(t);",
        "}"
      ].join("\n")
    );
    expect(allow.exitCode).toBe(0);
    expect(allow.stdout.trim()).toBe("ok");
  });

  it("run-ts: env array is available via Deno.env.get()", async () => {
    const key = "IT_SECRET";
    const value = `hello-${Date.now()}`;
    const res = await vmRunTsWithEnv(
      vmOk,
      [
        `const v = Deno.env.get(${JSON.stringify(key)});`,
        `if (!v) { console.error("missing"); Deno.exit(2); }`,
        "console.log(v);"
      ].join("\n"),
      [`${key}=${value}`]
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe(value);
  });

  it("run-ts: sandbox has resolv.conf (DNS config present)", async () => {
    const res = await vmRunTs(
      vmOk,
      [
        "const text = await Deno.readTextFile('/etc/resolv.conf');",
        "console.log(text.trim());"
      ].join("\n")
    );
    expect(res.exitCode).toBe(0);
    // DNS server can be overridden in some environments; assert a nameserver is present.
    expect(res.stdout).toContain("nameserver ");
  });

  it("run-ts: system clock is sane (TLS should not fail with NotValidYet)", async () => {
    const res = await vmRunTs(
      vmOk,
      [
        "const year = new Date().getUTCFullYear();",
        "console.log(String(year));",
        "if (year < 2023) Deno.exit(2);"
      ].join("\n")
    );
    expect(res.exitCode).toBe(0);
  });

  it("run-ts: can return a structured result via global result.set()", async () => {
    const res = await vmRunTs(
      vmOk,
      [
        "result.set({ ok: true, n: 123 });",
        "console.log('done');"
      ].join("\n")
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("done");
    expect(res.result).toEqual({ ok: true, n: 123 });
  });

  it("run-ts: can return a structured error via global result.error()", async () => {
    const res = await vmRunTs(
      vmOk,
      [
        "result.error({ code: 'E_TEST', detail: 'boom' });",
        "console.log('after');"
      ].join("\n")
    );
    expect(res.exitCode).not.toBe(0);
    expect(res.error).toEqual({ code: "E_TEST", detail: "boom" });
  });

  it("exec: runs as uid 1000", async () => {
    const idu = await vmExec(vmOk, "id -u");
    expect(idu.stdout.trim()).toBe("1000");
  });

  it("exec: mkdir inside /home/user and ls parent shows it", async () => {
    // NOTE: /v1/vms/:id/exec is run inside a chroot rooted at /opt/sandbox.
    // The real VM workspace (/home/user) is bind-mounted into the chroot at:
    // - /workspace
    // - /home/user
    const mkdirLs = await vmExec(vmOk, "mkdir -p /workspace/integration-test-dir && ls -1 /workspace");
    expect(mkdirLs.exitCode).toBe(0);
    expect(mkdirLs.stdout.split("\n").map((s) => s.trim()).filter(Boolean)).toContain("integration-test-dir");
  });

  it("exec: git runs inside the sandbox", async () => {
    const res = await vmExec(vmOk, "git --version");
    expect(res.exitCode).toBe(0);
    expect(res.stdout.toLowerCase()).toContain("git version");
  });

  it("exec: npm install works (offline local package)", async () => {
    // Upload a local package to /home/user so we can install from a path without hitting the network.
    const { status, buf } = await apiBinary(
      "POST",
      `${MANAGER_BASE}/v1/vms/${vmOk}/files/upload?dest=${encodeURIComponent("/workspace")}`,
      npmPkgUploadBuf ?? undefined
    );
    if (status !== 204) {
      // eslint-disable-next-line no-console
      console.error("[it] npm pkg upload failed", { status, body: buf.toString("utf-8", 0, 2048) });
    }
    expect(status).toBe(204);

    // Use /workspace inside the chrooted exec sandbox.
    const version = await vmExec(vmOk, "node --version && npm --version");
    expect(version.exitCode).toBe(0);

    const install = await vmExec(
      vmOk,
      [
        "cd /workspace",
        "rm -rf npm-test && mkdir -p npm-test && cd npm-test",
        // Ensure any accidental registry access fails fast (and to an allowlisted IP) instead of hanging on dropped packets.
        // Local file: installs should not require network.
        "export npm_config_registry=http://172.16.0.1:9 npm_config_fetch_timeout=2000 npm_config_fetch_retries=0 npm_config_fetch_retry_maxtimeout=2000",
        // Keep output visible so failures are diagnosable (Alpine npm has different behavior).
        "npm init -y",
        // Explicit file: install; disable noisy network features (audit/fund/update notifier).
        "npm install --no-audit --no-fund --no-update-notifier --progress=false file:../npm-pkg",
        "test -d node_modules/rds-it-pkg",
        "node -e \"const pkg=require('rds-it-pkg'); process.stdout.write(String(pkg()));\"",
      ].join(" && ")
    );
    expect(install.exitCode).toBe(0);
    const lastLine = install.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(-1)[0];
    expect(lastLine).toBe("ok");
  });

  it("files: upload succeeds to /home/user", async () => {
    const { status, buf } = await apiBinary(
      "POST",
      `${MANAGER_BASE}/v1/vms/${vmOk}/files/upload?dest=${encodeURIComponent("/workspace/project")}`,
      uploadBuf ?? undefined
    );
    if (status !== 204) {
      // eslint-disable-next-line no-console
      console.error("[it] upload failed", { status, body: buf.toString("utf-8", 0, 2048) });
    }
    expect(status).toBe(204);
  });

  it("files: oversized upload is rejected (413)", async () => {
    // Manager upload bodyLimit is 10MB (compressed). Send >10MB of bytes.
    const big = new Uint8Array(11 * 1024 * 1024);
    const { status } = await apiBinary(
      "POST",
      `${MANAGER_BASE}/v1/vms/${vmOk}/files/upload?dest=${encodeURIComponent("/workspace/project")}`,
      big
    );
    expect(status).toBe(413);
  });

  it("files: upload is rejected under /home/user (workspace-only contract)", async () => {
    const { status } = await apiBinary(
      "POST",
      `${MANAGER_BASE}/v1/vms/${vmOk}/files/upload?dest=${encodeURIComponent("/home/user/project")}`,
      uploadBuf ?? undefined
    );
    expect(status).toBe(400);
  });

  it("files: upload is rejected outside /home/user", async () => {
    const { status } = await apiBinary(
      "POST",
      `${MANAGER_BASE}/v1/vms/${vmOk}/files/upload?dest=${encodeURIComponent("/etc")}`,
      uploadBuf ?? undefined
    );
    expect(status).toBe(400);
  });

  it("files: download succeeds from /home/user and contents match", async () => {
    const { status, buf } = await apiBinary(
      "GET",
      `${MANAGER_BASE}/v1/vms/${vmOk}/files/download?path=${encodeURIComponent("/workspace/project")}`
    );
    expect(status).toBe(200);
    const dlTar = path.join(tmpDir, "download.tar.gz");
    fs.writeFileSync(dlTar, buf);
    const outDir = path.join(tmpDir, "out");
    fs.mkdirSync(outDir, { recursive: true });
    mustExec("tar", ["-xzf", dlTar, "-C", outDir], { stdio: "inherit" });
    const downloaded = fs.readFileSync(path.join(outDir, "hello.txt"), "utf-8");
    expect(downloaded).toBe("hello run-dat-sheesh");
  });

  it("files: download is rejected outside /home/user", async () => {
    const { status } = await apiBinary("GET", `${MANAGER_BASE}/v1/vms/${vmOk}/files/download?path=${encodeURIComponent("/etc")}`);
    expect(status).toBe(400);
  });

  it("files: download is rejected under /home/user (workspace-only contract)", async () => {
    const { status } = await apiBinary(
      "GET",
      `${MANAGER_BASE}/v1/vms/${vmOk}/files/download?path=${encodeURIComponent("/home/user/project")}`
    );
    expect(status).toBe(400);
  });

  it("run-ts: returns stdout", async () => {
    const ts = await vmRunTs(vmOk, "console.log(2 + 2)");
    expect(ts.exitCode).toBe(0);
    expect(ts.stdout.trim()).toBe("4");
  });

  it("run-ts (deno): runs in the chroot jail and uses /workspace", async () => {
    // Ensure a clean test dir.
    const prep = await vmExec(vmOk, "rm -rf /workspace/deno-jail-test && mkdir -p /workspace/deno-jail-test");
    expect(prep.exitCode).toBe(0);

    const code = [
      'console.log("cwd=" + Deno.cwd());',
      'await Deno.writeTextFile("/workspace/deno-jail-test/marker.txt", "ok");',
      "try {",
      '  await Deno.readTextFile("/home/user/deno-jail-test/marker.txt");',
      '  console.log("homeUserReadableUnexpected");',
      "} catch {",
      '  console.log("homeUserDenied");',
      "}"
    ].join("\n");

    const res = await vmRunTs(vmOk, code);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("cwd=/workspace");
    expect(res.stdout).toContain("homeUserDenied");

    const check = await vmExec(vmOk, "cat /workspace/deno-jail-test/marker.txt");
    expect(check.exitCode).toBe(0);
    expect(check.stdout.trim()).toBe("ok");
  });

  it("run-ts: can import an uploaded SDK module from /home/user", async () => {
    // Upload SDK + app files into /home/user (tar contains sdk/ and app/ directories).
    const { status, buf } = await apiBinary(
      "POST",
      `${MANAGER_BASE}/v1/vms/${vmOk}/files/upload?dest=${encodeURIComponent("/workspace")}`,
      sdkUploadBuf ?? undefined
    );
    if (status !== 204) {
      // eslint-disable-next-line no-console
      console.error("[it] sdk upload failed", { status, body: buf.toString("utf-8", 0, 2048) });
    }
    expect(status).toBe(204);

    const res = await vmRunTsPath(vmOk, "/workspace/app/main.ts");
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe("hello world");
  });

  it("run-ts: rejects /home/user path inputs (workspace-only contract)", async () => {
    const { status } = await apiJson<ExecResult>("POST", `${MANAGER_BASE}/v1/vms/${vmOk}/run-ts`, { path: "/home/user/app/main.ts" });
    expect(status).toBe(400);
  });

  it("snapshots: template-sized VM uses snapshot provision mode", async () => {
    if (!ENABLE_SNAPSHOTS) return;
    const vm = await createVm({ cpu: 1, memMb: 256, allowIps: ["172.16.0.1/32"], outboundInternet: true });
    try {
      expect(vm.provisionMode).toBe("snapshot");
    } finally {
      await deleteVm(vm.id);
    }
  });

  it("snapshots: non-template size falls back to boot provision mode", async () => {
    if (!ENABLE_SNAPSHOTS) return;
    const vm = await createVm({ cpu: 1, memMb: 512, allowIps: ["172.16.0.1/32"], outboundInternet: true });
    try {
      expect(vm.provisionMode).toBe("boot");
    } finally {
      await deleteVm(vm.id);
    }
  });

  it("snapshots: guest eth0 IPv4 matches VM guestIp", async () => {
    if (!ENABLE_SNAPSHOTS) return;
    const vm = await createVm({ cpu: 1, memMb: 256, allowIps: ["172.16.0.1/32"], outboundInternet: true });
    try {
      const info = await getVm(vm.id);
      const res = await vmExec(vm.id, "ip -4 -o addr show dev eth0 | awk '{print $4}'");
      expect(res.exitCode).toBe(0);
      const ips = res.stdout
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.split("/")[0]);
      expect(ips).toContain(info.guestIp);
    } finally {
      await deleteVm(vm.id);
    }
  });

  it("snapshots: can snapshot a configured VM (with /home/user sdk files) and spawn multiple VMs from it", async () => {
    if (!ENABLE_SNAPSHOTS) return;

    // 1) Create base VM (cold or template snapshot; doesn't matter).
    const base = await createVm({ cpu: 1, memMb: 256, allowIps: ["172.16.0.1/32"], outboundInternet: true });
    let snap: SnapshotMeta | null = null;
    try {
      // 2) Upload SDK file into /home/user (simulate user-provided SDK).
      const sdkPath = `/workspace/sdk-${Date.now()}.txt`;
      const write = await vmExec(base.id, `echo "sdk-ok" > ${sdkPath}`);
      expect(write.exitCode).toBe(0);

      // 3) Snapshot this VM, then destroy it.
      snap = await createSnapshot(base.id);
    } finally {
      await deleteVm(base.id);
    }

    expect(snap).toBeTruthy();
    const all = await listSnapshots();
    expect(all.map((s) => s.id)).toContain(snap!.id);

    // 4) Create two VMs from the same snapshot in parallel.
    const [a, b] = await Promise.all([
      createVm({ cpu: 1, memMb: 256, allowIps: ["172.16.0.1/32"], outboundInternet: true, snapshotId: snap!.id } as any),
      createVm({ cpu: 1, memMb: 256, allowIps: ["172.16.0.1/32"], outboundInternet: true, snapshotId: snap!.id } as any)
    ]);

    try {
      expect(a.provisionMode).toBe("snapshot");
      expect(b.provisionMode).toBe("snapshot");

      // Each VM should see the SDK file from the snapshot disk baseline.
      const checkA = await vmExec(a.id, `cat /workspace/sdk-*.txt | tail -n 1`);
      const checkB = await vmExec(b.id, `cat /workspace/sdk-*.txt | tail -n 1`);
      expect(checkA.exitCode).toBe(0);
      expect(checkB.exitCode).toBe(0);
      expect(checkA.stdout.trim()).toBe("sdk-ok");
      expect(checkB.stdout.trim()).toBe("sdk-ok");

      // Isolation check: write in A should not appear in B (per-VM disk clone).
      const isoA = await vmExec(a.id, `echo "only-a" > /workspace/only-a.txt && cat /workspace/only-a.txt`);
      expect(isoA.exitCode).toBe(0);
      expect(isoA.stdout.trim()).toBe("only-a");
      const isoB = await vmExec(b.id, `test -f /workspace/only-a.txt`);
      expect(isoB.exitCode).not.toBe(0);
    } finally {
      await Promise.all([deleteVm(a.id), deleteVm(b.id)]);
    }
  });
});

