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
import type { PeerService } from "./peer/peerService.js";

const LOG_FILES = new Set(["firecracker.log", "firecracker.stdout.log", "firecracker.stderr.log"]);

export interface VmServiceOptions {
  store: VmStore;
  firecracker: FirecrackerManager;
  network: NetworkManager;
  agentClient: AgentClient;
  storage: StorageProvider;
  images: ImageService;
  peerService?: PeerService;
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
  warmPool?: {
    enabled: boolean;
    target: number;
    maxVms: number;
  };
}

export class VmService {
  private readonly store: VmStore;
  private readonly firecracker: FirecrackerManager;
  private readonly network: NetworkManager;
  private readonly agentClient: AgentClient;
  private readonly storage: StorageProvider;
  private readonly images: ImageService;
  readonly peerService?: PeerService;
  private readonly activity?: ActivityService;
  private readonly snapshots?: { enabled: boolean; version: string; templateCpu: number; templateMemMb: number };
  private readonly limits: NonNullable<VmServiceOptions["limits"]>;
  private readonly dnsServerIp?: string;
  private readonly warmPool?: { enabled: boolean; target: number; maxVms: number };
  private nextVsockCid: number;
  private readonly execLogs: ExecLogService;
  private readonly seedBuilds = new Map<string, Promise<string | null>>();
  private readonly warmPoolVmIds = new Set<string>();
  private warmTopupRunning = false;

  constructor(options: VmServiceOptions) {
    this.store = options.store;
    this.firecracker = options.firecracker;
    this.network = options.network;
    this.agentClient = options.agentClient;
    this.storage = options.storage;
    this.images = options.images;
    this.peerService = options.peerService;
    this.activity = options.activity;
    this.snapshots = options.snapshots;
    this.dnsServerIp = options.dnsServerIp;
    this.warmPool = options.warmPool;
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
    if (this.warmPool?.enabled) {
      this.scheduleWarmPoolTopup();
    }
  }

  async list(): Promise<VmPublic[]> {
    const items = await this.store.list();
    // Deleted VMs are tombstoned (for auditing/logging) but should not appear in normal listings.
    const visible = items.filter((vm) => vm.state !== "DELETED" && vm.poolTag !== "warm").map((vm) => toPublic(vm));
    if (!this.peerService) return visible;
    return Promise.all(visible.map((vm) => this.peerService!.decorateVmPublic(vm)));
  }

  async get(id: string): Promise<VmPublic | null> {
    const vm = await this.store.get(id);
    if (!vm) return null;
    if (vm.state === "DELETED") return null;
    if (vm.poolTag === "warm") return null;
    const pub = toPublic(vm);
    return this.peerService ? this.peerService.decorateVmPublic(pub) : pub;
  }

