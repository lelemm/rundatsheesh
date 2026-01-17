import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import type { AgentClient, FirecrackerManager, NetworkManager, StorageProvider, VmStore } from "../types/interfaces.js";
import type { VmCreateRequest, VmProvisionMode, VmPublic, VmRecord } from "../types/vm.js";
import type { SnapshotMeta } from "../types/snapshot.js";
import { HttpError } from "../api/httpErrors.js";

export interface VmServiceOptions {
  store: VmStore;
  firecracker: FirecrackerManager;
  network: NetworkManager;
  agentClient: AgentClient;
  storage: StorageProvider;
  kernelPath: string;
  snapshots?: { enabled: boolean; version: string; templateCpu: number; templateMemMb: number };
  vsockCidStart?: number;
  limits?: {
    maxVms: number;
    maxCpu: number;
    maxMemMb: number;
    maxAllowIps: number;
    maxExecTimeoutMs: number;
    maxRunTsTimeoutMs: number;
  };
}

export class VmService {
  private readonly store: VmStore;
  private readonly firecracker: FirecrackerManager;
  private readonly network: NetworkManager;
  private readonly agentClient: AgentClient;
  private readonly storage: StorageProvider;
  private readonly kernelPath: string;
  private readonly snapshots?: { enabled: boolean; version: string; templateCpu: number; templateMemMb: number };
  private readonly limits: NonNullable<VmServiceOptions["limits"]>;
  private nextVsockCid: number;

  constructor(options: VmServiceOptions) {
    this.store = options.store;
    this.firecracker = options.firecracker;
    this.network = options.network;
    this.agentClient = options.agentClient;
    this.storage = options.storage;
    this.kernelPath = options.kernelPath;
    this.snapshots = options.snapshots;
    this.limits = options.limits ?? {
      maxVms: 20,
      maxCpu: 4,
      maxMemMb: 2048,
      maxAllowIps: 64,
      maxExecTimeoutMs: 120_000,
      maxRunTsTimeoutMs: 120_000
    };
    this.nextVsockCid = options.vsockCidStart ?? 5000;
  }

  async list(): Promise<VmPublic[]> {
    const items = await this.store.list();
    return items.map((vm) => toPublic(vm));
  }

  async get(id: string): Promise<VmPublic | null> {
    const vm = await this.store.get(id);
    return vm ? toPublic(vm) : null;
  }

