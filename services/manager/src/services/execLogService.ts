import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type ExecLogType = "exec" | "run-ts" | "run-js";

export interface ExecLogEntry {
  id: string;
  timestamp: string;
  type: ExecLogType;
  input: {
    cmd?: string;
    code?: string;
    path?: string;
    args?: string[];
    env?: string[];
    timeoutMs?: number;
    denoFlags?: string[];
    nodeFlags?: string[];
  };
  result: {
    exitCode: number;
    stdout: string;
    stderr: string;
    result?: unknown;
    error?: unknown;
  };
  durationMs: number;
}

export class ExecLogService {
  private readonly fileName: string;
  private readonly maxReadBytes: number;

  constructor(opts?: { fileName?: string; maxReadBytes?: number }) {
    this.fileName = opts?.fileName ?? "exec.jsonl";
    this.maxReadBytes = opts?.maxReadBytes ?? 512 * 1024;
  }

  buildEntry(input: Omit<ExecLogEntry, "id" | "timestamp">): ExecLogEntry {
    return {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...input
    };
  }

  async append(logsDir: string, entry: ExecLogEntry): Promise<void> {
    await fs.mkdir(logsDir, { recursive: true });
    const p = path.join(logsDir, this.fileName);
    await fs.appendFile(p, JSON.stringify(entry) + "\n", "utf-8");
  }

  async tail(
    logsDir: string,
    opts?: { limit?: number; type?: ExecLogType | "all" }
  ): Promise<{ entries: ExecLogEntry[]; hasMore: boolean }> {
    const limit = clampLimit(opts?.limit);
    const type = opts?.type ?? "all";
    const p = path.join(logsDir, this.fileName);

    let stat: { size: number } | null = null;
    try {
      const raw = await fs.stat(p);
      stat = { size: raw.size };
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        return { entries: [], hasMore: false };
      }
      throw err;
    }

    if (!stat || stat.size === 0) {
      return { entries: [], hasMore: false };
    }

    const readBytes = Math.min(stat.size, this.maxReadBytes);
    const start = Math.max(0, stat.size - readBytes);
    const handle = await fs.open(p, "r");
    let text = "";
    try {
      const buffer = Buffer.alloc(readBytes);
      await handle.read(buffer, 0, readBytes, start);
      text = buffer.toString("utf-8");
    } finally {
      await handle.close().catch(() => undefined);
    }

    let lines = text.split(/\r?\n/);
    if (start > 0 && lines.length > 0) {
      // First line is likely partial; drop it.
      lines = lines.slice(1);
    }
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    const parsed: ExecLogEntry[] = [];
    for (const line of lines) {
      try {
        const v = JSON.parse(line) as ExecLogEntry;
        if (!v || typeof v !== "object") continue;
        if (v.type !== "exec" && v.type !== "run-ts" && v.type !== "run-js") continue;
        parsed.push(v);
      } catch {
        // ignore invalid lines
      }
    }

    const filtered = type === "all" ? parsed : parsed.filter((e) => e.type === type);
    const hasMore = start > 0 || filtered.length > limit;
    const slice = filtered.slice(-limit).reverse(); // newest-first
    return { entries: slice, hasMore };
  }
}

function clampLimit(input?: number): number {
  const n = typeof input === "number" ? input : 50;
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

