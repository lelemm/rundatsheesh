import { spawn } from "node:child_process";
import type { NetConfigRequest } from "../types/agent.js";
import type { NetworkConfigurator } from "../types/interfaces.js";

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const MAC = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;

export class IpNetworkConfigurator implements NetworkConfigurator {
  async configure(payload: NetConfigRequest): Promise<void> {
    const iface = (payload.iface ?? "eth0").trim();
    if (iface !== "eth0") {
      throw new Error("Only eth0 is supported");
    }
    const ip = String(payload.ip ?? "").trim();
    const gateway = String(payload.gateway ?? "").trim();
    const cidr = payload.cidr ?? 24;
    const mac = payload.mac ? String(payload.mac).trim() : undefined;

    if (!IPV4.test(ip) || !IPV4.test(gateway)) {
      throw new Error("Invalid ip or gateway");
    }
    if (!Number.isInteger(cidr) || cidr <= 0 || cidr > 32) {
      throw new Error("Invalid cidr");
    }
    if (mac && !MAC.test(mac)) {
      throw new Error("Invalid mac");
    }

    // Keep this sequence conservative; if anything fails, the caller can retry.
    await runCmd("ip", ["link", "set", "dev", iface, "down"]);
    if (mac) {
      await runCmd("ip", ["link", "set", "dev", iface, "address", mac]);
    }
    await runCmd("ip", ["addr", "flush", "dev", iface]);
    await runCmd("ip", ["addr", "add", `${ip}/${cidr}`, "dev", iface]);
    await runCmd("ip", ["route", "replace", "default", "via", gateway, "dev", iface]);
    await runCmd("ip", ["link", "set", "dev", iface, "up"]);
  }
}

async function runCmd(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += String(d)));
    proc.stderr.on("data", (d) => (stderr += String(d)));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}: ${stderr}`));
    });
  });
}