  async create(request: VmCreateRequest): Promise<VmPublic> {
    validateCreateRequest(request, this.limits);
    const active = (await this.store.list()).filter((vm) => vm.state !== "DELETED");
    if (active.length >= this.limits.maxVms) {
      throw new HttpError(429, `VM quota exceeded (maxVms=${this.limits.maxVms})`);
    }

    const tTotalStart = Date.now();
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const { guestIp, tapName } = await this.network.allocateIp();
    const tStorageStart = Date.now();
    let rootfsPath = "";
    let logsDir = "";
    if (request.snapshotId) {
      const snap = await this.storage.getSnapshotArtifactPaths(request.snapshotId);
      const meta = await this.storage.readSnapshotMeta(request.snapshotId);
      if (!meta || !meta.hasDisk) {
        throw new Error("Snapshot not found or missing disk baseline");
      }
      if (meta.cpu !== request.cpu || meta.memMb !== request.memMb) {
        throw new Error(`Snapshot cpu/mem mismatch: snapshot=${meta.cpu}/${meta.memMb} requested=${request.cpu}/${request.memMb}`);
      }
      const hasAll = await Promise.all([fs.stat(snap.memPath), fs.stat(snap.statePath), fs.stat(snap.diskPath)])
        .then(() => true)
        .catch(() => false);
      if (!hasAll) {
        throw new Error("Snapshot artifacts missing on disk");
      }
      const prepared = await this.storage.prepareVmStorageFromDisk(id, snap.diskPath);
      rootfsPath = prepared.rootfsPath;
      logsDir = prepared.logsDir;
    } else {
      const prepared = await this.storage.prepareVmStorage(id);
      rootfsPath = prepared.rootfsPath;
      logsDir = prepared.logsDir;
    }
    const storageMs = Date.now() - tStorageStart;

    const vm: VmRecord = {
      id,
      state: "CREATED",
      cpu: request.cpu,
      memMb: request.memMb,
      guestIp,
      tapName,
      vsockCid: this.allocateVsockCid(),
      outboundInternet: request.outboundInternet ?? false,
      allowIps: request.allowIps,
      rootfsPath,
      logsDir,
      createdAt
    };

    await this.store.create(vm);

    try {
      // Explicit snapshotId takes precedence over template snapshots.
      if (request.snapshotId) {
        const snapshotPaths = await this.storage.getSnapshotArtifactPaths(request.snapshotId);
        let mode: VmProvisionMode = "snapshot";
        let firecrackerMs = 0;
        let snapshotLoadMs = 0;

        await this.network.configure(vm, tapName, { up: false });
        const tRestoreStart = Date.now();
        await this.firecracker.restoreFromSnapshot(vm, rootfsPath, this.kernelPath, tapName, {
          memPath: snapshotPaths.memPath,
          statePath: snapshotPaths.statePath
        });
        snapshotLoadMs = Date.now() - tRestoreStart;

        await this.store.update(vm.id, { state: "STARTING" });
        const tAgentHealthStart = Date.now();
        await this.agentClient.health(vm.id);
        const agentHealthMs = Date.now() - tAgentHealthStart;

        await this.agentClient.configureNetwork(vm.id, {
          iface: "eth0",
          ip: vm.guestIp,
          cidr: 24,
          gateway: "172.16.0.1",
          mac: generateMac(vm.id)
        });
        await this.network.bringUpTap(tapName);

        await this.agentClient.applyAllowlist(vm.id, request.allowIps, vm.outboundInternet);
        await this.store.update(vm.id, { state: "RUNNING", provisionMode: mode });
        const totalMs = Date.now() - tTotalStart;
        // eslint-disable-next-line no-console
        console.info("[vm-provision]", {
          vmId: vm.id,
          mode,
          storageMs,
          firecrackerMs,
          snapshotLoadMs,
          agentHealthMs,
          totalMs
        });

        const latest = await this.store.get(vm.id);
        return toPublic(latest ?? vm);
      }

      const canUseSnapshot =
        Boolean(this.snapshots?.enabled) && request.cpu === this.snapshots!.templateCpu && request.memMb === this.snapshots!.templateMemMb;

      let mode: VmProvisionMode = "boot";
      let firecrackerMs = 0;
      let snapshotLoadMs = 0;

      if (canUseSnapshot) {
        const snapshotPaths = await this.storage.getSnapshotArtifactPaths(this.snapshots!.version);
        const snapshotExists = await Promise.all([fs.stat(snapshotPaths.memPath), fs.stat(snapshotPaths.statePath)])
          .then(() => true)
          .catch(() => false);

        if (snapshotExists) {
          mode = "snapshot";
          // Keep tap DOWN until guest networking is reconfigured (avoid L2 conflicts).
          await this.network.configure(vm, tapName, { up: false });
          try {
            const tRestoreStart = Date.now();
            await this.firecracker.restoreFromSnapshot(vm, rootfsPath, this.kernelPath, tapName, {
              memPath: snapshotPaths.memPath,
              statePath: snapshotPaths.statePath
            });
            snapshotLoadMs = Date.now() - tRestoreStart;
          } catch (err) {
            // Best-effort fallback: if snapshot restore fails (version mismatch, API incompatibility),
            // tear down the partial VM and do a normal boot path.
            // eslint-disable-next-line no-console
            console.warn("[vm-provision] snapshot restore failed; falling back to cold boot", { vmId: vm.id, err: String(err) });
            mode = "boot";
            await this.firecracker.destroy(vm).catch(() => undefined);
            await this.network.bringUpTap(tapName).catch(() => undefined);
            const tFirecrackerStart = Date.now();
            await this.firecracker.createAndStart(vm, rootfsPath, this.kernelPath, tapName);
            firecrackerMs = Date.now() - tFirecrackerStart;
          }
        } else {
          await this.network.configure(vm, tapName);
          const tFirecrackerStart = Date.now();
          await this.firecracker.createAndStart(vm, rootfsPath, this.kernelPath, tapName);
          firecrackerMs = Date.now() - tFirecrackerStart;
        }
      } else {
        await this.network.configure(vm, tapName);
        const tFirecrackerStart = Date.now();
        await this.firecracker.createAndStart(vm, rootfsPath, this.kernelPath, tapName);
        firecrackerMs = Date.now() - tFirecrackerStart;
      }

      await this.store.update(vm.id, { state: "STARTING" });
      const tAgentHealthStart = Date.now();
      await this.agentClient.health(vm.id);
      const agentHealthMs = Date.now() - tAgentHealthStart;

      // After snapshot restore, reconfigure guest networking over VSock, then bring the tap up.
      if (mode === "snapshot") {
        await this.agentClient.configureNetwork(vm.id, {
          iface: "eth0",
          ip: vm.guestIp,
          cidr: 24,
          gateway: "172.16.0.1",
          mac: generateMac(vm.id)
        });
        await this.network.bringUpTap(tapName);
      }

      await this.agentClient.applyAllowlist(vm.id, request.allowIps, vm.outboundInternet);
      await this.store.update(vm.id, { state: "RUNNING", provisionMode: mode });
      const totalMs = Date.now() - tTotalStart;
      // Coarse provisioning metrics for troubleshooting slow starts.
      // Intentionally console-based so it shows up in container logs without extra wiring.
      // eslint-disable-next-line no-console
      console.info("[vm-provision]", {
        vmId: vm.id,
        mode,
        storageMs,
        firecrackerMs,
        snapshotLoadMs,
        agentHealthMs,
        totalMs
      });
    } catch (error) {
      await this.store.update(vm.id, { state: "ERROR" });
      throw error;
    }

    const latest = await this.store.get(vm.id);
    return toPublic(latest ?? vm);
  }

