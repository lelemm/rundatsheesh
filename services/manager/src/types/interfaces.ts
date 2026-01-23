import type { VmCreateRequest, VmExecRequest, VmRecord, VmRunJsRequest, VmRunTsRequest } from "./vm.js";

export interface VmStore {
  create(vm: VmRecord): Promise<void>;
  update(id: string, patch: Partial<VmRecord>): Promise<void>;
  get(id: string): Promise<VmRecord | null>;
  list(): Promise<VmRecord[]>;
  delete(id: string): Promise<void>;
}

export interface FirecrackerManager {
  createAndStart(vm: VmRecord, rootfsPath: string, kernelPath: string, tapName: string): Promise<void>;
  restoreFromSnapshot(
    vm: VmRecord,
    rootfsPath: string,
    kernelPath: string,
    tapName: string,
    snapshot: { memPath: string; statePath: string }
  ): Promise<void>;
  createSnapshot(vm: VmRecord, snapshot: { memPath: string; statePath: string }): Promise<void>;
  stop(vm: VmRecord): Promise<void>;
  destroy(vm: VmRecord): Promise<void>;
}

export interface NetworkManager {
  allocateIp(): Promise<{ guestIp: string; tapName: string }>; 
  configure(vm: VmRecord, tapName: string, options?: { up?: boolean }): Promise<void>;
  bringUpTap(tapName: string): Promise<void>;
  teardown(vm: VmRecord, tapName: string): Promise<void>;
}

export interface AgentClient {
  health(vmId: string): Promise<void>;
  applyAllowlist(vmId: string, allowIps: string[], outboundInternet: boolean): Promise<void>;
  configureNetwork(
    vmId: string,
    payload: { ip: string; gateway: string; cidr?: number; mac?: string; iface?: string; dns?: string; dnsOnly?: boolean }
  ): Promise<void>;
  syncTime(vmId: string, payload: { unixTimeMs: number }): Promise<void>;
  exec(vmId: string, payload: VmExecRequest): Promise<{ exitCode: number; stdout: string; stderr: string; result?: unknown; error?: unknown }>;
  runTs(vmId: string, payload: VmRunTsRequest): Promise<{ exitCode: number; stdout: string; stderr: string; result?: unknown; error?: unknown }>;
  runJs(vmId: string, payload: VmRunJsRequest): Promise<{ exitCode: number; stdout: string; stderr: string; result?: unknown; error?: unknown }>;
  upload(vmId: string, dest: string, data: Buffer): Promise<void>;
  download(vmId: string, path: string): Promise<Buffer>;
}

export interface StorageProvider {
  prepareVmStorage(
    vmId: string,
    input: { kernelSrcPath: string; baseRootfsPath: string; diskSizeBytes?: number }
  ): Promise<{ rootfsPath: string; logsDir: string; kernelPath: string }>;
  prepareVmStorageFromDisk(
    vmId: string,
    input: { kernelSrcPath: string; diskSrcPath: string; diskSizeBytes?: number }
  ): Promise<{ rootfsPath: string; logsDir: string; kernelPath: string }>;
  cleanupVmStorage(vmId: string): Promise<void>;
  /** Remove the jailer runtime directory for a VM (but keep persistent storage under STORAGE_ROOT). */
  cleanupJailerVmDir(vmId: string): Promise<void>;
  getSnapshotArtifactPaths(
    snapshotId: string
  ): Promise<{ dir: string; memPath: string; statePath: string; diskPath: string; metaPath: string }>;
  cloneDisk(src: string, dest: string): Promise<void>;
  listSnapshots(): Promise<string[]>;
  readSnapshotMeta(snapshotId: string): Promise<import("./snapshot.js").SnapshotMeta | null>;
  /** Get the persistent disk path for a VM that survives jailer cleanup. */
  persistentDiskPath(vmId: string): string;
  /** Save the VM's rootfs to persistent storage (called before stop). */
  saveDiskToPersistent(vmId: string, currentRootfsPath: string): Promise<void>;
  /** Check if a persistent disk exists for a VM. */
  hasPersistentDisk(vmId: string): Promise<boolean>;
}

export interface Reconciler {
  run(): Promise<void>;
}
