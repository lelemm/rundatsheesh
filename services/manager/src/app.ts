import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { authPlugin } from "./api/auth.js";
import { apiPlugin } from "./api/routes.js";
import type { AppDeps } from "./types/deps.js";

export interface BuildAppOptions {
  apiKey: string;
  deps: AppDeps;
}

export function buildApp(options: BuildAppOptions) {
  const app = Fastify({ logger: true });

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
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list"
    }
  });

  // Convenience endpoint for tooling (and to match the auth plugin allowlist).
  // Swagger UI uses `/docs/json`, but external clients often expect a stable `/openapi.json`.
  app.get("/openapi.json", async () => app.swagger());

  app.addContentTypeParser(
    ["application/gzip", "application/x-tar", "application/octet-stream"],
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body)
  );

  app.register(authPlugin, { apiKey: options.apiKey });
  app.register(apiPlugin, { deps: options.deps });

  return app;
}