  async createSnapshot(id: string): Promise<SnapshotMeta> {
    const vm = await this.requireVm(id);
    if (vm.state !== "RUNNING") {
      throw new Error("VM must be RUNNING to snapshot");
    }

    // Best-effort filesystem quiesce for /home/user content.
    await this.agentClient.exec(vm.id, { cmd: "sync" });

    const snapshotId = `snap-${randomUUID()}`;
    const paths = await this.storage.getSnapshotArtifactPaths(snapshotId);

    await this.firecracker.createSnapshot(vm, { memPath: paths.memPath, statePath: paths.statePath });
    await this.storage.cloneDisk(vm.rootfsPath, paths.diskPath);

    const meta: SnapshotMeta = {
      id: snapshotId,
      kind: "vm",
      createdAt: new Date().toISOString(),
      cpu: vm.cpu,
      memMb: vm.memMb,
      sourceVmId: vm.id,
      hasDisk: true
    };
    await fs.writeFile(paths.metaPath, JSON.stringify(meta, null, 2), "utf-8");
    return meta;
  }

  async listSnapshots(): Promise<SnapshotMeta[]> {
    const ids = await this.storage.listSnapshots();
    const items = await Promise.all(
      ids.map(async (sid) => {
        const meta = await this.storage.readSnapshotMeta(sid);
        return meta;
      })
    );
    return items.filter(Boolean) as SnapshotMeta[];
  }

  async start(id: string): Promise<void> {
    const vm = await this.requireVm(id);
    await this.store.update(vm.id, { state: "STARTING" });
    await this.network.configure(vm, vm.tapName);
    const tFirecrackerStart = Date.now();
    await this.firecracker.createAndStart(vm, vm.rootfsPath, this.kernelPath, vm.tapName);
    const firecrackerMs = Date.now() - tFirecrackerStart;
    const tAgentHealthStart = Date.now();
    await this.agentClient.health(vm.id);
    const agentHealthMs = Date.now() - tAgentHealthStart;
    await this.agentClient.applyAllowlist(vm.id, vm.allowIps, vm.outboundInternet);
    await this.store.update(vm.id, { state: "RUNNING", provisionMode: "boot" });
    // eslint-disable-next-line no-console
    console.info("[vm-start]", { vmId: vm.id, firecrackerMs, agentHealthMs });
  }

