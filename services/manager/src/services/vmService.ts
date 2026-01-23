import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentClient, FirecrackerManager, NetworkManager, StorageProvider, VmStore } from "../types/interfaces.js";
import type { VmCreateRequest, VmProvisionMode, VmPublic, VmRecord } from "../types/vm.js";
import type { SnapshotMeta } from "../types/snapshot.js";
import { HttpError } from "../api/httpErrors.js";
import type { ActivityService } from "../telemetry/activityService.js";
import type { ImageService } from "./imageService.js";
import { ExecLogService } from "./execLogService.js";

const LOG_FILES = new Set(["firecracker.log", "firecracker.stdout.log", "firecracker.stderr.log"]);

export interface VmServiceOptions {
  store: VmStore;
  firecracker: FirecrackerManager;
  network: NetworkManager;
  agentClient: AgentClient;
  storage: StorageProvider;
  images: ImageService;
  activity?: ActivityService;
  snapshots?: { enabled: boolean; version: string; templateCpu: number; templateMemMb: number };
  vsockCidStart?: number;
  dnsServerIp?: string;
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
  private readonly images: ImageService;
  private readonly activity?: ActivityService;
  private readonly snapshots?: { enabled: boolean; version: string; templateCpu: number; templateMemMb: number };
  private readonly limits: NonNullable<VmServiceOptions["limits"]>;
  private readonly dnsServerIp?: string;
  private nextVsockCid: number;
  private readonly execLogs: ExecLogService;

  constructor(options: VmServiceOptions) {
    this.store = options.store;
    this.firecracker = options.firecracker;
    this.network = options.network;
    this.agentClient = options.agentClient;
    this.storage = options.storage;
    this.images = options.images;
    this.activity = options.activity;
    this.snapshots = options.snapshots;
    this.dnsServerIp = options.dnsServerIp;
    this.execLogs = new ExecLogService();
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
    // Deleted VMs are tombstoned (for auditing/logging) but should not appear in normal listings.
    return items.filter((vm) => vm.state !== "DELETED").map((vm) => toPublic(vm));
  }

  async get(id: string): Promise<VmPublic | null> {
    const vm = await this.store.get(id);
    if (!vm) return null;
    if (vm.state === "DELETED") return null;
    return toPublic(vm);
  }

