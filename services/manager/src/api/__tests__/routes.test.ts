import { describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import type { AppDeps } from "../../types/deps.js";
import type { VmPublic } from "../../types/vm.js";

class FakeVmService {
  public created: VmPublic | null = null;
  public listResult: VmPublic[] = [];
  public startIds: string[] = [];
  public stopIds: string[] = [];
  public destroyIds: string[] = [];
  public execCalls: Array<{ id: string; cmd: string }> = [];
  public runTsCalls: Array<{ id: string; payload: Record<string, unknown> }> = [];

  async list() {
    return this.listResult;
  }

  async get(id: string) {
    return this.listResult.find((vm) => vm.id === id) ?? null;
  }

  async create(_request: { cpu: number; memMb: number; allowIps: string[] }) {
    const vm: VmPublic = {
      id: "vm-1",
      state: "RUNNING",
      cpu: 1,
      memMb: 256,
      guestIp: "172.16.0.2",
      outboundInternet: false,
      createdAt: new Date().toISOString()
    };
    this.created = vm;
    return vm;
  }

  async start(id: string) {
    this.startIds.push(id);
  }

  async stop(id: string) {
    this.stopIds.push(id);
  }

  async destroy(id: string) {
    this.destroyIds.push(id);
  }

  async exec(id: string, payload: { cmd: string }) {
    this.execCalls.push({ id, cmd: payload.cmd });
    return { exitCode: 0, stdout: "ok", stderr: "" };
  }

  async runTs(id: string, payload: Record<string, unknown>) {
    this.runTsCalls.push({ id, payload });
    return { exitCode: 0, stdout: "ok", stderr: "" };
  }
}

const apiKey = "test-key";

function buildTestApp(service: FakeVmService) {
  const deps = {
    vmService: service,
    store: {} as AppDeps["store"],
    firecracker: {} as AppDeps["firecracker"],
    network: {} as AppDeps["network"],
    agentClient: {} as AppDeps["agentClient"],
    storage: {} as AppDeps["storage"],
    storageRoot: "/tmp",
    images: {} as AppDeps["images"]
  } as unknown as AppDeps;
  return buildApp({ apiKey, adminEmail: "admin@example.com", adminPassword: "admin", deps });
}

describe("manager API", () => {
  it("rejects missing API key", async () => {
    const service = new FakeVmService();
    const app = buildTestApp(service);

    const res = await app.inject({ method: "GET", url: "/v1/vms" });
    expect(res.statusCode).toBe(401);
  });

  it("lists VMs", async () => {
    const service = new FakeVmService();
    service.listResult = [
      {
        id: "vm-1",
        state: "RUNNING",
        cpu: 1,
        memMb: 256,
        guestIp: "172.16.0.2",
        outboundInternet: false,
        createdAt: new Date().toISOString()
      }
    ];

    const app = buildTestApp(service);
    const res = await app.inject({ method: "GET", url: "/v1/vms", headers: { "x-api-key": apiKey } });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).length).toBe(1);
  });

  it("returns 404 for missing VM", async () => {
    const service = new FakeVmService();
    const app = buildTestApp(service);

    const res = await app.inject({ method: "GET", url: "/v1/vms/missing", headers: { "x-api-key": apiKey } });
    expect(res.statusCode).toBe(404);
  });

  it("creates a VM", async () => {
    const service = new FakeVmService();
    const app = buildTestApp(service);

    const res = await app.inject({
      method: "POST",
      url: "/v1/vms",
      headers: { "x-api-key": apiKey },
      payload: { cpu: 1, memMb: 256, allowIps: ["1.2.3.4/32"] }
    });

    expect(res.statusCode).toBe(201);
    expect(service.created?.id).toBe("vm-1");
  });

  it("starts/stops/destroys a VM", async () => {
    const service = new FakeVmService();
    const app = buildTestApp(service);

    await app.inject({ method: "POST", url: "/v1/vms/vm-1/start", headers: { "x-api-key": apiKey } });
    await app.inject({ method: "POST", url: "/v1/vms/vm-1/stop", headers: { "x-api-key": apiKey } });
    await app.inject({ method: "DELETE", url: "/v1/vms/vm-1", headers: { "x-api-key": apiKey } });

    expect(service.startIds).toEqual(["vm-1"]);
    expect(service.stopIds).toEqual(["vm-1"]);
    expect(service.destroyIds).toEqual(["vm-1"]);
  });

  it("execs and runs TS", async () => {
    const service = new FakeVmService();
    const app = buildTestApp(service);

    const execRes = await app.inject({
      method: "POST",
      url: "/v1/vms/vm-1/exec",
      headers: { "x-api-key": apiKey },
      payload: { cmd: "id" }
    });

    const tsRes = await app.inject({
      method: "POST",
      url: "/v1/vms/vm-1/run-ts",
      headers: { "x-api-key": apiKey },
      payload: { code: "console.log('hi')" }
    });

    expect(execRes.statusCode).toBe(200);
    expect(tsRes.statusCode).toBe(200);
    expect(service.execCalls[0].cmd).toBe("id");
    expect(service.runTsCalls.length).toBe(1);
  });
});
