import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

export interface AuthPluginOptions {
  apiKey: string;
}

const authPluginImpl: FastifyPluginAsync<AuthPluginOptions> = async (app, opts) => {
  app.addHook("preHandler", async (request, reply) => {
    // Keep docs/spec public so Swagger UI can load the OpenAPI document before the user provides an API key.
    // The actual API endpoints remain protected via the security scheme in the OpenAPI spec.
    const url = request.raw.url ?? request.url;
    if (url === "/openapi.json" || url.startsWith("/docs")) {
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
