import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import cookie from "@fastify/cookie";
import { authPlugin } from "./api/auth.js";
import { HttpError } from "./api/httpErrors.js";
import { apiPlugin } from "./api/routes.js";
import type { AppDeps } from "./types/deps.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "./auth/sessionManager.js";

export interface BuildAppOptions {
  apiKey: string;
  adminEmail: string;
  adminPassword: string;
  deps: AppDeps;
}

export function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    // Keep JSON bodies reasonably small by default; override per-route where needed.
    bodyLimit: 256 * 1024,
    logger: {
      // Redact API keys from logs (request/response objects can vary slightly by serializer).
      redact: {
        paths: [
          "req.headers.x-api-key",
          'req.headers["x-api-key"]',
          "request.headers.x-api-key",
          'request.headers["x-api-key"]'
        ],
        remove: true
      }
    }
  });

  app.setErrorHandler(async (err, request, reply) => {
    const statusCode = typeof (err as any)?.statusCode === "number" ? (err as any).statusCode : 500;
    const exposeInternalErrors = (process.env.EXPOSE_INTERNAL_ERRORS ?? "").toLowerCase() === "true";

    if (err instanceof HttpError) {
      reply.code(err.statusCode);
      return reply.send({ message: err.message });
    }

    if (statusCode >= 400 && statusCode < 500) {
      // Preserve Fastify's client error codes (e.g., 413 body limit, 429 rate limit).
      reply.code(statusCode);
      return reply.send({ message: err.message });
    }

    request.log.error({ err }, "Request failed");
    reply.code(500);
    return reply.send({
      message: exposeInternalErrors ? err.message : "Internal Server Error",
      requestId: request.id
    });
  });

  app.register(rateLimit, {
    global: true,
    // Conservative defaults; can be tuned later or made env-configurable as needed.
    max: 120,
    timeWindow: "1 minute",
    allowList: (req) => {
      const url = req.raw.url ?? req.url;
      // Public docs endpoints. Keep them out of global rate limits so the UIs can load assets smoothly.
      return url === "/openapi.json" || url.startsWith("/docs") || url.startsWith("/swagger");
    }
  });

  app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "run-dat-sheesh manager API",
        version: "0.1.0"
      },
      components: {
        securitySchemes: {
          ApiKeyAuth: {
            type: "apiKey",
            name: "X-API-Key",
            in: "header"
          }
        }
      },
      security: [{ ApiKeyAuth: [] }]
    },
    // Patch a few endpoints where runtime schemas must accept Buffers, but OpenAPI should be "binary".
    // This keeps validation permissive while making Swagger UI render proper file/binary controls.
    transformObject: (documentObject) => {
      if (!("openapiObject" in documentObject)) return documentObject.swaggerObject;

      const openapiObject = documentObject.openapiObject;

      const upload = openapiObject.paths?.["/v1/vms/{id}/files/upload"]?.post;
      const uploadRequestBody = upload?.requestBody;
      const uploadContent = uploadRequestBody && !("$ref" in uploadRequestBody) ? uploadRequestBody.content : undefined;
      if (uploadContent && typeof uploadContent === "object") {
        for (const ct of Object.keys(uploadContent)) {
          uploadContent[ct] = {
            ...(uploadContent[ct] ?? {}),
            schema: { type: "string", format: "binary" }
          };
        }
      }

      const download = openapiObject.paths?.["/v1/vms/{id}/files/download"]?.get;
      const download200 = download?.responses?.["200"];
      if (download200 && !("$ref" in download200)) {
        download200.content = {
          "application/gzip": {
            schema: { type: "string", format: "binary" }
          }
        };
      }

      return openapiObject;
    }
  });

  app.register(swaggerUi, {
    routePrefix: "/swagger",
    uiConfig: {
      docExpansion: "list"
    }
  });

  app.register(cookie);

  const sessions = new SessionManager();
  // Expose sessions to other plugins/routes (treated as internal; typed as any).
  (app as any).sessions = sessions;

  app.post("/auth/login", { bodyLimit: 16 * 1024 }, async (request, reply) => {
    const body = request.body as { email?: string; password?: string } | undefined;
    const email = body?.email ?? "";
    const password = body?.password ?? "";
    if (email !== options.adminEmail || password !== options.adminPassword) {
      reply.code(401);
      return { message: "Invalid credentials" };
    }
    const s = sessions.create(email);
    reply.setCookie("rds_session", s.id, {
      path: "/",
      httpOnly: true,
      sameSite: "lax"
    });
    return { email: s.email };
  });

  app.post("/auth/logout", async (request, reply) => {
    const sid = (request.cookies as any)?.rds_session as string | undefined;
    sessions.revoke(sid);
    reply.clearCookie("rds_session", { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", async (request, reply) => {
    const sid = (request.cookies as any)?.rds_session as string | undefined;
    const s = sessions.get(sid);
    if (!s) {
      reply.code(401);
      return { message: "Unauthorized" };
    }
    return { email: s.email };
  });

  // Embedded admin UI (static export) served from `/`.
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const adminUiRoot = path.join(__dirname, "..", "public", "admin");

  app.register(fastifyStatic, {
    root: adminUiRoot,
    prefix: "/",
    decorateReply: true,
    index: ["index.html"]
  });

  // Guard console UI: require a session cookie for HTML navigations.
  app.addHook("onRequest", async (request, reply) => {
    const url = request.raw.url ?? request.url;
    if (!url.startsWith("/console")) return;
    const accept = request.headers["accept"] ?? "";
    if (typeof accept !== "string" || !accept.includes("text/html")) return;
    const sid = (request.cookies as any)?.rds_session as string | undefined;
    if (sessions.get(sid)) return;
    reply.redirect("/login/");
  });

  // SPA-like fallback: serve index.html for non-API, non-doc routes when a file isn't found.
  app.setNotFoundHandler(async (request, reply) => {
    const url = request.raw.url ?? request.url;
    const accept = request.headers["accept"] ?? "";

    // Docs SPA fallback: serve the embedded Docusaurus index for HTML navigations.
    // Static assets (js/css/images) should 404 normally if missing.
    if (url.startsWith("/docs") && typeof accept === "string" && accept.includes("text/html")) {
      return reply.sendFile("docs/index.html");
    }

    if (url.startsWith("/v1/") || url.startsWith("/swagger") || url === "/openapi.json") {
      reply.code(404);
      return reply.send({ message: "Not Found" });
    }
    if (typeof accept === "string" && accept.includes("text/html")) {
      return reply.sendFile("index.html");
    }
    reply.code(404);
    return reply.send({ message: "Not Found" });
  });

  // Convenience endpoint for tooling (and to match the auth plugin allowlist).
  // Swagger UI uses `/docs/json`, but external clients often expect a stable `/openapi.json`.
  app.get("/openapi.json", async () => app.swagger());

  app.addContentTypeParser(
    ["application/gzip", "application/x-tar", "application/octet-stream"],
    // Leave payload as a stream; routes can buffer with limits or stream to disk.
    (_req, body, done) => done(null, body)
  );

  app.register(authPlugin, { apiKey: options.apiKey, deps: options.deps });
  app.register(apiPlugin, { deps: options.deps });

  return app;
}
