import { spawn } from "node:child_process";
import type { FirewallManager } from "../types/interfaces.js";

/**
 * Best-effort firewall manager.
 *
 * This should be safe-by-default (deny egress unless explicitly allowed) to prevent data leak.
 *
 * IMPORTANT: This is still "best effort" at the API level: the endpoint must not throw even if
 * iptables isn't available in the guest image. When iptables is available, we enforce egress.
 */
export class IptablesFirewallManager implements FirewallManager {
  async applyAllowlist(allowIps: string[], outboundInternet: boolean): Promise<void> {
    const allow = Boolean(outboundInternet);
    const ips = sanitizeIps(allowIps);
    try {
      await this.ensureChain();
      await this.flushChain();
      await this.addBaseRules();
      // If outbound is allowed, only allow destinations in the allowlist.
      if (allow) {
        for (const ip of ips) {
          await runCmd("iptables", ["-A", "RUN_DAT_SHEESH_OUT", "-d", ip, "-j", "ACCEPT"]);
        }
      }

      // Deny-by-default to prevent data leak. Note that VSock traffic is unaffected.
      await runCmd("iptables", ["-A", "RUN_DAT_SHEESH_OUT", "-j", "DROP"]);
    } catch (err) {
      // Best-effort only; do not fail the agent API.
      console.warn("[firewall] applyAllowlist best-effort failed:", err);
    }
  }

  private async ensureChain(): Promise<void> {
    // Create chain if missing.
    await runCmd("iptables", ["-N", "RUN_DAT_SHEESH_OUT"]).catch(() => undefined);
    // Ensure OUTPUT jumps to our chain.
    const hasJump = await runCmd("iptables", ["-C", "OUTPUT", "-j", "RUN_DAT_SHEESH_OUT"])
      .then(() => true)
      .catch(() => false);
    if (!hasJump) {
      await runCmd("iptables", ["-I", "OUTPUT", "1", "-j", "RUN_DAT_SHEESH_OUT"]);
    }
  }

  private async flushChain(): Promise<void> {
    await runCmd("iptables", ["-F", "RUN_DAT_SHEESH_OUT"]);
  }

  private async addBaseRules(): Promise<void> {
    // Always allow loopback and established traffic.
    await runCmd("iptables", ["-A", "RUN_DAT_SHEESH_OUT", "-o", "lo", "-j", "ACCEPT"]);
    await runCmd("iptables", ["-A", "RUN_DAT_SHEESH_OUT", "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"]);
  }
}

function sanitizeIps(allowIps: string[] | undefined | null): string[] {
  const ips = (allowIps ?? []).filter((x) => typeof x === "string").map((x) => x.trim()).filter((x) => x.length > 0);
  // Conservative allowlist: IPv4 with optional /CIDR. (iptables accepts lots of formats; we keep it tight.)
  const ipv4Cidr = /^(?:\d{1,3}\.){3}\d{1,3}(?:\/(?:\d|[12]\d|3[0-2]))?$/;
  return ips.filter((x) => ipv4Cidr.test(x));
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
