import Fastify from "fastify";
import { apiPlugin } from "./api/routes.js";
import type { ExecRunner, FileService, FirewallManager, NetworkConfigurator } from "./types/interfaces.js";

export interface BuildAppOptions {
  execRunner: ExecRunner;
  fileService: FileService;
  firewallManager: FirewallManager;
  networkConfigurator: NetworkConfigurator;
}

export function buildApp(options: BuildAppOptions) {
  const app = Fastify({ logger: true });

  // The manager uploads/downloads files as tar.gz streams. Fastify returns 415 unless we
  // register a parser for the content-types we expect.
  app.addContentTypeParser(
    ["application/octet-stream", "application/gzip", "application/x-gzip"],
    { parseAs: "buffer" },
    (_req, payload, done) => done(null, payload)
  );

  app.register(apiPlugin, options);
  return app;
}
