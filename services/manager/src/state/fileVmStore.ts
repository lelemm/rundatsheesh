import fs from "node:fs/promises";
import path from "node:path";
import type { VmStore } from "../types/interfaces.js";
import type { VmRecord, VmState } from "../types/vm.js";

export interface FileVmStoreOptions {
  storageRoot: string;
}

/**
 * Persists VM metadata under STORAGE_ROOT so that `GET /v1/vms` is stable across
 * manager restarts / container recreation.
 *
 * Layout:
 * - ${STORAGE_ROOT}/${vmId}/vm.json
 *
 * Note: VM runtime processes (firecracker) do NOT survive container recreation,
 * so we normalize transient states to STOPPED when loading persisted records.
 */
export class FileVmStore implements VmStore {
  constructor(private readonly options: FileVmStoreOptions) {}

  async create(vm: VmRecord): Promise<void> {
    await fs.mkdir(this.vmDir(vm.id), { recursive: true });
    await this.writeVm(vm);
  }

  async update(id: string, patch: Partial<VmRecord>): Promise<void> {
    const current = await this.get(id);
    if (!current) return;
    await this.writeVm({ ...current, ...patch });
  }

  async get(id: string): Promise<VmRecord | null> {
    const p = this.vmMetaPath(id);
    try {
      const text = await fs.readFile(p, "utf-8");
      return JSON.parse(text) as VmRecord;
    } catch {
      return null;
    }
  }

  async list(): Promise<VmRecord[]> {
    const root = this.options.storageRoot;
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const vms: VmRecord[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === "snapshots") continue;
      const vm = await this.get(e.name);
      if (vm) vms.push(vm);
    }
    return vms;
  }

  async delete(id: string): Promise<void> {
    await fs.rm(this.vmMetaPath(id), { force: true }).catch(() => undefined);
  }

  private vmDir(id: string) {
    return path.join(this.options.storageRoot, id);
  }

  private vmMetaPath(id: string) {
    return path.join(this.vmDir(id), "vm.json");
  }

  private async writeVm(vm: VmRecord) {
    const p = this.vmMetaPath(vm.id);
    await fs.writeFile(p, JSON.stringify(vm, null, 2), "utf-8");
  }
}

