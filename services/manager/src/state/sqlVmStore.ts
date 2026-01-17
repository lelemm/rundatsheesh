import { eq } from "drizzle-orm";
import type { VmStore } from "../types/interfaces.js";
import type { VmRecord } from "../types/vm.js";

type AnyDb = any;
type AnyVmsTable = any;

function serializeAllowIps(allowIps: string[]) {
  return JSON.stringify(allowIps ?? []);
}

function deserializeAllowIps(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string");
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export class SqlVmStore implements VmStore {
  constructor(
    private readonly db: AnyDb,
    private readonly vms: AnyVmsTable
  ) {}

  async create(vm: VmRecord): Promise<void> {
    await this.db.insert(this.vms).values(toRow(vm));
  }

  async update(id: string, patch: Partial<VmRecord>): Promise<void> {
    const current = await this.get(id);
    if (!current) return;
    const merged = { ...current, ...patch } satisfies VmRecord;
    await this.db.update(this.vms).set(toRow(merged)).where(eq(this.vms.id, id));
  }

  async get(id: string): Promise<VmRecord | null> {
    const rows = await this.db.select().from(this.vms).where(eq(this.vms.id, id)).limit(1);
    const row = rows?.[0];
    return row ? fromRow(row) : null;
  }

  async list(): Promise<VmRecord[]> {
    const rows = await this.db.select().from(this.vms);
    return (rows ?? []).map(fromRow);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(this.vms).where(eq(this.vms.id, id));
  }
}

function toRow(vm: VmRecord) {
  return {
    id: vm.id,
    state: vm.state,
    cpu: vm.cpu,
    memMb: vm.memMb,
    guestIp: vm.guestIp,
    tapName: vm.tapName,
    vsockCid: vm.vsockCid,
    outboundInternet: vm.outboundInternet,
    allowIps: serializeAllowIps(vm.allowIps),
    rootfsPath: vm.rootfsPath,
    kernelPath: vm.kernelPath,
    logsDir: vm.logsDir,
    createdAt: vm.createdAt,
    provisionMode: vm.provisionMode ?? null
  };
}

function fromRow(row: any): VmRecord {
  return {
    id: String(row.id),
    state: row.state,
    cpu: Number(row.cpu),
    memMb: Number(row.memMb),
    guestIp: String(row.guestIp),
    tapName: String(row.tapName),
    vsockCid: Number(row.vsockCid),
    outboundInternet: Boolean(row.outboundInternet),
    allowIps: deserializeAllowIps(row.allowIps),
    rootfsPath: String(row.rootfsPath),
    kernelPath: String(row.kernelPath),
    logsDir: String(row.logsDir),
    createdAt: String(row.createdAt),
    provisionMode: row.provisionMode ?? undefined
  };
}

