import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PeerService } from "../peerService.js";
import type { AgentClient, VmPeerLinkStore, VmStore } from "../../../types/interfaces.js";
import type { VmPeerLink, VmRecord } from "../../../types/vm.js";

class FakeVmStore implements VmStore {
  constructor(private readonly items: Map<string, VmRecord>) {}

  async create(vm: VmRecord): Promise<void> {
    this.items.set(vm.id, { ...vm });
  }

  async update(id: string, patch: Partial<VmRecord>): Promise<void> {
    const current = this.items.get(id);
    if (!current) return;
    this.items.set(id, { ...current, ...patch });
  }

  async get(id: string): Promise<VmRecord | null> {
    return this.items.get(id) ?? null;
  }

  async list(): Promise<VmRecord[]> {
    return Array.from(this.items.values());
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

class FakeVmPeerLinkStore implements VmPeerLinkStore {
  constructor(private readonly links = new Map<string, VmPeerLink[]>()) {}

  async replaceForConsumer(consumerVmId: string, peerLinks: VmPeerLink[]): Promise<void> {
    this.links.set(consumerVmId, [...peerLinks]);
  }

  async listForConsumer(consumerVmId: string): Promise<VmPeerLink[]> {
    return [...(this.links.get(consumerVmId) ?? [])];
  }

  async getForConsumerAlias(consumerVmId: string, alias: string): Promise<VmPeerLink | null> {
    return (this.links.get(consumerVmId) ?? []).find((link) => link.alias === alias) ?? null;
  }

  async updateSourceMode(consumerVmId: string, alias: string, sourceMode: "hidden" | "mounted"): Promise<boolean> {
    const current = this.links.get(consumerVmId) ?? [];
    const index = current.findIndex((link) => link.alias === alias);
    if (index < 0) return false;
    current[index] = { ...current[index], sourceMode };
    this.links.set(consumerVmId, current);
    return true;
  }

  async deleteForConsumer(consumerVmId: string): Promise<void> {
    this.links.delete(consumerVmId);
  }
}

class FakeAgentClient implements AgentClient {
  public replaceTreeCalls: Array<{ vmId: string; dest: string; data: Buffer; options?: { ownership?: "root" | "user"; readOnly?: boolean } }> = [];
  public runTsCalls: Array<{ vmId: string; payload: any }> = [];

  constructor(private readonly providerWorkspaceTar: Buffer) {}

  async health(): Promise<void> {}
  async applyAllowlist(): Promise<void> {}
  async configureNetwork(): Promise<void> {}
  async syncTime(): Promise<void> {}

  async exec(): Promise<{ exitCode: number; stdout: string; stderr: string; result?: unknown; error?: unknown }> {
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  async runTs(vmId: string, payload: any): Promise<{ exitCode: number; stdout: string; stderr: string; result?: unknown; error?: unknown }> {
    this.runTsCalls.push({ vmId, payload });
    if (String(payload.code).includes("const callable = [];")) {
      return { exitCode: 0, stdout: "", stderr: "", result: { exports: ["greet"] } };
    }
    return { exitCode: 0, stdout: "", stderr: "", result: "hello world" };
  }

  async runJs(): Promise<{ exitCode: number; stdout: string; stderr: string; result?: unknown; error?: unknown }> {
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  async upload(): Promise<void> {}

  async download(): Promise<Buffer> {
    return this.providerWorkspaceTar;
  }

  async replaceTree(
    vmId: string,
    dest: string,
    data: Buffer,
    options?: { ownership?: "root" | "user"; readOnly?: boolean }
  ): Promise<void> {
    this.replaceTreeCalls.push({ vmId, dest, data, options });
  }
}

const tempPaths: string[] = [];

function makeTar(files: Record<string, string>): Buffer {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rds-peer-test-"));
  tempPaths.push(root);
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
  }
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rds-peer-archive-"));
  tempPaths.push(outRoot);
  const out = path.join(outRoot, "archive.tar.gz");
  execFileSync("tar", ["-czf", out, "."], { cwd: root });
  return fs.readFileSync(out);
}

function extractFileFromTar(tarBuf: Buffer, targetPath: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rds-peer-extract-"));
  tempPaths.push(root);
  const tarPath = path.join(root, "archive.tar.gz");
  fs.writeFileSync(tarPath, tarBuf);
  execFileSync("tar", ["-xzf", tarPath, "-C", root]);
  return fs.readFileSync(path.join(root, targetPath), "utf-8");
}

function listTarEntries(tarBuf: Buffer): string[] {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rds-peer-list-"));
  tempPaths.push(root);
  const tarPath = path.join(root, "archive.tar.gz");
  fs.writeFileSync(tarPath, tarBuf);
  return execFileSync("tar", ["-tzf", tarPath], { encoding: "utf-8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

afterEach(() => {
  for (const item of tempPaths.splice(0)) {
    fs.rmSync(item, { recursive: true, force: true });
  }
});

describe("PeerService", () => {
  it("encrypts provider secrets, materializes runtime trees, and routes remote calls", async () => {
    const providerWorkspaceTar = makeTar({
      ".rds-peer/manifest.json": JSON.stringify(
        {
          sdk: {
            name: "Google SDK",
            description: "Calendar access without exposing provider source."
          },
          modules: [
            {
              path: "sdk/mod.ts",
              exports: [
                {
                  name: "greet",
                  description: "Return a greeting for the supplied name.",
                  params: [{ name: "name", description: "Person to greet", schema: { type: "string" } }],
                  returns: { description: "Greeting text", schema: { type: "string" } },
                  examples: [
                    {
                      description: "Print a greeting",
                      code: 'import { greet } from "file:///workspace/peers/google/proxy/sdk/mod.ts";\nconsole.log(await greet("world"));'
                    }
                  ]
                }
              ]
            }
          ]
        },
        null,
        2
      ),
      "sdk/mod.ts": 'export async function greet(name: string) { return "hello " + name; }\n'
    });
    const providerVm: VmRecord = {
      id: "provider-1",
      state: "RUNNING",
      cpu: 1,
      memMb: 256,
      guestIp: "172.16.0.2",
      tapName: "tap-2",
      vsockCid: 5001,
      outboundInternet: false,
      allowIps: [],
      rootfsPath: "/tmp/provider/rootfs.ext4",
      kernelPath: "/tmp/provider/vmlinux",
      logsDir: "/tmp/provider/logs",
      createdAt: new Date().toISOString()
    };
    const consumerVm: VmRecord = {
      id: "consumer-1",
      state: "RUNNING",
      cpu: 1,
      memMb: 256,
      guestIp: "172.16.0.3",
      tapName: "tap-3",
      vsockCid: 5002,
      outboundInternet: false,
      allowIps: [],
      rootfsPath: "/tmp/consumer/rootfs.ext4",
      kernelPath: "/tmp/consumer/vmlinux",
      logsDir: "/tmp/consumer/logs",
      createdAt: new Date().toISOString()
    };

    const store = new FakeVmStore(new Map([
      [providerVm.id, providerVm],
      [consumerVm.id, consumerVm]
    ]));
    const peerLinks = new FakeVmPeerLinkStore(new Map([[consumerVm.id, [{ alias: "google", vmId: providerVm.id, sourceMode: "mounted" }]]]));
    const agentClient = new FakeAgentClient(providerWorkspaceTar);
    const service = new PeerService({
      store,
      peerLinks,
      agentClient,
      vmSecretKey: "test-secret-key",
      managerInternalBaseUrl: "http://172.16.0.1:3000"
    });

    const providerPatch = await service.buildCreatePatch({ cpu: 1, memMb: 256, allowIps: [], secretEnv: ["API_TOKEN=secret"] }, providerVm.id);
    await store.update(providerVm.id, providerPatch);

    const mergedEnv = await service.mergeEnvList((await store.get(providerVm.id))!, ["EXTRA=1"]);
    expect(mergedEnv).toContain("API_TOKEN=secret");
    expect(mergedEnv).toContain("EXTRA=1");

    await service.onVmRunning(consumerVm.id);

    expect(agentClient.replaceTreeCalls.map((call) => call.dest)).toEqual(["/workspace/.rds", "/workspace/peers"]);
    const bridgeConfig = JSON.parse(extractFileFromTar(agentClient.replaceTreeCalls[0].data, "peer-bridge.json"));
    const peerEntries = listTarEntries(agentClient.replaceTreeCalls[1].data);
    expect(peerEntries).toContain("./index.json");
    expect(peerEntries).toContain("./google/manifest.json");
    expect(peerEntries).toContain("./google/README.md");
    expect(peerEntries).toContain("./google/proxy/sdk/mod.ts");
    expect(peerEntries).toContain("./google/source/sdk/mod.ts");
    const readme = extractFileFromTar(agentClient.replaceTreeCalls[1].data, "google/README.md");
    expect(readme).toContain("Use proxy imports for execution");
    const manifest = JSON.parse(extractFileFromTar(agentClient.replaceTreeCalls[1].data, "google/manifest.json"));
    expect(manifest.sdk.name).toBe("Google SDK");
    const index = JSON.parse(extractFileFromTar(agentClient.replaceTreeCalls[1].data, "index.json"));
    expect(index.peers).toEqual([
      {
        alias: "google",
        sdkName: "Google SDK",
        summary: "Calendar access without exposing provider source.",
        manifestPath: "/workspace/peers/google/manifest.json",
        readmePath: "/workspace/peers/google/README.md",
        proxyRoot: "/workspace/peers/google/proxy",
        sourceMode: "mounted"
      }
    ]);
    const result = await service.invokeWithBridgeToken(bridgeConfig.token, {
      alias: "google",
      modulePath: "/workspace/sdk/mod.ts",
      exportName: "greet",
      args: ["world"]
    });

    expect(result).toBe("hello world");
    expect(agentClient.runTsCalls.some((call) => Array.isArray(call.payload.env) && call.payload.env.includes("API_TOKEN=secret"))).toBe(true);
  });

  it("rejects invalid bridge tokens", async () => {
    const store = new FakeVmStore(new Map());
    const peerLinks = new FakeVmPeerLinkStore();
    const agentClient = new FakeAgentClient(makeTar({ "sdk/mod.ts": "export const noop = () => {};\n" }));
    const service = new PeerService({
      store,
      peerLinks,
      agentClient,
      vmSecretKey: "test-secret-key"
    });

    await expect(service.invokeWithBridgeToken("bad-token", { alias: "google", modulePath: "/workspace/sdk/mod.ts" })).rejects.toMatchObject({
      statusCode: 401
    });
  });

  it("rejects peer sync when the provider manifest is missing", async () => {
    const providerVm: VmRecord = {
      id: "provider-1",
      state: "RUNNING",
      cpu: 1,
      memMb: 256,
      guestIp: "172.16.0.2",
      tapName: "tap-2",
      vsockCid: 5001,
      outboundInternet: false,
      allowIps: [],
      rootfsPath: "/tmp/provider/rootfs.ext4",
      kernelPath: "/tmp/provider/vmlinux",
      logsDir: "/tmp/provider/logs",
      createdAt: new Date().toISOString()
    };
    const consumerVm: VmRecord = {
      id: "consumer-1",
      state: "RUNNING",
      cpu: 1,
      memMb: 256,
      guestIp: "172.16.0.3",
      tapName: "tap-3",
      vsockCid: 5002,
      outboundInternet: false,
      allowIps: [],
      rootfsPath: "/tmp/consumer/rootfs.ext4",
      kernelPath: "/tmp/consumer/vmlinux",
      logsDir: "/tmp/consumer/logs",
      createdAt: new Date().toISOString()
    };

    const store = new FakeVmStore(new Map([
      [providerVm.id, providerVm],
      [consumerVm.id, consumerVm]
    ]));
    const peerLinks = new FakeVmPeerLinkStore(new Map([[consumerVm.id, [{ alias: "google", vmId: providerVm.id }]]]));
    const agentClient = new FakeAgentClient(makeTar({ "sdk/mod.ts": 'export async function greet() { return "hi"; }\n' }));
    const service = new PeerService({
      store,
      peerLinks,
      agentClient,
      vmSecretKey: "test-secret-key"
    });

    await expect(service.syncPeerFilesystem(consumerVm.id)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("Peer alias google: missing provider manifest")
    });
  });
});
