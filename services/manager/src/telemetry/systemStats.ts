import fs from "node:fs/promises";
import os from "node:os";

export interface CpuSample {
  total: number;
  idle: number;
}

function parseProcStat(text: string): CpuSample | null {
  const line = text.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  // cpu user nice system idle iowait irq softirq steal guest guest_nice
  const nums = parts.slice(1).map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [user, nice, system, idle, iowait, irq, softirq, steal] = nums;
  const idleAll = (idle ?? 0) + (iowait ?? 0);
  const nonIdle = (user ?? 0) + (nice ?? 0) + (system ?? 0) + (irq ?? 0) + (softirq ?? 0) + (steal ?? 0);
  return { total: idleAll + nonIdle, idle: idleAll };
}

export async function getCpuUsagePct(sampleMs = 500): Promise<number | null> {
  const aText = await fs.readFile("/proc/stat", "utf-8").catch(() => "");
  const a = parseProcStat(aText);
  if (!a) return null;
  await new Promise((r) => setTimeout(r, Math.max(50, Math.min(2000, sampleMs))));
  const bText = await fs.readFile("/proc/stat", "utf-8").catch(() => "");
  const b = parseProcStat(bText);
  if (!b) return null;
  const totalDelta = b.total - a.total;
  const idleDelta = b.idle - a.idle;
  if (totalDelta <= 0) return null;
  const usage = (totalDelta - idleDelta) / totalDelta;
  return Math.max(0, Math.min(1, usage));
}

export async function getMemoryBytes(): Promise<{ total: number; available: number } | null> {
  const text = await fs.readFile("/proc/meminfo", "utf-8").catch(() => "");
  if (!text) return null;
  const getKb = (key: string) => {
    const line = text.split("\n").find((l) => l.startsWith(key));
    if (!line) return null;
    const m = line.match(/(\d+)\s*kB/i);
    return m ? Number(m[1]) : null;
  };
  const totalKb = getKb("MemTotal:");
  const availKb = getKb("MemAvailable:");
  if (!totalKb || !availKb) return null;
  return { total: totalKb * 1024, available: availKb * 1024 };
}

export async function getFsBytes(path: string): Promise<{ total: number; free: number; available: number } | null> {
  // Node 20 has statfs (Linux). If unavailable, return null.
  const anyFs = fs as any;
  if (typeof anyFs.statfs !== "function") return null;
  const s = await anyFs.statfs(path);
  const bsize = Number(s.bsize);
  const blocks = Number(s.blocks);
  const bfree = Number(s.bfree);
  const bavail = Number(s.bavail);
  if (![bsize, blocks, bfree, bavail].every(Number.isFinite)) return null;
  return {
    total: bsize * blocks,
    free: bsize * bfree,
    available: bsize * bavail
  };
}

export function getCpuCapacityCores(): number {
  return os.cpus()?.length ?? 0;
}

