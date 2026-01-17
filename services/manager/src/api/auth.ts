import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppDeps } from "../types/deps.js";

export interface AuthPluginOptions {
  apiKey: string;
  deps: AppDeps;
}

const authPluginImpl: FastifyPluginAsync<AuthPluginOptions> = async (app, opts) => {
  app.addHook("preHandler", async (request, reply) => {
    const url = request.raw.url ?? request.url;
    // Only protect API routes; the embedded admin UI is served from `/` and must be publicly fetchable by the browser.
    if (!url.startsWith("/v1/")) {
      return;
    }

    // Session auth for the UI (cookie set by /auth/login)
    const sessions = (app as any).sessions as { get: (id?: string | null) => any } | undefined;
    const sid = (request.cookies as any)?.rds_session as string | undefined;
    if (sessions?.get(sid)) {
      return;
    }

    const rawKey = request.headers["x-api-key"];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (key === opts.apiKey) return;

    // DB API keys (if wired)
    const apiKeyService = opts.deps.apiKeyService;
    if (typeof key === "string" && apiKeyService && (await apiKeyService.verify(key))) {
      return;
    }

    reply.code(401);
    return reply.send({ message: "Unauthorized" });
  });
};

export const authPlugin = fp(authPluginImpl);
