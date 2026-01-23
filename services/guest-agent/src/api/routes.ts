import type { FastifyPluginAsync } from "fastify";
import { Readable } from "node:stream";
import type { ExecRequest, NetConfigRequest, RunJsRequest, RunTsRequest, TimeSyncRequest } from "../types/agent.js";
import type { ExecRunner, FileService, FirewallManager, NetworkConfigurator } from "../types/interfaces.js";
import { syncSystemTime } from "../time/timeSync.js";

export interface ApiPluginOptions {
  execRunner: ExecRunner;
  fileService: FileService;
  firewallManager: FirewallManager;
  networkConfigurator: NetworkConfigurator;
}

export const apiPlugin: FastifyPluginAsync<ApiPluginOptions> = async (app, opts) => {
  const BODY_LIMITS = {
    json: 256 * 1024,
    uploadCompressed: 10 * 1024 * 1024
  };

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/firewall/allowlist", { bodyLimit: BODY_LIMITS.json }, async (request, reply) => {
    const body = request.body as { allowIps?: string[]; outboundInternet?: boolean };
    const allowIps = body?.allowIps ?? [];
    const outboundInternet = Boolean(body?.outboundInternet);
    await opts.firewallManager.applyAllowlist(allowIps, outboundInternet);
    reply.code(204);
  });

  app.post("/net/config", { bodyLimit: BODY_LIMITS.json }, async (request, reply) => {
    const payload = request.body as NetConfigRequest;
    await opts.networkConfigurator.configure(payload);
    reply.code(204);
  });

  app.post("/time/sync", { bodyLimit: BODY_LIMITS.json }, async (request, reply) => {
    const payload = request.body as TimeSyncRequest;
    if (!payload || typeof (payload as any).unixTimeMs !== "number") {
      reply.code(400);
      return { message: "unixTimeMs is required" };
    }
    await syncSystemTime(payload.unixTimeMs);
    reply.code(204);
  });

  app.post("/exec", { bodyLimit: BODY_LIMITS.json }, async (request, reply) => {
    const payload = request.body as ExecRequest;
    try {
      return await opts.execRunner.exec(payload);
    } catch (err) {
      reply.code(400);
      const detail = String((err as any)?.message ?? err);
      return { message: "Invalid exec request", detail: detail.slice(0, 500) };
    }
  });

  app.post("/run-ts", { bodyLimit: BODY_LIMITS.json }, async (request, reply) => {
    const payload = request.body as RunTsRequest;
    try {
      return await opts.execRunner.runTs(payload);
    } catch (err) {
      reply.code(400);
      const detail = String((err as any)?.message ?? err);
      return { message: "Invalid run-ts request", detail: detail.slice(0, 500) };
    }
  });

  app.post("/run-js", { bodyLimit: BODY_LIMITS.json }, async (request, reply) => {
    const payload = request.body as RunJsRequest;
    try {
      return await opts.execRunner.runJs(payload);
    } catch (err) {
      reply.code(400);
      const detail = String((err as any)?.message ?? err);
      return { message: "Invalid run-js request", detail: detail.slice(0, 500) };
    }
  });

  app.post("/files/upload", { bodyLimit: BODY_LIMITS.uploadCompressed }, async (request, reply) => {
    const dest = (request.query as { dest?: string }).dest ?? "";
    if (!dest) {
      reply.code(400);
      return { message: "dest is required" };
    }
    const body = request.body as unknown;
    // NOTE: Readable.from(Buffer) iterates bytes (numbers) and corrupts binary streams.
    // Wrap the Buffer so it is emitted as a single chunk.
    const stream = Buffer.isBuffer(body) ? Readable.from([body]) : request.raw;
    try {
      await opts.fileService.upload(dest, stream);
      reply.code(204);
      return;
    } catch (err) {
      reply.code(400);
      const detail = String((err as any)?.message ?? err);
      return { message: "Invalid upload dest or archive", detail: detail.slice(0, 500) };
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
