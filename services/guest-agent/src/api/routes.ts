import type { FastifyPluginAsync } from "fastify";
import { Readable } from "node:stream";
import type { ExecRequest, NetConfigRequest, RunTsRequest } from "../types/agent.js";
import type { ExecRunner, FileService, FirewallManager, NetworkConfigurator } from "../types/interfaces.js";

export interface ApiPluginOptions {
  execRunner: ExecRunner;
  fileService: FileService;
  firewallManager: FirewallManager;
  networkConfigurator: NetworkConfigurator;
}

export const apiPlugin: FastifyPluginAsync<ApiPluginOptions> = async (app, opts) => {
  app.get("/health", async () => ({ status: "ok" }));

  app.post("/firewall/allowlist", async (request, reply) => {
    const body = request.body as { allowIps?: string[]; outboundInternet?: boolean };
    const allowIps = body?.allowIps ?? [];
    const outboundInternet = Boolean(body?.outboundInternet);
    await opts.firewallManager.applyAllowlist(allowIps, outboundInternet);
    reply.code(204);
  });

  app.post("/net/config", async (request, reply) => {
    const payload = request.body as NetConfigRequest;
    await opts.networkConfigurator.configure(payload);
    reply.code(204);
  });

  app.post("/exec", async (request) => {
    const payload = request.body as ExecRequest;
    return opts.execRunner.exec(payload);
  });

  app.post("/run-ts", async (request) => {
    const payload = request.body as RunTsRequest;
    return opts.execRunner.runTs(payload);
  });

  app.post("/files/upload", async (request, reply) => {
    const dest = (request.query as { dest?: string }).dest ?? "";
    if (!dest) {
      reply.code(400);
      return { message: "dest is required" };
    }
    const body = request.body as unknown;
    const stream = Buffer.isBuffer(body) ? Readable.from(body) : request.raw;
    try {
      await opts.fileService.upload(dest, stream);
      reply.code(204);
      return;
    } catch (err) {
      reply.code(400);
      return { message: "Invalid upload dest or archive" };
    }
  });

  app.get("/files/download", async (request, reply) => {
    const path = (request.query as { path?: string }).path ?? "";
    if (!path) {
      reply.code(400);
      return { message: "path is required" };
    }
    try {
      await opts.fileService.download(path, reply.raw);
      reply.code(200);
      return;
    } catch (err) {
      reply.code(400);
      return { message: "Invalid download path" };
    }
  });
};
