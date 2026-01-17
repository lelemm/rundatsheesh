import { randomUUID } from "node:crypto";

export interface SessionInfo {
  id: string;
  email: string;
  createdAt: string;
}

export class SessionManager {
  private readonly items = new Map<string, SessionInfo>();

  create(email: string): SessionInfo {
    const s: SessionInfo = { id: randomUUID(), email, createdAt: new Date().toISOString() };
    this.items.set(s.id, s);
    return s;
  }

  get(id: string | null | undefined): SessionInfo | null {
    if (!id) return null;
    return this.items.get(id) ?? null;
  }

  revoke(id: string | null | undefined) {
    if (!id) return;
    this.items.delete(id);
  }
}

