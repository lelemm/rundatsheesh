import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

type SpawnCall = { cmd: string; args: string[] };
const calls: SpawnCall[] = [];

vi.mock("node:child_process", () => {
  return {
    spawn: (cmd: string, args: string[]) => {
      calls.push({ cmd, args });

      // Simulate iptables -C failing (jump missing) so ensureChain inserts it.
      const exitCode = args[0] === "-C" ? 1 : 0;

      const proc = new EventEmitter() as any;
      proc.stdout = new PassThrough();
      proc.stderr = new PassThrough();

      queueMicrotask(() => {
        proc.emit("close", exitCode);
      });

      return proc;
    }
  };
});

describe("IptablesFirewallManager", async () => {
  // Import after mock.
  const { IptablesFirewallManager } = await import("../firewallManager.js");

  it("denies all outbound when outboundInternet=false (deny-by-default)", async () => {
    calls.length = 0;
    const fw = new IptablesFirewallManager();
    await fw.applyAllowlist(["8.8.8.8/32"], false);

    const argsJoined = calls.map((c) => c.args.join(" "));
    expect(argsJoined.some((a) => a.includes("-A RUN_DAT_SHEESH_OUT -j DROP"))).toBe(true);
    // We ignore allowIps when outbound is disabled.
    expect(argsJoined.some((a) => a.includes("-d 8.8.8.8/32"))).toBe(false);
  });

  it("allows only allowlisted destinations when outboundInternet=true", async () => {
    calls.length = 0;
    const fw = new IptablesFirewallManager();
    await fw.applyAllowlist(["1.2.3.4/32"], true);

    const argsJoined = calls.map((c) => c.args.join(" "));
    expect(argsJoined.some((a) => a.includes("-A RUN_DAT_SHEESH_OUT -d 1.2.3.4/32 -j ACCEPT"))).toBe(true);
    expect(argsJoined.some((a) => a.includes("-A RUN_DAT_SHEESH_OUT -j DROP"))).toBe(true);
  });
});

