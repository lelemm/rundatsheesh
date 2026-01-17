import type { FastifyPluginAsync } from "fastify";
import type { AppDeps } from "../types/deps.js";

export interface ApiPluginOptions {
  deps: AppDeps;
}

export const apiPlugin: FastifyPluginAsync<ApiPluginOptions> = async (app, opts) => {
  const BODY_LIMITS = {
    jsonSmall: 64 * 1024,
    jsonMedium: 1024 * 1024,
    uploadCompressed: 10 * 1024 * 1024
  };

  app.get(
    "/v1/snapshots",
    {
      schema: {
        summary: "List snapshots",
        description: "Lists snapshots stored under STORAGE_ROOT/snapshots, including VM snapshots (with disk baseline) and template snapshots.",
        tags: ["snapshots"],
        response: {
          200: { type: "array", items: { type: "object", additionalProperties: true } }
        }
      }
    },
    async () => {
    return opts.deps.vmService.listSnapshots();
    }
  );

  app.post(
    "/v1/vms/:id/snapshots",
    {
      schema: {
        summary: "Create snapshot from VM",
        description:
          "Creates a VM snapshot (Firecracker mem+state) plus a disk baseline clone so that /home/user content (SDK uploads) is preserved for later restores.",
        tags: ["snapshots"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", description: "VM id" } }
        },
        response: {
          201: { type: "object", additionalProperties: true },
          400: { type: "object" },
          401: { type: "object" },
          404: { type: "object" }
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const snap = await opts.deps.vmService.createSnapshot(id);
      reply.code(201);
      return snap;
    }
  );

  app.get(
    "/v1/vms",
    {
      schema: {
        summary: "List VMs",
        description: "Lists all VMs known to the manager (in-memory store in this build).",
        tags: ["vms"],
        response: {
          200: { type: "array", items: { type: "object", additionalProperties: true } }
        }
      }
    },
    async () => {
      return opts.deps.vmService.list();
    }
  );

  app.get(
    "/v1/vms/:id",
    {
      schema: {
        summary: "Get VM",
        description: "Fetches a single VM by id.",
        tags: ["vms"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", description: "VM id" } }
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { type: "object" }
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const vm = await opts.deps.vmService.get(id);
      if (!vm) {
        reply.code(404);
        return { message: "VM not found" };
      }
      return vm;
    }
  );

  app.post(
    "/v1/vms",
    {
      bodyLimit: BODY_LIMITS.jsonSmall,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        summary: "Create VM",
        description:
          "Creates and boots a new microVM. If snapshotId is provided, the VM is restored from that snapshot (including /home/user disk baseline).",
        tags: ["vms"],
        openapi: {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["cpu", "memMb", "allowIps"],
                  properties: {
                    cpu: { type: "number" },
                    memMb: { type: "number" },
                    allowIps: { type: "array", items: { type: "string" } },
                    outboundInternet: { type: "boolean" },
                    snapshotId: { type: "string" }
                  }
                },
                examples: {
                  boot: { value: { cpu: 1, memMb: 256, allowIps: ["172.16.0.1/32"], outboundInternet: true } },
                  fromSnapshot: { value: { cpu: 1, memMb: 256, allowIps: ["172.16.0.1/32"], outboundInternet: true, snapshotId: "snap-<uuid>" } }
                }
              }
            }
          }
        },
        body: {
          type: "object",
          required: ["cpu", "memMb", "allowIps"],
          properties: {
            cpu: { type: "number", description: "vCPU count" },
            memMb: { type: "number", description: "Memory in MiB" },
            allowIps: { type: "array", items: { type: "string" }, description: "Outbound allowlist (IPv4/CIDR)" },
            outboundInternet: { type: "boolean", description: "Enable outbound internet (still restricted to allowIps)" },
            snapshotId: { type: "string", description: "Optional snapshot id created via POST /v1/vms/:id/snapshots" }
          },
          examples: [
            { cpu: 1, memMb: 256, allowIps: ["172.16.0.1/32"], outboundInternet: true },
            { cpu: 1, memMb: 256, allowIps: ["172.16.0.1/32"], outboundInternet: true, snapshotId: "snap-<uuid>" }
          ]
        },
        response: {
          201: {
            type: "object",
            additionalProperties: true,
            properties: {
              id: { type: "string" },
              state: { type: "string" },
              cpu: { type: "number" },
              memMb: { type: "number" },
              guestIp: { type: "string" },
              outboundInternet: { type: "boolean" },
              createdAt: { type: "string" },
              provisionMode: { type: "string" }
            }
          },
          400: { type: "object" }
        }
      }
    },
    async (request, reply) => {
      const body = request.body as
        | { cpu?: number; memMb?: number; allowIps?: string[]; outboundInternet?: boolean; snapshotId?: string }
        | undefined;
      if (!body || typeof body.cpu !== "number" || typeof body.memMb !== "number" || !Array.isArray(body.allowIps)) {
        reply.code(400);
        return { message: "Invalid request body" };
      }
      const vm = await opts.deps.vmService.create({
        cpu: body.cpu,
        memMb: body.memMb,
        allowIps: body.allowIps,
        outboundInternet: body.outboundInternet,
        snapshotId: body.snapshotId
      });
      reply.code(201);
      return vm;
    }
  );

  app.post(
    "/v1/vms/:id/start",
    {
      schema: {
        summary: "Start VM",
        description: "Starts an existing VM (best-effort; creates a new Firecracker process and boots from its disk).",
        tags: ["vms"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        response: { 204: { type: "null" } }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await opts.deps.vmService.start(id);
      reply.code(204);
    }
  );

  app.post(
    "/v1/vms/:id/stop",
    {
      schema: {
        summary: "Stop VM",
        description: "Sends a best-effort ACPI shutdown (Ctrl-Alt-Del) to the VM.",
        tags: ["vms"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        response: { 204: { type: "null" } }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await opts.deps.vmService.stop(id);
      reply.code(204);
    }
  );

  app.delete(
    "/v1/vms/:id",
    {
      schema: {
        summary: "Destroy VM",
        description: "Stops Firecracker (if running), tears down networking, and removes per-VM storage.",
        tags: ["vms"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        response: { 204: { type: "null" } }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await opts.deps.vmService.destroy(id);
      reply.code(204);
    }
  );

  app.post(
    "/v1/vms/:id/exec",
    {
      bodyLimit: BODY_LIMITS.jsonMedium,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        summary: "Execute command",
        description: "Executes a shell command inside the VM as uid/gid 1000, confined to /home/user.",
        tags: ["exec"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        openapi: {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["cmd"],
                  properties: {
                    cmd: { type: "string" },
                    cwd: { type: "string" },
                    env: { type: "object", additionalProperties: { type: "string" } },
                    timeoutMs: { type: "number" }
                  }
                },
                examples: {
                  simple: { value: { cmd: "echo hello" } },
                  withTimeout: { value: { cmd: "ls -la /home/user", timeoutMs: 30000 } }
                }
              }
            }
          }
        },
        body: {
          type: "object",
          required: ["cmd"],
          properties: {
            cmd: { type: "string", description: "Shell command (bash -lc)" },
            cwd: { type: "string", description: "Working directory (defaults to /home/user)" },
            env: { type: "object", additionalProperties: { type: "string" }, description: "Environment variables" },
            timeoutMs: { type: "number", description: "Timeout in milliseconds" }
          },
          examples: [{ cmd: "echo hello" }, { cmd: "ls -la /home/user", timeoutMs: 30000 }]
        },
        response: {
          200: {
            type: "object",
            required: ["exitCode", "stdout", "stderr"],
            properties: {
              exitCode: { type: "number", description: "Process exit code" },
              stdout: { type: "string", description: "UTF-8 stdout" },
              stderr: { type: "string", description: "UTF-8 stderr" }
            },
            examples: [{ exitCode: 0, stdout: "hello\n", stderr: "" }]
          },
          400: { type: "object" }
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { cmd?: string; cwd?: string; env?: Record<string, string>; timeoutMs?: number } | undefined;
      if (!body || typeof body.cmd !== "string") {
        reply.code(400);
        return { message: "Invalid request body" };
      }
      return opts.deps.vmService.exec(id, {
        cmd: body.cmd,
        cwd: body.cwd,
        env: body.env,
        timeoutMs: body.timeoutMs
      });
    }
  );

  app.post(
    "/v1/vms/:id/run-ts",
    {
      bodyLimit: BODY_LIMITS.jsonMedium,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        summary: "Run TypeScript (Deno)",
        description:
          "Runs TypeScript inside the VM using Deno with strict /home/user read/write permissions. Provide either inline code or a file path.",
        tags: ["exec"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        openapi: {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  anyOf: [{ required: ["code"] }, { required: ["path"] }],
                  properties: {
                    path: { type: "string" },
                    code: { type: "string" },
                    args: { type: "array", items: { type: "string" } },
                    denoFlags: { type: "array", items: { type: "string" } },
                    timeoutMs: { type: "number" }
                  }
                },
                examples: {
                  inline: { value: { code: "console.log(2 + 2)" } },
                  file: { value: { path: "/home/user/app/main.ts" } }
                }
              }
            }
          }
        },
        body: {
          type: "object",
          anyOf: [{ required: ["code"] }, { required: ["path"] }],
          properties: {
            path: { type: "string", description: "Path to a .ts file inside /home/user" },
            code: { type: "string", description: "Inline TypeScript code" },
            args: { type: "array", items: { type: "string" }, description: "Arguments passed to the program" },
            denoFlags: { type: "array", items: { type: "string" }, description: "Additional Deno flags (advanced)" },
            timeoutMs: { type: "number", description: "Timeout in milliseconds" }
          },
          examples: [{ code: "console.log(2 + 2)" }, { path: "/home/user/app/main.ts" }]
        },
        response: {
          200: {
            type: "object",
            required: ["exitCode", "stdout", "stderr"],
            properties: {
              exitCode: { type: "number", description: "Program exit code" },
              stdout: { type: "string", description: "UTF-8 stdout" },
              stderr: { type: "string", description: "UTF-8 stderr" }
            },
            examples: [{ exitCode: 0, stdout: "4\n", stderr: "" }]
          },
          400: { type: "object" }
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { path?: string; code?: string; args?: string[]; denoFlags?: string[]; timeoutMs?: number } | undefined;
      if (!body || (!body.path && !body.code)) {
        reply.code(400);
        return { message: "Invalid request body" };
      }
      return opts.deps.vmService.runTs(id, body);
    }
  );

  app.post(
    "/v1/vms/:id/files/upload",
    {
      bodyLimit: BODY_LIMITS.uploadCompressed,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        summary: "Upload files (tar.gz)",
        description:
          "Uploads a tar.gz archive into the VM under the provided dest directory. Dest must be confined to /home/user. Symlinks and path traversal are rejected.",
        tags: ["files"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        querystring: { type: "object", required: ["dest"], properties: { dest: { type: "string" } } },
        consumes: ["application/gzip", "application/x-gzip", "application/octet-stream"],
        openapi: {
          requestBody: {
            required: true,
            content: {
              "application/gzip": { schema: { type: "string", format: "binary" } },
              "application/x-gzip": { schema: { type: "string", format: "binary" } },
              "application/octet-stream": { schema: { type: "string", format: "binary" } }
            },
            description: "tar.gz binary stream"
          }
        },
        body: {
          // NOTE: the runtime content-type parser returns a Buffer.
          // Use a permissive schema so runtime validation does not reject binary uploads.
          // (Swagger UI will still show this route; file upload UX is limited without a dedicated OpenAPI override.)
          type: "object",
          additionalProperties: true,
          description: "tar.gz binary stream (request body is treated as raw bytes)"
        },
        response: { 204: { type: "null" }, 400: { type: "object" } }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const dest = (request.query as { dest?: string }).dest ?? "";
      if (!dest) {
        reply.code(400);
        return { message: "dest is required" };
      }
      const body = request.body;
      if (!Buffer.isBuffer(body)) {
        reply.code(400);
        return { message: "Expected binary body" };
      }
      try {
        await opts.deps.vmService.uploadFiles(id, dest, body);
        reply.code(204);
        return;
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (msg.includes("status=400")) {
          reply.code(400);
          return { message: "Invalid upload dest or archive" };
        }
        throw err;
      }
    }
  );

  app.get(
    "/v1/vms/:id/files/download",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        summary: "Download files (tar.gz)",
        description: "Downloads a directory tree as a tar.gz archive. Path must be confined to /home/user.",
        tags: ["files"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        querystring: { type: "object", required: ["path"], properties: { path: { type: "string" } } },
        openapi: {
          responses: {
            200: {
              description: "tar.gz binary stream",
              content: {
                "application/gzip": {
                  schema: { type: "string", format: "binary" }
                }
              }
            }
          }
        },
        response: {
          200: { type: "string", description: "tar.gz binary stream" },
          400: { type: "object" }
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const path = (request.query as { path?: string }).path ?? "";
      if (!path) {
        reply.code(400);
        return { message: "path is required" };
      }
      try {
        const data = await opts.deps.vmService.downloadFiles(id, path);
        reply.header("content-type", "application/gzip");
        return reply.send(data);
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (msg.includes("status=400")) {
          reply.code(400);
          return { message: "Invalid download path" };
        }
        throw err;
      }
    }
  );
};