  async create(request: VmCreateRequest): Promise<VmPublic> {
    validateCreateRequest(request, this.limits);
    const active = (await this.store.list()).filter((vm) => vm.state !== "DELETED");
    if (active.length >= this.limits.maxVms) {
      throw new HttpError(429, `VM quota exceeded (maxVms=${this.limits.maxVms})`);
    }

    const mbToBytes = (mb: number) => Math.floor(mb * 1024 * 1024);
    const minDiskMb = (bytes: number) => Math.ceil(bytes / (1024 * 1024));
    const DEFAULT_DISK_MB = 512;
    const DEFAULT_DISK_HEADROOM_MB = 256;

    const tTotalStart = Date.now();
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const { guestIp, tapName } = await this.network.allocateIp();
    const tStorageStart = Date.now();
    let rootfsPath = "";
    let kernelPath = "";
    let logsDir = "";
    let imageId: string | undefined;
    if (request.snapshotId) {
      const snap = await this.storage.getSnapshotArtifactPaths(request.snapshotId);
      const meta = await this.storage.readSnapshotMeta(request.snapshotId);
      if (!meta || !meta.hasDisk) {
        throw new HttpError(404, "Snapshot not found or missing disk baseline");
      }
      if (meta.cpu !== request.cpu || meta.memMb !== request.memMb) {
        throw new HttpError(
          400,
          `Snapshot cpu/mem mismatch: snapshot=${meta.cpu}/${meta.memMb} requested=${request.cpu}/${request.memMb}`
        );
      }
      const hasAll = await Promise.all([fs.stat(snap.memPath), fs.stat(snap.statePath), fs.stat(snap.diskPath)])
        .then(() => true)
        .catch(() => false);
      if (!hasAll) {
        throw new HttpError(409, "Snapshot artifacts missing on disk");
      }
      const diskBytes = (await fs.stat(snap.diskPath)).size;
      const resolved = await this.images.resolveForVmCreate(meta.imageId ?? request.imageId);
      imageId = resolved.imageId;
      const minMb = minDiskMb(diskBytes);
      const requestedMb =
        typeof request.diskSizeMb === "number"
          ? Math.max(request.diskSizeMb, minMb)
          : Math.max(DEFAULT_DISK_MB, minMb + DEFAULT_DISK_HEADROOM_MB);
      if (requestedMb < minDiskMb(diskBytes)) {
        throw new HttpError(400, `diskSizeMb too small (min=${minDiskMb(diskBytes)})`);
      }
      const prepared = await this.storage.prepareVmStorageFromDisk(id, {
        kernelSrcPath: resolved.kernelSrcPath,
        diskSrcPath: snap.diskPath,
        diskSizeBytes: mbToBytes(requestedMb)
      });
      rootfsPath = prepared.rootfsPath;
      logsDir = prepared.logsDir;
      kernelPath = prepared.kernelPath;
    } else {
      const resolved = await this.images.resolveForVmCreate(request.imageId);
      imageId = resolved.imageId;
      const minMb = minDiskMb(resolved.baseRootfsBytes);
      const requestedMb =
        typeof request.diskSizeMb === "number"
          ? Math.max(request.diskSizeMb, minMb)
          : Math.max(DEFAULT_DISK_MB, minMb + DEFAULT_DISK_HEADROOM_MB);
      if (requestedMb < minMb) {
        throw new HttpError(400, `diskSizeMb too small (min=${minMb})`);
      }
      const prepared = await this.storage.prepareVmStorage(id, {
        kernelSrcPath: resolved.kernelSrcPath,
        baseRootfsPath: resolved.baseRootfsPath,
        diskSizeBytes: mbToBytes(requestedMb)
      });
      rootfsPath = prepared.rootfsPath;
      logsDir = prepared.logsDir;
      kernelPath = prepared.kernelPath;
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
      imageId,
      rootfsPath,
      kernelPath,
      logsDir,
      createdAt
    };

    await this.store.create(vm);
    await this.activity?.logEvent({
      type: "vm.created",
      entityType: "vm",
      entityId: vm.id,
      message: `VM created (${vm.cpu} vCPU, ${vm.memMb} MiB)`,
      meta: { cpu: vm.cpu, memMb: vm.memMb, outboundInternet: vm.outboundInternet }
    });

    try {
      // Explicit snapshotId takes precedence over template snapshots.
      if (request.snapshotId) {
        const snapshotPaths = await this.storage.getSnapshotArtifactPaths(request.snapshotId);
        let mode: VmProvisionMode = "snapshot";
        let firecrackerMs = 0;
        let snapshotLoadMs = 0;

        await this.network.configure(vm, tapName, { up: false });
        const tRestoreStart = Date.now();
        await this.firecracker.restoreFromSnapshot(vm, rootfsPath, vm.kernelPath, tapName, {
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
          mac: generateMac(vm.id),
          ...(this.dnsServerIp ? { dns: this.dnsServerIp } : {})
        });
        await this.network.bringUpTap(tapName);

        await this.agentClient.applyAllowlist(vm.id, request.allowIps, vm.outboundInternet);
        await this.store.update(vm.id, { state: "RUNNING", provisionMode: mode });
        await this.activity?.logEvent({
          type: "vm.started",
          entityType: "vm",
          entityId: vm.id,
          message: "VM started (restored from snapshot)",
          meta: { mode, snapshotId: request.snapshotId }
        });
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
            await this.firecracker.restoreFromSnapshot(vm, rootfsPath, vm.kernelPath, tapName, {
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
            await this.firecracker.createAndStart(vm, rootfsPath, vm.kernelPath, tapName);
            firecrackerMs = Date.now() - tFirecrackerStart;
          }
        } else {
          await this.network.configure(vm, tapName);
          const tFirecrackerStart = Date.now();
          await this.firecracker.createAndStart(vm, rootfsPath, vm.kernelPath, tapName);
          firecrackerMs = Date.now() - tFirecrackerStart;
        }
      } else {
        await this.network.configure(vm, tapName);
        const tFirecrackerStart = Date.now();
        await this.firecracker.createAndStart(vm, rootfsPath, vm.kernelPath, tapName);
        firecrackerMs = Date.now() - tFirecrackerStart;
      }

      await this.store.update(vm.id, { state: "STARTING" });
      const tAgentHealthStart = Date.now();
      await this.agentClient.health(vm.id);
      const agentHealthMs = Date.now() - tAgentHealthStart;
      // Keep guest clock in sync so TLS validation works reliably (cert NotValidYet issues are usually clock skew).
      await this.agentClient.syncTime(vm.id, { unixTimeMs: Date.now() }).catch(() => undefined);

      // After snapshot restore, reconfigure guest networking over VSock, then bring the tap up.
      if (mode === "snapshot") {
        await this.agentClient.configureNetwork(vm.id, {
          iface: "eth0",
          ip: vm.guestIp,
          cidr: 24,
          gateway: "172.16.0.1",
          mac: generateMac(vm.id),
          ...(this.dnsServerIp ? { dns: this.dnsServerIp } : {})
        });
        await this.network.bringUpTap(tapName);
      } else if (this.dnsServerIp) {
        // For cold boot VMs, networking is configured via kernel cmdline, but DNS may not be.
        // If a custom DNS server is configured at the manager level, push it to the guest.
        await this.agentClient.configureNetwork(vm.id, {
          iface: "eth0",
          ip: vm.guestIp,
          cidr: 24,
          gateway: "172.16.0.1",
          mac: generateMac(vm.id),
          dns: this.dnsServerIp,
          // Avoid touching routes on cold-boot VMs in prod; just update resolv.conf.
          dnsOnly: true
        });
      }

      await this.agentClient.applyAllowlist(vm.id, request.allowIps, vm.outboundInternet);
      await this.store.update(vm.id, { state: "RUNNING", provisionMode: mode });
      await this.activity?.logEvent({
        type: "vm.started",
        entityType: "vm",
        entityId: vm.id,
        message: `VM started (${mode})`,
        meta: { mode }
      });
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
      throw new HttpError(409, `VM must be RUNNING to snapshot (state=${vm.state})`);
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
      imageId: vm.imageId,
      sourceVmId: vm.id,
      hasDisk: true
    };
    await fs.writeFile(paths.metaPath, JSON.stringify(meta, null, 2), "utf-8");
    await this.activity?.logEvent({
      type: "snapshot.created",
      entityType: "snapshot",
      entityId: snapshotId,
      message: `Snapshot created from VM ${vm.id}`,
      meta: { vmId: vm.id, cpu: vm.cpu, memMb: vm.memMb }
    });
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
    if (vm.state !== "STOPPED") {
      throw new HttpError(409, `VM must be STOPPED to start (state=${vm.state})`);
    }
    await this.store.update(vm.id, { state: "STARTING" });

    try {
      // Re-prepare VM storage since the jailer directory was cleaned up when the VM was stopped.
      // Use the persistent disk (saved during stop) to preserve user data.
      const tStorageStart = Date.now();
      const image = await this.images.resolveForVmCreate(vm.imageId ?? undefined);
      const persistentDiskPath = this.storage.persistentDiskPath(vm.id);
      let storageResult: { rootfsPath: string; logsDir: string; kernelPath: string };

      if (await this.storage.hasPersistentDisk(vm.id)) {
        // Use the persistent disk which has user data from before stop.
        // No need to specify diskSizeBytes - the disk already has its size from creation.
        storageResult = await this.storage.prepareVmStorageFromDisk(vm.id, {
          kernelSrcPath: image.kernelSrcPath,
          diskSrcPath: persistentDiskPath
        });
      } else {
        // Fallback: no persistent disk, use base image (this shouldn't happen normally)
        // eslint-disable-next-line no-console
        console.warn("[vm-start] No persistent disk found, using base image (user data will be lost)", { vmId: vm.id });
        storageResult = await this.storage.prepareVmStorage(vm.id, {
          kernelSrcPath: image.kernelSrcPath,
          baseRootfsPath: image.baseRootfsPath
        });
      }
      const storageMs = Date.now() - tStorageStart;

      // Update VM record with new paths
      await this.store.update(vm.id, {
        rootfsPath: storageResult.rootfsPath,
        kernelPath: storageResult.kernelPath,
        logsDir: storageResult.logsDir
      });

      // Fetch updated VM record
      const updatedVm = await this.store.get(vm.id);
      if (!updatedVm) throw new HttpError(404, "VM not found after update");

      await this.network.configure(updatedVm, updatedVm.tapName);
      const tFirecrackerStart = Date.now();
      await this.firecracker.createAndStart(updatedVm, updatedVm.rootfsPath, updatedVm.kernelPath, updatedVm.tapName);
      const firecrackerMs = Date.now() - tFirecrackerStart;
      const tAgentHealthStart = Date.now();
      await this.agentClient.health(updatedVm.id);
      const agentHealthMs = Date.now() - tAgentHealthStart;
      await this.agentClient.syncTime(updatedVm.id, { unixTimeMs: Date.now() }).catch(() => undefined);
      await this.agentClient.applyAllowlist(updatedVm.id, updatedVm.allowIps, updatedVm.outboundInternet);
      await this.store.update(updatedVm.id, { state: "RUNNING", provisionMode: "boot" });
      await this.activity?.logEvent({
        type: "vm.started",
        entityType: "vm",
        entityId: updatedVm.id,
        message: "VM started",
        meta: { mode: "boot" }
      });
      // eslint-disable-next-line no-console
      console.info("[vm-start]", { vmId: updatedVm.id, storageMs, firecrackerMs, agentHealthMs });
    } catch (error) {
      await this.store.update(vm.id, { state: "ERROR" });
      throw error;
    }
  }

