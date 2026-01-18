import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

type AnyDb = any;
type AnyTable = any;

export type WebhookRecordPublic = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  eventTypes: string[];
  createdAt: string;
};

function safeJsonParseArrayOfStrings(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

export class WebhookService {
  constructor(
    private readonly db: AnyDb,
    private readonly webhooks: AnyTable
  ) {}

  async list(): Promise<WebhookRecordPublic[]> {
    const rows = await this.db.select().from(this.webhooks);
    return (rows ?? []).map((r: any) => ({
      id: String(r.id),
      name: String(r.name),
      url: String(r.url),
      enabled: Boolean(r.enabled),
      eventTypes: safeJsonParseArrayOfStrings(String(r.eventTypesJson ?? "[]")),
      createdAt: String(r.createdAt)
    }));
  }

  async listEnabled(): Promise<WebhookRecordPublic[]> {
    const rows = await this.db.select().from(this.webhooks).where(eq(this.webhooks.enabled, true));
    return (rows ?? []).map((r: any) => ({
      id: String(r.id),
      name: String(r.name),
      url: String(r.url),
      enabled: Boolean(r.enabled),
      eventTypes: safeJsonParseArrayOfStrings(String(r.eventTypesJson ?? "[]")),
      createdAt: String(r.createdAt)
    }));
  }

  async create(input: { name: string; url: string; enabled: boolean; eventTypes: string[] }): Promise<WebhookRecordPublic> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const eventTypes = (input.eventTypes ?? []).filter((x) => typeof x === "string" && x.length > 0);
    const eventTypesJson = JSON.stringify(eventTypes);

    await this.db.insert(this.webhooks).values({
      id,
      name: input.name,
      url: input.url,
      enabled: input.enabled,
      eventTypesJson,
      createdAt
    });

    return { id, name: input.name, url: input.url, enabled: input.enabled, eventTypes, createdAt };
  }

  async update(
    id: string,
    patch: Partial<{ name: string; url: string; enabled: boolean; eventTypes: string[] }>
  ): Promise<WebhookRecordPublic | null> {
    const update: any = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.url !== undefined) update.url = patch.url;
    if (patch.enabled !== undefined) update.enabled = patch.enabled;
    if (patch.eventTypes !== undefined) update.eventTypesJson = JSON.stringify(patch.eventTypes.filter((x) => typeof x === "string" && x.length > 0));

    await this.db.update(this.webhooks).set(update).where(eq(this.webhooks.id, id));
    const rows = await this.db.select().from(this.webhooks).where(eq(this.webhooks.id, id)).limit(1);
    const r = rows?.[0];
    if (!r) return null;
    return {
      id: String(r.id),
      name: String(r.name),
      url: String(r.url),
      enabled: Boolean(r.enabled),
      eventTypes: safeJsonParseArrayOfStrings(String(r.eventTypesJson ?? "[]")),
      createdAt: String(r.createdAt)
    };
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db.select().from(this.webhooks).where(eq(this.webhooks.id, id)).limit(1);
    if (!rows?.[0]) return false;
    await this.db.delete(this.webhooks).where(eq(this.webhooks.id, id));
    return true;
  }
}

