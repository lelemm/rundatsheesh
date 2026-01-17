import type { VmRecord } from "../types/vm.js";
import type { VmStore } from "../types/interfaces.js";

export class InMemoryVmStore implements VmStore {
  private readonly items = new Map<string, VmRecord>();

  async create(vm: VmRecord): Promise<void> {
    this.items.set(vm.id, vm);
  }

  async update(id: string, patch: Partial<VmRecord>): Promise<void> {
    const current = this.items.get(id);
    if (!current) {
      return;
    }
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