  async stop(id: string): Promise<void> {
    const vm = await this.requireVm(id);
    if (vm.state !== "RUNNING") {
      throw new HttpError(409, `VM must be RUNNING to stop (state=${vm.state})`);
    }
    await this.store.update(vm.id, { state: "STOPPING" });

    // Best-effort filesystem sync before stopping.
    // NOTE: the `sync` syscall may return before all writes reach the block device, so give the guest a moment.
    await this.agentClient.exec(vm.id, { cmd: "sync; sync; sync" }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // Stop the VM first so we don't clone the disk while it's being written to.
    await this.firecracker.stop(vm);

    // Now that the VM is stopped, clone the rootfs to persistent storage.
    const tSaveStart = Date.now();
    await this.storage.saveDiskToPersistent(vm.id, vm.rootfsPath);
    const saveMs = Date.now() - tSaveStart;

    // Clean up the jailer runtime dir so a later `start` can recreate it cleanly.
    await this.storage.cleanupJailerVmDir(vm.id).catch(() => undefined);
    // Tear down host networking so a later `start` can recreate the tap cleanly.
    await this.network.teardown(vm, vm.tapName).catch(() => undefined);
    await this.store.update(vm.id, { state: "STOPPED" });
    await this.activity?.logEvent({
      type: "vm.stopped",
      entityType: "vm",
      entityId: vm.id,
      message: "VM stopped"
    });
    // eslint-disable-next-line no-console
    console.info("[vm-stop]", { vmId: vm.id, saveMs });
  }

  async destroy(id: string): Promise<void> {
    const vm = await this.requireVm(id);
    const errors: string[] = [];
    await this.firecracker
      .destroy(vm)
      .catch((err) => errors.push(`firecracker.destroy: ${String((err as any)?.message ?? err)}`));
    await this.network
      .teardown(vm, vm.tapName)
      .catch((err) => errors.push(`network.teardown: ${String((err as any)?.message ?? err)}`));
    await this.storage
      .cleanupVmStorage(vm.id)
      .catch((err) => errors.push(`storage.cleanup: ${String((err as any)?.message ?? err)}`));
    await this.store.update(vm.id, { state: "DELETED" });
    await this.activity?.logEvent({
      type: "vm.deleted",
      entityType: "vm",
      entityId: vm.id,
      message: "VM deleted",
      meta: errors.length ? { warnings: errors } : undefined
    });
    if (errors.length) {
      // eslint-disable-next-line no-console
      console.warn("[vm-destroy] Completed with warnings", { vmId: vm.id, errors });
    }
  }

  async exec(id: string, payload: { cmd: string; cwd?: string; env?: Record<string, string>; timeoutMs?: number }) {
    const vm = await this.requireVm(id);
    if (typeof payload.timeoutMs === "number" && payload.timeoutMs > this.limits.maxExecTimeoutMs) {
      throw new HttpError(400, `timeoutMs exceeds maxExecTimeoutMs=${this.limits.maxExecTimeoutMs}`);
    }
    const startedAt = Date.now();
    const result = await this.agentClient.exec(vm.id, payload);
    const durationMs = Date.now() - startedAt;
    await this.execLogs
      .append(
        vm.logsDir,
        this.execLogs.buildEntry({
          type: "exec",
          input: {
            cmd: payload.cmd,
            timeoutMs: payload.timeoutMs,
            env: payload.env ? Object.entries(payload.env).map(([k, v]) => `${k}=${String(v ?? "")}`) : undefined
          },
          result,
          durationMs
        })
      )
      .catch(() => undefined);
    await this.activity?.logEvent({
      type: "exec.command",
      entityType: "vm",
      entityId: vm.id,
      message: `Exec command`,
      meta: { cmd: payload.cmd, cwd: payload.cwd, timeoutMs: payload.timeoutMs, exitCode: result.exitCode }
    });
    return result;
  }

  async runTs(
    id: string,
    payload: { path?: string; code?: string; args?: string[]; denoFlags?: string[]; timeoutMs?: number; env?: string[] }
  ) {
    const vm = await this.requireVm(id);
    if (typeof payload.timeoutMs === "number" && payload.timeoutMs > this.limits.maxRunTsTimeoutMs) {
      throw new HttpError(400, `timeoutMs exceeds maxRunTsTimeoutMs=${this.limits.maxRunTsTimeoutMs}`);
    }
    const startedAt = Date.now();
    const result = await this.agentClient.runTs(vm.id, { ...payload, allowNet: vm.outboundInternet });
    const durationMs = Date.now() - startedAt;
    await this.execLogs
      .append(
        vm.logsDir,
        this.execLogs.buildEntry({
          type: "run-ts",
          input: {
            path: payload.path,
            code: payload.code,
            args: payload.args,
            env: payload.env,
            denoFlags: payload.denoFlags,
            timeoutMs: payload.timeoutMs
          },
          result,
          durationMs
        })
      )
      .catch(() => undefined);
    await this.activity?.logEvent({
      type: "runTs.executed",
      entityType: "vm",
      entityId: vm.id,
      message: "Run TypeScript",
      meta: {
        path: payload.path,
        hasInlineCode: Boolean(payload.code),
        timeoutMs: payload.timeoutMs,
        exitCode: result.exitCode
      }
    });
    return result;
  }

  async runJs(
    id: string,
    payload: { path?: string; code?: string; args?: string[]; nodeFlags?: string[]; timeoutMs?: number; env?: string[] }
  ) {
    const vm = await this.requireVm(id);
    // Reuse maxRunTsTimeoutMs for run-js for now (same class of operation: long-running code execution).
    if (typeof payload.timeoutMs === "number" && payload.timeoutMs > this.limits.maxRunTsTimeoutMs) {
      throw new HttpError(400, `timeoutMs exceeds maxRunTsTimeoutMs=${this.limits.maxRunTsTimeoutMs}`);
    }
    const startedAt = Date.now();
    const result = await this.agentClient.runJs(vm.id, payload);
    const durationMs = Date.now() - startedAt;
    await this.execLogs
      .append(
        vm.logsDir,
        this.execLogs.buildEntry({
          type: "run-js",
          input: {
            path: payload.path,
            code: payload.code,
            args: payload.args,
            env: payload.env,
            nodeFlags: payload.nodeFlags,
            timeoutMs: payload.timeoutMs
          },
          result,
          durationMs
        })
      )
      .catch(() => undefined);
    await this.activity?.logEvent({
      type: "runJs.executed",
      entityType: "vm",
      entityId: vm.id,
      message: "Run JavaScript",
      meta: {
        path: payload.path,
        hasInlineCode: Boolean(payload.code),
        timeoutMs: payload.timeoutMs,
        exitCode: result.exitCode
      }
    });
    return result;
  }

  async getLogs(
    id: string,
    input: { type?: string; tail?: number } = {}
  ): Promise<{ type: string; lines: string[]; truncated: boolean; updatedAt?: string }> {
    const vm = await this.requireVm(id);
    const type = normalizeLogType(input.type);
    const tail = clampTail(input.tail);
    const logPath = path.join(vm.logsDir, type);
    let stat: { size: number; mtime: Date } | null = null;

    try {
      const raw = await fs.stat(logPath);
      stat = { size: raw.size, mtime: raw.mtime };
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        return { type, lines: [], truncated: false };
      }
      throw err;
    }

    if (!stat || stat.size === 0) {
      return { type, lines: [], truncated: false, updatedAt: stat?.mtime?.toISOString() };
    }

    const maxBytes = 256 * 1024;
    const readBytes = Math.min(stat.size, maxBytes);
    const start = Math.max(0, stat.size - readBytes);
    const handle = await fs.open(logPath, "r");
    let text = "";
    try {
      const buffer = Buffer.alloc(readBytes);
      await handle.read(buffer, 0, readBytes, start);
      text = buffer.toString("utf-8");
    } finally {
      await handle.close().catch(() => undefined);
    }

    let lines = text.split(/\r?\n/);
    if (start > 0 && lines.length > 0) {
      lines = lines.slice(1);
    }
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    let truncated = start > 0;
    if (lines.length > tail) {
      lines = lines.slice(-tail);
      truncated = true;
    }

    return { type, lines, truncated, updatedAt: stat.mtime.toISOString() };
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
    if (!vm || vm.state === "DELETED") {
      throw new HttpError(404, `VM ${id} not found`);
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
  if (typeof req.diskSizeMb === "number") {
    if (!Number.isFinite(req.diskSizeMb) || req.diskSizeMb <= 0) {
      throw new HttpError(400, "Invalid diskSizeMb");
    }
    if (req.diskSizeMb > 1024 * 1024) {
      throw new HttpError(400, "diskSizeMb too large");
    }
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
    provisionMode: vm.provisionMode,
    imageId: vm.imageId
  };
}

function generateMac(seed: string) {
  const hash = Buffer.from(seed.replace(/-/g, "")).slice(0, 6);
  hash[0] = (hash[0] & 0xfe) | 0x02;
  return Array.from(hash)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(":");
}

function normalizeLogType(type?: string): string {
  const value = type ? String(type).trim() : "";
  if (!value) return "firecracker.log";
  if (!LOG_FILES.has(value)) {
    throw new HttpError(400, "Invalid log type");
  }
  return value;
}

function clampTail(tail?: number): number {
  const parsed = typeof tail === "number" && Number.isFinite(tail) ? Math.floor(tail) : 200;
  if (parsed < 1) return 1;
  return Math.min(parsed, 1000);
}
