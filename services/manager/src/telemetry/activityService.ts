import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";

type AnyDb = any;
type AnyTable = any;

export interface ActivityEvent {
  id: string;
  createdAt: string;
  type: string;
  entityType?: string;
  entityId?: string;
  message: string;
  metaJson?: string;
}

export class ActivityService {
  private readonly subscribers = new Set<(ev: ActivityEvent) => void>();

  constructor(
    private readonly db: AnyDb,
    private readonly activityEvents: AnyTable
  ) {}

  subscribe(handler: (ev: ActivityEvent) => void): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  async logEvent(input: {
    type: string;
    entityType?: string;
    entityId?: string;
    message: string;
    meta?: unknown;
    createdAt?: string;
  }): Promise<ActivityEvent> {
    const ev: ActivityEvent = {
      id: randomUUID(),
      createdAt: input.createdAt ?? new Date().toISOString(),
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      message: input.message,
      metaJson: input.meta === undefined ? undefined : JSON.stringify(input.meta)
    };

    await this.db.insert(this.activityEvents).values({
      id: ev.id,
      createdAt: ev.createdAt,
      type: ev.type,
      entityType: ev.entityType ?? null,
      entityId: ev.entityId ?? null,
      message: ev.message,
      metaJson: ev.metaJson ?? null
    });

    for (const sub of this.subscribers) {
      try {
        sub(ev);
      } catch {
        // best-effort; never break logEvent() due to a subscriber
      }
    }

    return ev;
  }

  async listEvents(input: { limit: number }): Promise<ActivityEvent[]> {
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(200, Math.floor(input.limit))) : 50;
    const rows = await this.db.select().from(this.activityEvents).orderBy(desc(this.activityEvents.createdAt)).limit(limit);
    return (rows ?? []).map((row: any) => ({
      id: String(row.id),
      createdAt: String(row.createdAt),
      type: String(row.type),
      entityType: row.entityType ?? undefined,
      entityId: row.entityId ?? undefined,
      message: String(row.message),
      metaJson: row.metaJson ?? undefined
    }));
  }

  async getEvent(id: string): Promise<ActivityEvent | null> {
    const rows = await this.db.select().from(this.activityEvents).where(eq(this.activityEvents.id, id)).limit(1);
    const row = rows?.[0];
    if (!row) return null;
    return {
      id: String(row.id),
      createdAt: String(row.createdAt),
      type: String(row.type),
      entityType: row.entityType ?? undefined,
      entityId: row.entityId ?? undefined,
      message: String(row.message),
      metaJson: row.metaJson ?? undefined
    };
  }
}

