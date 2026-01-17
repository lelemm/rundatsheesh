import type { StorageProvider, VmStore } from "../types/interfaces.js";
import { getCpuCapacityCores, getCpuUsagePct, getFsBytes, getMemoryBytes } from "./systemStats.js";

export interface DashboardOverview {
  counts: {
    activeVms: number;
    snapshots: number;
    templates: number;
  };
  cpu: {
    usagePct: number | null;
    capacityCores: number;
    usedCores: number;
  };
  memory: {
    usedBytes: number | null;
    capacityBytes: number | null;
  };
  storage: {
    usedBytes: number | null;
    capacityBytes: number | null;
  };
}

export class DashboardService {
  constructor(
    private readonly store: VmStore,
    private readonly storageProvider: StorageProvider,
    private readonly storageRoot: string
  ) {}

  async getOverview(): Promise<DashboardOverview> {
    const vms = await this.store.list();
    const active = vms.filter((vm) => vm.state !== "DELETED");
    const usedCores = active.reduce((sum, vm) => sum + (Number(vm.cpu) || 0), 0);

    const [cpuUsagePct, mem, fsInfo, snapshotCounts] = await Promise.all([
      getCpuUsagePct(500),
      getMemoryBytes(),
      getFsBytes(this.storageRoot),
      this.getSnapshotCounts()
    ]);

    const memUsed = mem ? Math.max(0, mem.total - mem.available) : null;
    const storageUsed = fsInfo ? Math.max(0, fsInfo.total - fsInfo.available) : null;

    return {
      counts: {
        activeVms: active.length,
        snapshots: snapshotCounts.snapshots,
        templates: snapshotCounts.templates
      },
      cpu: {
        usagePct: cpuUsagePct,
        capacityCores: getCpuCapacityCores(),
        usedCores
      },
      memory: {
        usedBytes: memUsed,
        capacityBytes: mem?.total ?? null
      },
      storage: {
        usedBytes: storageUsed,
        capacityBytes: fsInfo?.total ?? null
      }
    };
  }

  private async getSnapshotCounts(): Promise<{ snapshots: number; templates: number }> {
    const ids = await this.storageProvider.listSnapshots();
    const metas = await Promise.all(ids.map((id) => this.storageProvider.readSnapshotMeta(id)));
    let snapshots = 0;
    let templates = 0;
    for (const m of metas) {
      if (!m) continue;
      if (m.kind === "template") templates += 1;
      else snapshots += 1;
    }
    return { snapshots, templates };
  }
}