  async create(request: VmCreateRequest, internal?: { skipWarmCheckout?: boolean; poolTag?: "warm" }): Promise<VmPublic> {
    validateCreateRequest(request, this.limits);
    await this.peerService?.validateCreateRequest(request);
    const active = (await this.store.list()).filter((vm) => vm.state !== "DELETED" && vm.poolTag !== "warm");
    if (active.length >= this.limits.maxVms) {
      throw new HttpError(429, `VM quota exceeded (maxVms=${this.limits.maxVms})`);
    }

    const requestedOverlaySnapshotId = normalizeSnapshotId(request.userOverlaySnapshotId ?? request.snapshotId);
    if (requestedOverlaySnapshotId && !request.userOverlaySnapshotId) {
      const legacy = await this.storage.readSnapshotMeta(requestedOverlaySnapshotId);
      // Backward compatibility: old "vm"/"template" snapshots via snapshotId keep legacy semantics.
      if (legacy && (legacy.kind === "vm" || legacy.kind === "template") && legacy.hasDisk && !legacy.baseSeedSnapshotId) {
        return this.createWithLegacySnapshotRestore(request, requestedOverlaySnapshotId);
      }
    }

    // Optional warm pool checkout path (only for plain creates without user overlay snapshot).
    if (this.warmPool?.enabled && !requestedOverlaySnapshotId && !internal?.skipWarmCheckout && !(request.peerLinks?.length) && !(request.secretEnv?.length)) {
      const fromPool = await this.tryCheckoutWarmVm(request);
      if (fromPool) return fromPool;
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
    let snapshotStageMs = 0;
    let baseSeedSnapshotId: string | undefined;

    const resolved = await this.images.resolveForVmCreate(request.imageId);
    const imageId = resolved.imageId;
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
    const rootfsPath = prepared.rootfsPath;
    const logsDir = prepared.logsDir;
    const kernelPath = prepared.kernelPath;
    const overlayPath = prepared.overlayPath;

    const imageRow = imageId ? await this.images.getById(imageId) : null;
    if (imageRow?.seedStatus === "ready" && imageRow.seedSnapshotId) {
      baseSeedSnapshotId = imageRow.seedSnapshotId;
    } else if (imageId) {
      void this.ensureImageSeedSnapshot(imageId);
    }

    if (requestedOverlaySnapshotId) {
      if (!overlayPath) {
        throw new HttpError(500, "OverlayFS storage is required for user overlay snapshots");
      }
      const tSnapshotStageStart = Date.now();
      const meta = await this.storage.readSnapshotMeta(requestedOverlaySnapshotId);
      if (!meta) {
        throw new HttpError(404, "User overlay snapshot not found");
      }
      if (meta.kind === "image_seed" || meta.kind === "template") {
        throw new HttpError(400, "Snapshot kind cannot be used as a user overlay baseline");
      }
      if (meta.imageId && imageId && meta.imageId !== imageId) {
        throw new HttpError(400, `Snapshot image mismatch: snapshot=${meta.imageId} vm=${imageId}`);
      }

      const src = await this.resolveOverlayBaselinePath(requestedOverlaySnapshotId, meta);
      await this.storage.cloneDisk(src, overlayPath);
      baseSeedSnapshotId = meta.baseSeedSnapshotId ?? baseSeedSnapshotId;
      snapshotStageMs = Date.now() - tSnapshotStageStart;
    }
    const storageMs = Date.now() - tStorageStart;
    const peerPatch = (await this.peerService?.buildCreatePatch(request, id)) ?? {};

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
      overlayPath,
      kernelPath,
      logsDir,
      createdAt,
      baseSeedSnapshotId,
      poolTag: internal?.poolTag,
      ...peerPatch
    };

    await this.store.create(vm);
    await this.peerService?.persistPeerLinks(vm.id, request.peerLinks);
    await this.activity?.logEvent({
      type: "vm.created",
      entityType: "vm",
      entityId: vm.id,
      message: `VM created (${vm.cpu} vCPU, ${vm.memMb} MiB)`,
      meta: { cpu: vm.cpu, memMb: vm.memMb, outboundInternet: vm.outboundInternet }
    });

    try {
      let mode: VmProvisionMode = "boot";
      let firecrackerMs = 0;
      let snapshotLoadMs = 0;
      let networkMs = 0;
      const allowManagerGateway = hasPeerLinksInRequest(request);

      let snapshotIdForBoot: string | undefined;
      const canUseLegacyTemplateSnapshot =
        Boolean(this.snapshots?.enabled) && request.cpu === this.snapshots!.templateCpu && request.memMb === this.snapshots!.templateMemMb;
      if (canUseLegacyTemplateSnapshot) {
        snapshotIdForBoot = this.snapshots!.version;
      }

      if (snapshotIdForBoot) {
        const snapshotPaths = await this.storage.getSnapshotArtifactPaths(snapshotIdForBoot);
        const snapshotExists = await Promise.all([fs.stat(snapshotPaths.memPath), fs.stat(snapshotPaths.statePath)])
          .then(() => true)
          .catch(() => false);
        if (snapshotExists) {
          mode = "snapshot";
          const tNetworkStart = Date.now();
          await this.network.configure(vm, tapName, { up: false, allowManagerGateway });
          networkMs += Date.now() - tNetworkStart;
          try {
            const tRestoreStart = Date.now();
            await this.firecracker.restoreFromSnapshot(
              vm,
              rootfsPath,
              vm.kernelPath,
              tapName,
              {
                memPath: snapshotPaths.memPath,
                statePath: snapshotPaths.statePath
              },
              vm.overlayPath
            );
            snapshotLoadMs = Date.now() - tRestoreStart;
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn("[vm-provision] snapshot restore failed; falling back to cold boot", { vmId: vm.id, err: String(err) });
            mode = "boot";
            await this.firecracker.destroy(vm).catch(() => undefined);
            const tBringTapStart = Date.now();
            await this.network.bringUpTap(tapName).catch(() => undefined);
            networkMs += Date.now() - tBringTapStart;
          }
        }
      }

      if (mode === "boot") {
        const tNetworkStart = Date.now();
        await this.network.configure(vm, tapName, { allowManagerGateway });
        networkMs += Date.now() - tNetworkStart;
        const tFirecrackerStart = Date.now();
        await this.firecracker.createAndStart(vm, rootfsPath, vm.kernelPath, tapName, vm.overlayPath);
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
        const tBringTapStart = Date.now();
        await this.network.bringUpTap(tapName);
        networkMs += Date.now() - tBringTapStart;
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

      await this.agentClient.applyAllowlist(vm.id, request.allowIps, vm.outboundInternet, { allowManagerGateway });
      await this.store.update(vm.id, { state: "RUNNING", provisionMode: mode });
      await this.peerService?.onVmRunning(vm.id);
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
        networkMs,
        snapshotStageMs,
        firecrackerMs,
        snapshotLoadMs,
        agentHealthMs,
        totalMs
      });
      if (!internal?.poolTag) {
        this.scheduleWarmPoolTopup();
      }
    } catch (error) {
      await this.store.update(vm.id, { state: "ERROR" });
      throw error;
    }

