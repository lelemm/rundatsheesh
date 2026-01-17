import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { NetworkManager } from "../types/interfaces.js";
import type { VmRecord } from "../types/vm.js";

const execFileAsync = promisify(execFile);

export interface NetworkOptions {
  subnetCidr: string;
  gatewayIp: string;
}

export class SimpleNetworkManager implements NetworkManager {
  private nextHost = 2;
  private readonly bridgeName = "rds-br0";

  constructor(private readonly options: NetworkOptions) {}

  async allocateIp(): Promise<{ guestIp: string; tapName: string }> {
    const guestIp = this.allocateGuestIp();
    const tapName = `tap-${guestIp.split(".").pop()}`;
    return { guestIp, tapName };
  }

  async configure(vm: VmRecord, tapName: string, options?: { up?: boolean }): Promise<void> {
    await this.ensureBridge();
    // If a previous session stopped without teardown, the tap may still exist.
    // Remove it so start is idempotent.
    await execFileAsync("ip", ["link", "del", tapName]).catch(() => undefined);
    await execFileAsync("ip", ["tuntap", "add", tapName, "mode", "tap"]);
    // Attach the tap to the bridge (which holds the gateway IP).
    await execFileAsync("ip", ["link", "set", tapName, "master", this.bridgeName]);
    if (options?.up ?? true) {
      await execFileAsync("ip", ["link", "set", tapName, "up"]);
    }

    if (vm.outboundInternet) {
      await execFileAsync("iptables", [
        "-t",
        "nat",
        "-C",
        "POSTROUTING",
        "-s",
        this.options.subnetCidr,
        "!",
        "-d",
        this.options.subnetCidr,
        "-j",
        "MASQUERADE"
      ]).catch(async () => {
        await execFileAsync("iptables", [
          "-t",
          "nat",
          "-A",
          "POSTROUTING",
          "-s",
          this.options.subnetCidr,
          "!",
          "-d",
          this.options.subnetCidr,
          "-j",
          "MASQUERADE"
        ]);
      });
    }

    // Enforce outbound allowlist at the host level (manager container) to prevent data leak.
    // This avoids relying on guest netfilter/iptables support.
    await this.configureHostEgressAllowlist(vm, tapName);
  }

  async bringUpTap(tapName: string): Promise<void> {
    await execFileAsync("ip", ["link", "set", tapName, "up"]);
  }

  async teardown(_vm: VmRecord, tapName: string): Promise<void> {
    await this.teardownHostEgressAllowlist(_vm, tapName);
    await execFileAsync("ip", ["link", "del", tapName]).catch(() => undefined);
  }

  private allocateGuestIp(): string {
    const [base, _mask] = this.options.subnetCidr.split("/");
    const parts = base.split(".").map((part) => Number(part));
    parts[3] = this.nextHost;
    this.nextHost += 1;
    return parts.join(".");
  }

  private async ensureBridge(): Promise<void> {
    // Create and bring up the bridge that represents the VM subnet gateway.
    await execFileAsync("ip", ["link", "add", this.bridgeName, "type", "bridge"]).catch(() => undefined);
    await execFileAsync("ip", ["addr", "add", `${this.options.gatewayIp}/24`, "dev", this.bridgeName]).catch(() => undefined);
    await execFileAsync("ip", ["link", "set", this.bridgeName, "up"]).catch(() => undefined);
  }

  private chainNameForTap(tapName: string): string {
    // iptables chain name limit is 29 chars; keep it short and deterministic.
    const safe = tapName.replace(/[^a-zA-Z0-9]/g, "_");
    return `RDS_${safe}`.slice(0, 29);
  }

  private async configureHostEgressAllowlist(vm: VmRecord, tapName: string): Promise<void> {
    const chain = this.chainNameForTap(tapName);
    const allowIps = (vm.allowIps ?? []).filter((x) => typeof x === "string" && x.length > 0);

    // Create chain if missing, then flush and rebuild.
    await execFileAsync("iptables", ["-N", chain]).catch(() => undefined);
    await execFileAsync("iptables", ["-F", chain]).catch(() => undefined);

    // Always allow established flows.
    await execFileAsync("iptables", ["-A", chain, "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"]).catch(
      () => undefined
    );

    // When outboundInternet=true, allow only destinations in allowIps. Otherwise, allow none (deny-by-default).
    if (vm.outboundInternet) {
      for (const ip of allowIps) {
        await execFileAsync("iptables", ["-A", chain, "-d", ip, "-j", "ACCEPT"]).catch(() => undefined);
      }
    }

    // Default deny.
    await execFileAsync("iptables", ["-A", chain, "-j", "DROP"]).catch(() => undefined);

    // Ensure packets from this VM hit the chain:
    // - INPUT: VM -> host services (e.g., gateway IP 172.16.0.1)
    // - FORWARD: VM -> outside via NAT
    // When using a bridge, packets will appear as incoming on the bridge interface.
    await this.ensureJump("INPUT", this.bridgeName, vm.guestIp, chain);
    await this.ensureJump("FORWARD", this.bridgeName, vm.guestIp, chain);
  }

  private async ensureJump(parentChain: "INPUT" | "FORWARD", tapName: string, guestIp: string, targetChain: string): Promise<void> {
    const rule = ["-i", tapName, "-s", guestIp, "-j", targetChain];
    const has = await execFileAsync("iptables", ["-C", parentChain, ...rule])
      .then(() => true)
      .catch(() => false);
    if (!has) {
      await execFileAsync("iptables", ["-I", parentChain, "1", ...rule]).catch(() => undefined);
    }
  }

  private async teardownHostEgressAllowlist(vm: VmRecord, tapName: string): Promise<void> {
    const chain = this.chainNameForTap(tapName);
    const rule = ["-i", this.bridgeName, "-s", vm.guestIp, "-j", chain];
    await execFileAsync("iptables", ["-D", "INPUT", ...rule]).catch(() => undefined);
    await execFileAsync("iptables", ["-D", "FORWARD", ...rule]).catch(() => undefined);
    await execFileAsync("iptables", ["-F", chain]).catch(() => undefined);
    await execFileAsync("iptables", ["-X", chain]).catch(() => undefined);
  }
}
