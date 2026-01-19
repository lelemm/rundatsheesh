import { spawn } from "node:child_process";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatUtcForDateSet(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = pad2(d.getUTCMonth() + 1);
  const dd = pad2(d.getUTCDate());
  const hh = pad2(d.getUTCHours());
  const mi = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

async function run(cmd: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += String(d)));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code ?? -1}: ${stderr}`));
    });
  });
}

export async function syncSystemTime(unixTimeMs: number): Promise<void> {
  if (!Number.isFinite(unixTimeMs) || unixTimeMs <= 0) {
    throw new Error("unixTimeMs must be a positive number");
  }
  const formatted = formatUtcForDateSet(unixTimeMs);
  // Prefer UTC set; fall back if the date implementation doesn't support -u.
  try {
    await run("date", ["-u", "-s", formatted]);
  } catch {
    await run("date", ["-s", formatted]);
  }
}

