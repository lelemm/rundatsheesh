import { and, eq } from "drizzle-orm";
import type { VmPeerLinkStore } from "../types/interfaces.js";
import type { VmPeerLink, VmPeerSourceMode } from "../types/vm.js";

type AnyDb = any;
type AnyVmPeerLinksTable = any;

export class SqlVmPeerLinkStore implements VmPeerLinkStore {
  constructor(
    private readonly db: AnyDb,
    private readonly vmPeerLinks: AnyVmPeerLinksTable
  ) {}

  async replaceForConsumer(consumerVmId: string, links: VmPeerLink[]): Promise<void> {
    await this.deleteForConsumer(consumerVmId);
    if (links.length === 0) return;
    await this.db.insert(this.vmPeerLinks).values(
      links.map((link) => ({
        consumerVmId,
        providerVmId: link.vmId,
        alias: link.alias,
        sourceMode: link.sourceMode ?? "hidden"
      }))
    );
  }

  async listForConsumer(consumerVmId: string): Promise<VmPeerLink[]> {
    const rows = await this.db.select().from(this.vmPeerLinks).where(eq(this.vmPeerLinks.consumerVmId, consumerVmId));
    return (rows ?? []).map((row: any) => ({
      alias: String(row.alias),
      vmId: String(row.providerVmId),
      sourceMode: normalizeSourceMode(row.sourceMode)
    }));
  }

  async getForConsumerAlias(consumerVmId: string, alias: string): Promise<VmPeerLink | null> {
    const rows = await this.db
      .select()
      .from(this.vmPeerLinks)
      .where(and(eq(this.vmPeerLinks.consumerVmId, consumerVmId), eq(this.vmPeerLinks.alias, alias)))
      .limit(1);
    const row = rows?.[0];
    if (!row) return null;
    return {
      alias: String(row.alias),
      vmId: String(row.providerVmId),
      sourceMode: normalizeSourceMode(row.sourceMode)
    };
  }

  async updateSourceMode(consumerVmId: string, alias: string, sourceMode: VmPeerSourceMode): Promise<boolean> {
    const result = await this.db
      .update(this.vmPeerLinks)
      .set({ sourceMode })
      .where(and(eq(this.vmPeerLinks.consumerVmId, consumerVmId), eq(this.vmPeerLinks.alias, alias)));
    return countChangedRows(result) > 0;
  }

  async deleteForConsumer(consumerVmId: string): Promise<void> {
    await this.db.delete(this.vmPeerLinks).where(eq(this.vmPeerLinks.consumerVmId, consumerVmId));
  }
}

function normalizeSourceMode(value: unknown): VmPeerSourceMode {
  return value === "mounted" ? "mounted" : "hidden";
}

function countChangedRows(result: any): number {
  if (typeof result === "number") return result;
  if (typeof result?.rowCount === "number") return result.rowCount;
  if (typeof result?.changes === "number") return result.changes;
  return 0;
}
