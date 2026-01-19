import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import type { NetConfigRequest } from "../types/agent.js";
import type { NetworkConfigurator } from "../types/interfaces.js";
import { SANDBOX_ROOT } from "../config/constants.js";

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const MAC = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;

export class IpNetworkConfigurator implements NetworkConfigurator {
  async configure(payload: NetConfigRequest): Promise<void> {
    const iface = (payload.iface ?? "eth0").trim();
    if (iface !== "eth0") {
      throw new Error("Only eth0 is supported");
    }
    const dnsOnly = Boolean(payload.dnsOnly);
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

    if (!dnsOnly) {
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

    // Ensure DNS works for jailed /exec and /run-ts calls.
    // The microVM is statically configured; use the gateway as a simple resolver (host provides it).
    await ensureResolvConf(payload.dns ? String(payload.dns).trim() : gateway);
  }
}

async function ensureResolvConf(nameserverIp: string): Promise<void> {
  const content = `nameserver ${nameserverIp}\noptions timeout:1 attempts:2\n`;
  // Write for the normal rootfs. Some minimal images ship /etc/resolv.conf as a symlink to a non-existent target.
  // To avoid silent DNS misconfig, force it to be a real file.
  await fs.mkdir("/etc", { recursive: true }).catch(() => undefined);
  await ensureRegularFile("/etc/resolv.conf");
  await fs.writeFile("/etc/resolv.conf", content, { encoding: "utf-8", mode: 0o644 }).catch(() => undefined);

  // Write for the sandbox chroot (used by /exec and /run-ts) as a fallback.
  await fs.mkdir(`${SANDBOX_ROOT}/etc`, { recursive: true }).catch(() => undefined);
  await ensureRegularFile(`${SANDBOX_ROOT}/etc/resolv.conf`);
  await fs.writeFile(`${SANDBOX_ROOT}/etc/resolv.conf`, content, { encoding: "utf-8", mode: 0o644 }).catch(() => undefined);
}

async function ensureRegularFile(p: string): Promise<void> {
  try {
    const st = await fs.lstat(p);
    if (st.isSymbolicLink() || !st.isFile()) {
      await fs.rm(p, { force: true });
      await fs.writeFile(p, "", { encoding: "utf-8", mode: 0o644 });
    }
  } catch {
    // Doesn't exist; create it.
    await fs.writeFile(p, "", { encoding: "utf-8", mode: 0o644 }).catch(() => undefined);
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

