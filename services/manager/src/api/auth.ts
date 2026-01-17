import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

export interface AuthPluginOptions {
  apiKey: string;
}

const authPluginImpl: FastifyPluginAsync<AuthPluginOptions> = async (app, opts) => {
  app.addHook("preHandler", async (request, reply) => {
    const url = request.raw.url ?? request.url;
    // Only protect API routes; the embedded admin UI is served from `/` and must be publicly fetchable by the browser.
    if (!url.startsWith("/v1/")) {
      return;
    }

    const rawKey = request.headers["x-api-key"];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (key !== opts.apiKey) {
      reply.code(401);
      return reply.send({ message: "Unauthorized" });
    }
  });
};

export const authPlugin = fp(authPluginImpl);