    const latest = await this.store.get(vm.id);
    if (internal?.poolTag === "warm") {
      this.warmPoolVmIds.add(vm.id);
    }
    const pub = toPublic(latest ?? vm);
    return this.peerService ? this.peerService.decorateVmPublic(pub) : pub;
  }

  private async createWithLegacySnapshotRestore(request: VmCreateRequest, snapshotId: string): Promise<VmPublic> {
    const mbToBytes = (mb: number) => Math.floor(mb * 1024 * 1024);
    const minDiskMb = (bytes: number) => Math.ceil(bytes / (1024 * 1024));
    const DEFAULT_DISK_MB = 512;
    const DEFAULT_DISK_HEADROOM_MB = 256;

    const tTotalStart = Date.now();
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const { guestIp, tapName } = await this.network.allocateIp();

    const tStorageStart = Date.now();
    const snap = await this.storage.getSnapshotArtifactPaths(snapshotId);
    const meta = await this.storage.readSnapshotMeta(snapshotId);
    if (!meta || !meta.hasDisk) {
      throw new HttpError(404, "Snapshot not found or missing disk baseline");
    }
    if (meta.cpu !== request.cpu || meta.memMb !== request.memMb) {
      throw new HttpError(400, `Snapshot cpu/mem mismatch: snapshot=${meta.cpu}/${meta.memMb} requested=${request.cpu}/${request.memMb}`);
    }
    const hasAll = await Promise.all([fs.stat(snap.memPath), fs.stat(snap.statePath), fs.stat(snap.diskPath)])
      .then(() => true)
      .catch(() => false);
    if (!hasAll) {
      throw new HttpError(409, "Snapshot artifacts missing on disk");
    }
    const diskBytes = (await fs.stat(snap.diskPath)).size;
    const resolved = await this.images.resolveForVmCreate(meta.imageId ?? request.imageId);
    const imageId = resolved.imageId;
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
    const storageMs = Date.now() - tStorageStart;
    const peerPatch = (await this.peerService?.buildCreatePatch(request, id)) ?? {};

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
      rootfsPath: prepared.rootfsPath,
      overlayPath: prepared.overlayPath,
      kernelPath: prepared.kernelPath,
      logsDir: prepared.logsDir,
      createdAt,
      ...peerPatch
    };

    await this.store.create(vm);
    await this.peerService?.persistPeerLinks(vm.id, request.peerLinks);
    await this.activity?.logEvent({
      type: "vm.created",
      entityType: "vm",
      entityId: vm.id,
      message: `VM created (${vm.cpu} vCPU, ${vm.memMb} MiB)`,
      meta: { cpu: vm.cpu, memMb: vm.memMb, outboundInternet: vm.outboundInternet, legacySnapshot: true }
    });

    try {
      let mode: VmProvisionMode = "snapshot";
      let firecrackerMs = 0;
      let snapshotLoadMs = 0;
      let networkMs = 0;
      const allowManagerGateway = hasPeerLinksInRequest(request);
      const tNetworkStart = Date.now();
      await this.network.configure(vm, tapName, { allowManagerGateway });
      networkMs += Date.now() - tNetworkStart;

      const tRestoreStart = Date.now();
      await this.firecracker.restoreFromSnapshot(
        vm,
        vm.rootfsPath,
        vm.kernelPath,
        tapName,
        {
          memPath: snap.memPath,
          statePath: snap.statePath
        },
        vm.overlayPath
      );
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
      const tBringTapStart = Date.now();
      await this.network.bringUpTap(tapName);
      networkMs += Date.now() - tBringTapStart;

      await this.agentClient.applyAllowlist(vm.id, request.allowIps, vm.outboundInternet, { allowManagerGateway });
      await this.store.update(vm.id, { state: "RUNNING", provisionMode: mode });
      await this.peerService?.onVmRunning(vm.id);
      const totalMs = Date.now() - tTotalStart;
      // eslint-disable-next-line no-console
      console.info("[vm-provision]", {
        vmId: vm.id,
        mode,
        storageMs,
        networkMs,
        snapshotStageMs: 0,
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
    const pub = toPublic(latest ?? vm);
    return this.peerService ? this.peerService.decorateVmPublic(pub) : pub;
  }

  private async resolveOverlayBaselinePath(snapshotId: string, meta: SnapshotMeta): Promise<string> {
    const paths = await this.storage.getSnapshotArtifactPaths(snapshotId);
    const overlayExists = await fs.stat(paths.overlayPath).then(() => true).catch(() => false);
    if (overlayExists) return paths.overlayPath;
    if (meta.hasOverlay === false && meta.hasDisk) {
      // Legacy behavior for snapshots created before overlay-only user snapshot mode.
      const diskExists = await fs.stat(paths.diskPath).then(() => true).catch(() => false);
      if (diskExists) return paths.diskPath;
    }
    throw new HttpError(409, "Snapshot is missing overlay baseline disk");
  }

  async createSnapshot(id: string): Promise<SnapshotMeta> {
    const vm = await this.requireVm(id);
    if (vm.state !== "RUNNING") {
      throw new HttpError(409, `VM must be RUNNING to snapshot (state=${vm.state})`);
    }

    // Best-effort filesystem quiesce for /home/user content.
    await this.agentClient.exec(vm.id, { cmd: "sync" });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const snapshotId = `snap-${randomUUID()}`;
    if (!vm.overlayPath) {
      throw new HttpError(409, "OverlayFS snapshot requires a writable overlay disk");
    }
    await syncDiskFile(vm.overlayPath);
    const paths = await this.storage.getSnapshotArtifactPaths(snapshotId);

    // User snapshots are flattened overlay baselines only (no mem/state dependency).
    await this.storage.cloneDisk(vm.overlayPath, paths.overlayPath);
    await Promise.all([
      fs.rm(paths.memPath, { force: true }).catch(() => undefined),
      fs.rm(paths.statePath, { force: true }).catch(() => undefined),
      fs.rm(paths.diskPath, { force: true }).catch(() => undefined)
    ]);

    const meta: SnapshotMeta = {
      id: snapshotId,
      kind: "user_overlay",
      createdAt: new Date().toISOString(),
      cpu: vm.cpu,
      memMb: vm.memMb,
      imageId: vm.imageId,
      baseSeedSnapshotId: vm.baseSeedSnapshotId,
      sourceVmId: vm.id,
      hasDisk: false,
      hasOverlay: true
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

  async listSnapshots(scope: "user" | "internal" | "all" = "user"): Promise<SnapshotMeta[]> {
    const ids = await this.storage.listSnapshots();
    const items = await Promise.all(
      ids.map(async (sid) => {
        const meta = await this.storage.readSnapshotMeta(sid);
        return meta;
      })
    );
    const metas = items.filter(Boolean) as SnapshotMeta[];
    if (scope === "all") return metas;
    if (scope === "internal") {
      return metas.filter((m) => m.kind === "image_seed" || m.kind === "template" || m.internal === true);
    }
    // user scope
    return metas.filter((m) => m.kind === "user_overlay" || m.kind === "vm");
  }

  async ensureImageSeedSnapshot(imageId: string): Promise<string | null> {
    const current = await this.images.getById(imageId);
    if (!current || !current.kernelFilename || !current.rootfsFilename) {
      return null;
    }
    if (current.seedStatus === "ready" && current.seedSnapshotId) {
      const paths = await this.storage.getSnapshotArtifactPaths(current.seedSnapshotId);
      const ok = await Promise.all([fs.stat(paths.memPath), fs.stat(paths.statePath), fs.stat(paths.overlayPath)])
        .then(() => true)
        .catch(() => false);
      if (ok) return current.seedSnapshotId;
    }

    const existing = this.seedBuilds.get(imageId);
    if (existing) return existing;

    const build = this.buildImageSeedSnapshot(imageId)
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[seed-snapshot] failed", { imageId, err: String((err as any)?.message ?? err) });
        return null;
      })
      .finally(() => {
        this.seedBuilds.delete(imageId);
      });
    this.seedBuilds.set(imageId, build);
    return build;
  }

  private async buildImageSeedSnapshot(imageId: string): Promise<string | null> {
    const image = await this.images.getById(imageId);
    if (!image || !image.kernelFilename || !image.rootfsFilename) return null;

    await this.images.markSeedPending(imageId);
    const seedSnapshotId = `seed-${imageId}`;
    const seedCpu = this.snapshots?.templateCpu ?? 1;
    const seedMemMb = this.snapshots?.templateMemMb ?? 256;

    // Keep temp VM id short to stay under UNIX socket path limits in jailer temp roots.
    const tempVmId = randomUUID();
    const createdAt = new Date().toISOString();
    const { guestIp, tapName } = await this.network.allocateIp();
    const resolved = await this.images.resolveForVmCreate(imageId);
    const storage = await this.storage.prepareVmStorage(tempVmId, {
      kernelSrcPath: resolved.kernelSrcPath,
      baseRootfsPath: resolved.baseRootfsPath
    });
    if (!storage.overlayPath) {
      await this.images.markSeedFailed(imageId, "overlay disk not available for seed snapshot");
      return null;
    }

    const vm: VmRecord = {
      id: tempVmId,
      state: "CREATED",
      cpu: seedCpu,
      memMb: seedMemMb,
      guestIp,
      tapName,
      vsockCid: this.allocateVsockCid(),
      outboundInternet: false,
      allowIps: [],
      imageId,
      rootfsPath: storage.rootfsPath,
      overlayPath: storage.overlayPath,
      kernelPath: storage.kernelPath,
      logsDir: storage.logsDir,
      createdAt
    };

    const snapshotPaths = await this.storage.getSnapshotArtifactPaths(seedSnapshotId);
    try {
      await this.network.configure(vm, tapName, { up: false });
      await this.firecracker.createAndStart(vm, vm.rootfsPath, vm.kernelPath, tapName, vm.overlayPath);
      // Seed build VMs can take longer to expose the vsock endpoint; tolerate slower health readiness.
      await this.waitForAgentHealth(vm.id, 30_000);
      await this.firecracker.createSnapshot(vm, { memPath: snapshotPaths.memPath, statePath: snapshotPaths.statePath });
      await this.storage.cloneDisk(vm.overlayPath!, snapshotPaths.overlayPath);
      await fs.rm(snapshotPaths.diskPath, { force: true }).catch(() => undefined);
      const meta: SnapshotMeta = {
        id: seedSnapshotId,
        kind: "image_seed",
        createdAt: new Date().toISOString(),
        cpu: vm.cpu,
        memMb: vm.memMb,
        imageId,
        hasDisk: false,
        hasOverlay: true,
        internal: true
      };
      await fs.writeFile(snapshotPaths.metaPath, JSON.stringify(meta, null, 2), "utf-8");
      await this.images.markSeedReady(imageId, seedSnapshotId);
      await this.activity?.logEvent({
        type: "snapshot.seed_ready",
        entityType: "image",
        entityId: imageId,
        message: "Image seed snapshot ready",
        meta: { imageId, seedSnapshotId }
      });
      return seedSnapshotId;
    } catch (err: any) {
      await this.images.markSeedFailed(imageId, String(err?.message ?? err));
      return null;
    } finally {
      await this.firecracker.destroy(vm).catch(() => undefined);
      await this.network.teardown(vm, tapName).catch(() => undefined);
      await this.storage.cleanupVmStorage(tempVmId).catch(() => undefined);
    }
  }

  private async waitForAgentHealth(vmId: string, timeoutMs: number): Promise<void> {
    const started = Date.now();
    let lastErr: unknown;
    while (Date.now() - started < timeoutMs) {
      try {
        await this.agentClient.health(vmId);
        return;
      } catch (err) {
        lastErr = err;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Agent health timeout for ${vmId} after ${timeoutMs}ms: ${String((lastErr as any)?.message ?? lastErr ?? "")}`);
  }

  private async tryCheckoutWarmVm(request: VmCreateRequest): Promise<VmPublic | null> {
    if (!this.warmPool?.enabled || this.warmPoolVmIds.size === 0) return null;
    // Host-side egress rules are installed when tap is created; avoid unsafe in-place rewrites on running warm VMs.
    // Restrict checkout to the deny-all profile that warm VMs are preconfigured with.
    if ((request.outboundInternet ?? false) || (request.allowIps ?? []).length > 0) return null;
    const resolved = await this.images.resolveForVmCreate(request.imageId);
    for (const vmId of this.warmPoolVmIds) {
      const vm = await this.store.get(vmId);
      if (!vm || vm.state !== "RUNNING" || vm.poolTag !== "warm") {
        this.warmPoolVmIds.delete(vmId);
        continue;
      }
      if (vm.cpu !== request.cpu || vm.memMb !== request.memMb) continue;
      if ((vm.imageId ?? "") !== (resolved.imageId ?? "")) continue;

      this.warmPoolVmIds.delete(vmId);
      await this.store.update(vm.id, {
        allowIps: request.allowIps,
        outboundInternet: request.outboundInternet ?? false,
        poolTag: undefined
      });
      const latest = await this.store.get(vm.id);
      this.scheduleWarmPoolTopup();
      return latest ? toPublic(latest) : null;
    }
    return null;
  }

  private scheduleWarmPoolTopup(): void {
    if (!this.warmPool?.enabled || this.warmPool.target <= 0) return;
    if (this.warmTopupRunning) return;
    this.warmTopupRunning = true;
    setTimeout(() => {
      this.topupWarmPool()
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[warm-pool] topup failed", { err: String((err as any)?.message ?? err) });
        })
        .finally(() => {
          this.warmTopupRunning = false;
        });
    }, 0);
  }

  private async topupWarmPool(): Promise<void> {
    if (!this.warmPool?.enabled) return;
    const target = Math.min(Math.max(0, this.warmPool.target), this.warmPool.maxVms);
    if (target === 0) return;

    const currentWarm = (await this.store.list()).filter((vm) => vm.poolTag === "warm" && vm.state !== "DELETED");
    for (const vm of currentWarm) {
      this.warmPoolVmIds.add(vm.id);
    }
    if (currentWarm.length >= target) return;

    const deficit = Math.min(target - currentWarm.length, this.warmPool.maxVms);
    for (let i = 0; i < deficit; i += 1) {
      try {
        const image = await this.images.resolveForVmCreate(undefined);
        await this.create(
          {
            cpu: this.snapshots?.templateCpu ?? 1,
            memMb: this.snapshots?.templateMemMb ?? 256,
            allowIps: [],
            outboundInternet: false,
            imageId: image.imageId
          },
          { skipWarmCheckout: true, poolTag: "warm" }
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[warm-pool] failed to create warm VM", { err: String((err as any)?.message ?? err) });
        return;
      }
    }
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
      const hadOverlay = Boolean(vm.overlayPath);
      let storageResult: { rootfsPath: string; logsDir: string; kernelPath: string; overlayPath?: string | null };

      if (await this.storage.hasPersistentDisk(vm.id)) {
        if (hadOverlay) {
          // Overlay mode: persistent disk contains the writable overlay layer.
          // Recreate a fresh VM storage layout (base rootfs + overlay disk), then
          // restore the persisted overlay contents onto the new overlay disk.
          storageResult = await this.storage.prepareVmStorage(vm.id, {
            kernelSrcPath: image.kernelSrcPath,
            baseRootfsPath: image.baseRootfsPath
          });
          if (!storageResult.overlayPath) {
            throw new HttpError(500, "overlay disk was expected for VM restart but is unavailable");
          }
          await this.storage.cloneDisk(persistentDiskPath, storageResult.overlayPath);
        } else {
          // Legacy mode (no overlay): persistent disk is the full rootfs.
          storageResult = await this.storage.prepareVmStorageFromDisk(vm.id, {
            kernelSrcPath: image.kernelSrcPath,
            diskSrcPath: persistentDiskPath
          });
        }
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
        logsDir: storageResult.logsDir,
        overlayPath: storageResult.overlayPath
      });

      // Fetch updated VM record
      const updatedVm = await this.store.get(vm.id);
      if (!updatedVm) throw new HttpError(404, "VM not found after update");

      const allowManagerGateway = (await this.peerService?.hasPeerLinks(updatedVm.id)) === true;
      await this.network.configure(updatedVm, updatedVm.tapName, { allowManagerGateway });
      const tFirecrackerStart = Date.now();
      await this.firecracker.createAndStart(updatedVm, updatedVm.rootfsPath, updatedVm.kernelPath, updatedVm.tapName, updatedVm.overlayPath);
      const firecrackerMs = Date.now() - tFirecrackerStart;
      const tAgentHealthStart = Date.now();
      await this.agentClient.health(updatedVm.id);
      const agentHealthMs = Date.now() - tAgentHealthStart;
      await this.agentClient.syncTime(updatedVm.id, { unixTimeMs: Date.now() }).catch(() => undefined);
      await this.agentClient.applyAllowlist(updatedVm.id, updatedVm.allowIps, updatedVm.outboundInternet, { allowManagerGateway });
      await this.store.update(updatedVm.id, { state: "RUNNING", provisionMode: "boot" });
      await this.peerService?.onVmRunning(updatedVm.id);
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
    if (vm.poolTag === "warm") {
      this.warmPoolVmIds.delete(vm.id);
    }
    if (vm.state !== "RUNNING") {
      throw new HttpError(409, `VM must be RUNNING to stop (state=${vm.state})`);
    }
    await this.store.update(vm.id, { state: "STOPPING" });
    await this.peerService?.clearBridgeToken(vm.id);

    // Best-effort filesystem sync before stopping.
    // NOTE: the `sync` syscall may return before all writes reach the block device, so give the guest a moment.
    await this.agentClient.exec(vm.id, { cmd: "sync; sync; sync" }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // Stop the VM first so we don't clone the disk while it's being written to.
    await this.firecracker.stop(vm);
    // Give host block flush a brief moment after VM exit before cloning the writable layer.
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // Now that the VM is stopped, clone the writable disk to persistent storage.
    // In overlay mode that's the overlay disk; in legacy mode it's the rootfs disk.
    const tSaveStart = Date.now();
    const writableDiskPath = vm.overlayPath || vm.rootfsPath;
    await syncDiskFile(writableDiskPath);
    await this.storage.saveDiskToPersistent(vm.id, writableDiskPath);
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
    this.warmPoolVmIds.delete(vm.id);
    await this.peerService?.deleteConsumerMetadata(vm.id);
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
    this.scheduleWarmPoolTopup();
  }

  async exec(id: string, payload: { cmd: string; cwd?: string; env?: Record<string, string>; timeoutMs?: number }) {
    const vm = await this.requireVm(id);
    if (typeof payload.timeoutMs === "number" && payload.timeoutMs > this.limits.maxExecTimeoutMs) {
      throw new HttpError(400, `timeoutMs exceeds maxExecTimeoutMs=${this.limits.maxExecTimeoutMs}`);
    }
    const startedAt = Date.now();
    const result = await this.agentClient.exec(vm.id, {
      ...payload,
      env: await this.peerService?.mergeExecEnv(vm, payload.env)
    });
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
    const result = await this.agentClient.runTs(vm.id, {
      ...payload,
      env: await this.peerService?.mergeEnvList(vm, payload.env),
      allowNet: vm.outboundInternet || (await this.peerService?.hasPeerLinks(vm.id)) === true
    });
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
    const result = await this.agentClient.runJs(vm.id, {
      ...payload,
      env: await this.peerService?.mergeEnvList(vm, payload.env)
    });
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

  async syncPeers(id: string): Promise<void> {
    await this.requireVm(id);
    if (!this.peerService) {
      throw new HttpError(501, "Peer service is not configured");
    }
    await this.peerService.syncPeerFilesystem(id);
  }

  async updatePeerSourceMode(id: string, alias: string, sourceMode: "hidden" | "mounted"): Promise<void> {
    await this.requireVm(id);
    if (!this.peerService) {
      throw new HttpError(501, "Peer service is not configured");
    }
    await this.peerService.updatePeerSourceMode(id, alias, sourceMode);
    await this.peerService.syncPeerFilesystem(id);
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

function hasPeerLinksInRequest(req: VmCreateRequest): boolean {
  return Array.isArray(req.peerLinks) && req.peerLinks.length > 0;
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

function normalizeSnapshotId(raw?: string): string | undefined {
  if (!raw) return undefined;
  const value = String(raw).trim();
  return value ? value : undefined;
}

async function syncDiskFile(filePath: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(filePath, "r");
    await handle.sync();
  } catch {
    // Best-effort durability hint only.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
