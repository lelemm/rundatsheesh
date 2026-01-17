import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { ExecRunnerImpl } from "./exec/execRunner.js";
import { TarFileService } from "./files/fileService.js";
import { IptablesFirewallManager } from "./firewall/firewallManager.js";
import { IpNetworkConfigurator } from "./network/networkConfigurator.js";

const env = loadEnv();

const app = buildApp({
  execRunner: new ExecRunnerImpl(),
  fileService: new TarFileService(),
  firewallManager: new IptablesFirewallManager(),
  networkConfigurator: new IpNetworkConfigurator()
});

// The guest agent is accessed via the vsock->TCP bridge (socat) on guest loopback.
// Binding to 127.0.0.1 reduces exposure on the guest network interface.
app.listen({ port: env.port, host: "127.0.0.1" }).catch((err) => {
  app.log.error(err, "Failed to start guest agent");
  process.exit(1);
});
