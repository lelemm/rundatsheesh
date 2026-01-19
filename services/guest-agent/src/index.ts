import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { ExecRunnerImpl } from "./exec/execRunner.js";
import { ensureExecSandboxReady } from "./exec/sandboxSetup.js";
import { TarFileService } from "./files/fileService.js";
import { IptablesFirewallManager } from "./firewall/firewallManager.js";
import { IpNetworkConfigurator } from "./network/networkConfigurator.js";

(async () => {
  const env = loadEnv();
  await ensureExecSandboxReady();

  const app = buildApp({
    execRunner: new ExecRunnerImpl(),
    fileService: new TarFileService(),
    firewallManager: new IptablesFirewallManager(),
    networkConfigurator: new IpNetworkConfigurator()
  });

  // The guest agent is accessed via the vsock->TCP bridge (socat) on guest loopback.
  // Binding to 127.0.0.1 reduces exposure on the guest network interface.
  await app.listen({ port: env.port, host: "127.0.0.1" });
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start guest agent", err);
  process.exit(1);
});
