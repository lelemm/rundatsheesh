import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

type AnyDb = any;
type AnyTable = any;

export interface ApiKeyRecordPublic {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
  lastUsedAt?: string | null;
}

function base64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function hashSecret(secret: string, salt: Buffer) {
  const dk = scryptSync(secret, salt, 32);
  return `scrypt$${salt.toString("base64")}$${dk.toString("base64")}`;
}

function verifySecret(secret: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [alg, saltB64, dkB64] = parts;
  if (alg !== "scrypt") return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(dkB64, "base64");
  const actual = scryptSync(secret, salt, expected.length);
  return timingSafeEqual(expected, actual);
}

function parseApiKey(raw: string): { prefix: string; secret: string } | null {
  // rds_<prefix>_<secret>
  if (!raw.startsWith("rds_")) return null;
  const rest = raw.slice(4);
  const idx = rest.indexOf("_");
  if (idx <= 0) return null;
  const prefix = rest.slice(0, idx);
  const secret = rest.slice(idx + 1);
  if (!prefix || !secret) return null;
  if (prefix.length > 64 || secret.length > 256) return null;
  return { prefix, secret };
}

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return false;
  return t <= Date.now();
}

export class ApiKeyService {
  constructor(
    private readonly db: AnyDb,
    private readonly apiKeys: AnyTable
  ) {}

  async create(input: { name: string; expiresAt?: string | null }): Promise<{ apiKey: string; record: ApiKeyRecordPublic }> {
    const prefix = randomBytes(6).toString("hex"); // 12 chars
    const secret = base64url(randomBytes(24));
    const apiKey = `rds_${prefix}_${secret}`;

    const salt = randomBytes(16);
    const hash = hashSecret(secret, salt);
    const now = new Date().toISOString();

    const id = randomUUID();
    await this.db.insert(this.apiKeys).values({
      id,
      name: input.name,
      prefix,
      hash,
      createdAt: now,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      lastUsedAt: null
    });

    return {
      apiKey,
      record: {
        id,
        name: input.name,
        prefix,
        createdAt: now,
        expiresAt: input.expiresAt ?? null,
        revokedAt: null,
        lastUsedAt: null
      }
    };
  }

  async list(): Promise<ApiKeyRecordPublic[]> {
    const rows = await this.db.select().from(this.apiKeys);
    return (rows ?? []).map((r: any) => ({
      id: String(r.id),
      name: String(r.name),
      prefix: String(r.prefix),
      createdAt: String(r.createdAt),
      expiresAt: r.expiresAt ?? null,
      revokedAt: r.revokedAt ?? null,
      lastUsedAt: r.lastUsedAt ?? null
    }));
  }

  async revoke(id: string): Promise<ApiKeyRecordPublic | null> {
    const now = new Date().toISOString();
    await this.db.update(this.apiKeys).set({ revokedAt: now }).where(eq(this.apiKeys.id, id));
    const rows = await this.db.select().from(this.apiKeys).where(eq(this.apiKeys.id, id)).limit(1);
    const r = rows?.[0];
    if (!r) return null;
    return {
      id: String(r.id),
      name: String(r.name),
      prefix: String(r.prefix),
      createdAt: String(r.createdAt),
      expiresAt: r.expiresAt ?? null,
      revokedAt: r.revokedAt ?? null,
      lastUsedAt: r.lastUsedAt ?? null
    };
  }

  async verify(rawKey: string): Promise<boolean> {
    const parsed = parseApiKey(rawKey);
    if (!parsed) return false;
    const { prefix, secret } = parsed;
    const rows = await this.db
      .select()
      .from(this.apiKeys)
      .where(and(eq(this.apiKeys.prefix, prefix), isNull(this.apiKeys.revokedAt)))
      .limit(1);
    const r = rows?.[0];
    if (!r) return false;
    if (isExpired(r.expiresAt ?? null)) return false;
    const ok = verifySecret(secret, String(r.hash));
    if (!ok) return false;
    const now = new Date().toISOString();
    await this.db.update(this.apiKeys).set({ lastUsedAt: now }).where(eq(this.apiKeys.id, String(r.id)));
    return true;
  }
}