  async stop(id: string): Promise<void> {
    const vm = await this.requireVm(id);
    await this.store.update(vm.id, { state: "STOPPING" });
    await this.firecracker.stop(vm);
    // Tear down host networking so a later `start` can recreate the tap cleanly.
    await this.network.teardown(vm, vm.tapName).catch(() => undefined);
    await this.store.update(vm.id, { state: "STOPPED" });
  }

  async destroy(id: string): Promise<void> {
    const vm = await this.requireVm(id);
    await this.firecracker.destroy(vm);
    await this.network.teardown(vm, vm.tapName);
    await this.storage.cleanupVmStorage(vm.id);
    await this.store.update(vm.id, { state: "DELETED" });
  }

  async exec(id: string, payload: { cmd: string; cwd?: string; env?: Record<string, string>; timeoutMs?: number }) {
    const vm = await this.requireVm(id);
    if (typeof payload.timeoutMs === "number" && payload.timeoutMs > this.limits.maxExecTimeoutMs) {
      throw new HttpError(400, `timeoutMs exceeds maxExecTimeoutMs=${this.limits.maxExecTimeoutMs}`);
    }
    return this.agentClient.exec(vm.id, payload);
  }

  async runTs(id: string, payload: { path?: string; code?: string; args?: string[]; denoFlags?: string[]; timeoutMs?: number }) {
    const vm = await this.requireVm(id);
    if (typeof payload.timeoutMs === "number" && payload.timeoutMs > this.limits.maxRunTsTimeoutMs) {
      throw new HttpError(400, `timeoutMs exceeds maxRunTsTimeoutMs=${this.limits.maxRunTsTimeoutMs}`);
    }
    return this.agentClient.runTs(vm.id, { ...payload, allowNet: vm.outboundInternet });
  }

  async uploadFiles(id: string, dest: string, data: Buffer): Promise<void> {
    const vm = await this.requireVm(id);
    await this.agentClient.upload(vm.id, dest, data);
  }

  async downloadFiles(id: string, path: string): Promise<Buffer> {
    const vm = await this.requireVm(id);
    return this.agentClient.download(vm.id, path);
  }

  private async requireVm(id: string): Promise<VmRecord> {
    const vm = await this.store.get(id);
    if (!vm) {
      throw new Error("VM not found");
    }
    return vm;
  }

  private allocateVsockCid(): number {
    const cid = this.nextVsockCid;
    this.nextVsockCid += 1;
    return cid;
  }
}

function validateCreateRequest(req: VmCreateRequest, limits: VmService["limits"]): void {
  if (!Number.isFinite(req.cpu) || req.cpu <= 0 || req.cpu > limits.maxCpu) {
    throw new HttpError(400, `Invalid cpu (maxCpu=${limits.maxCpu})`);
  }
  if (!Number.isFinite(req.memMb) || req.memMb <= 0 || req.memMb > limits.maxMemMb) {
    throw new HttpError(400, `Invalid memMb (maxMemMb=${limits.maxMemMb})`);
  }
  if (!Array.isArray(req.allowIps)) {
    throw new HttpError(400, "allowIps must be an array");
  }
  if (req.allowIps.length > limits.maxAllowIps) {
    throw new HttpError(400, `Too many allowIps (maxAllowIps=${limits.maxAllowIps})`);
  }
  for (const ip of req.allowIps) {
    if (typeof ip !== "string" || ip.length === 0 || ip.length > 128) {
      throw new HttpError(400, "Invalid allowIps entry");
    }
  }
}

function toPublic(vm: VmRecord): VmPublic {
  return {
    id: vm.id,
    state: vm.state,
    cpu: vm.cpu,
    memMb: vm.memMb,
    guestIp: vm.guestIp,
    outboundInternet: vm.outboundInternet,
    createdAt: vm.createdAt,
    provisionMode: vm.provisionMode
  };
}

function generateMac(seed: string) {
  const hash = Buffer.from(seed.replace(/-/g, "")).slice(0, 6);
  hash[0] = (hash[0] & 0xfe) | 0x02;
  return Array.from(hash)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(":");
}
