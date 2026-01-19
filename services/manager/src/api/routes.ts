import type { FastifyPluginAsync } from "fastify";
import type { AppDeps } from "../types/deps.js";
import { DashboardService } from "../telemetry/dashboardService.js";
import { BodyTooLargeError, readStreamToBuffer, writeStreamToFile } from "../utils/streams.js";
import fs from "node:fs/promises";
import path from "node:path";

export interface ApiPluginOptions {
  deps: AppDeps;
}

export const apiPlugin: FastifyPluginAsync<ApiPluginOptions> = async (app, opts) => {
  const BODY_LIMITS = {
    jsonSmall: 64 * 1024,
    jsonMedium: 1024 * 1024,
    uploadCompressed: 10 * 1024 * 1024,
    // Images can be large; we stream uploads to disk but still enforce an upper bound.
    imageBinary: 3 * 1024 * 1024 * 1024
  };

  const sessions = (app as any).sessions as { get: (id?: string | null) => any } | undefined;
  const requireSession = (request: any, reply: any) => {
    const sid = request.cookies?.rds_session;
    if (sessions?.get(sid)) return true;
    reply.code(401);
    reply.send({ message: "Unauthorized" });
    return false;
  };

  app.get(
    "/v1/admin/overview",
    {
      schema: {
        summary: "Admin overview",
        description: "Aggregated dashboard stats (VM counts, snapshot counts, CPU/mem/storage).",
        tags: ["admin"],
        response: { 200: { type: "object", additionalProperties: true } }
      }
    },
    async () => {
      const svc = new DashboardService(opts.deps.store, opts.deps.storage, opts.deps.storageRoot);
      return svc.getOverview();
    }
  );

  app.get(
    "/v1/images",
    {
      schema: {
        summary: "List guest images",
        description: "Lists uploaded guest images (metadata stored in DB; artifacts stored on disk).",
        tags: ["images"],
        response: { 200: { type: "array", items: { type: "object", additionalProperties: true } } }
      }
    },
    async () => {
      return opts.deps.images.list();
    }
  );

  app.post(
    "/v1/images",
    {
      bodyLimit: BODY_LIMITS.jsonSmall,
      schema: {
        summary: "Create guest image metadata",
        tags: ["images"],
        body: {
          type: "object",
          required: ["name", "description"],
          properties: {
            name: { type: "string" },
            description: { type: "string" }
          }
        },
        response: { 201: { type: "object", additionalProperties: true } }
      }
    },
    async (request, reply) => {
      const body = request.body as { name?: string; description?: string } | undefined;
      const name = String(body?.name ?? "").trim();
      const description = String(body?.description ?? "").trim();
      if (!name || !description) {
        reply.code(400);
        return { message: "name and description are required" };
      }
      const img = await opts.deps.images.create({ name, description });
      await opts.deps.activityService
        ?.logEvent({
          type: "image.created",
          entityType: "image",
          entityId: img.id,
          message: "Image created",
          meta: { name }
        })
        .catch(() => undefined);
      reply.code(201);
      return img;
    }
  );

  app.post(
    "/v1/images/:id/set-default",
    {
      schema: {
        summary: "Set default guest image",
        tags: ["images"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        response: { 204: { type: "null" }, 404: { type: "object" } }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const img = await opts.deps.images.getById(id);
      if (!img) {
        reply.code(404);
        return { message: "Image not found" };
      }
      await opts.deps.images.setDefaultImageId(id);
      await opts.deps.activityService
        ?.logEvent({
          type: "image.default_set",
          entityType: "image",
          entityId: id,
          message: "Default image set",
          meta: { imageId: id }
        })
        .catch(() => undefined);
      reply.code(204);
      return;
    }
  );

  app.put(
    "/v1/images/:id/kernel",
    {
      bodyLimit: BODY_LIMITS.imageBinary,
      schema: {
        summary: "Upload kernel (vmlinux)",
        tags: ["images"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        response: { 204: { type: "null" }, 400: { type: "object" }, 404: { type: "object" } }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const img = await opts.deps.images.getById(id);
      if (!img) {
        reply.code(404);
        return { message: "Image not found" };
      }
      const dir = opts.deps.images.imageDirForId(id);
      await fs.mkdir(dir, { recursive: true });
      const dest = path.join(dir, "vmlinux");
      const bodyStream = request.body as any;
      await writeStreamToFile(bodyStream, dest, BODY_LIMITS.imageBinary);
      await opts.deps.images.markKernelUploaded(id, "vmlinux");
      await opts.deps.activityService
        ?.logEvent({
          type: "image.kernel_uploaded",
          entityType: "image",
          entityId: id,
          message: "Image kernel uploaded",
          meta: { imageId: id, filename: "vmlinux" }
        })
        .catch(() => undefined);
      reply.code(204);
      return;
    }
  );

  app.put(
    "/v1/images/:id/rootfs",
    {
      bodyLimit: BODY_LIMITS.imageBinary,
      schema: {
        summary: "Upload rootfs (ext4)",
        tags: ["images"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        response: { 204: { type: "null" }, 400: { type: "object" }, 404: { type: "object" } }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const img = await opts.deps.images.getById(id);
      if (!img) {
        reply.code(404);
        return { message: "Image not found" };
      }
      const dir = opts.deps.images.imageDirForId(id);
      await fs.mkdir(dir, { recursive: true });
      const dest = path.join(dir, "rootfs.ext4");
      const bodyStream = request.body as any;
      await writeStreamToFile(bodyStream, dest, BODY_LIMITS.imageBinary);
      await opts.deps.images.markRootfsUploaded(id, "rootfs.ext4");
      await opts.deps.activityService
        ?.logEvent({
          type: "image.rootfs_uploaded",
          entityType: "image",
          entityId: id,
          message: "Image rootfs uploaded",
          meta: { imageId: id, filename: "rootfs.ext4" }
        })
        .catch(() => undefined);
      reply.code(204);
      return;
    }
  );

  app.delete(
    "/v1/images/:id",
    {
      schema: {
        summary: "Delete guest image",
        tags: ["images"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        response: { 204: { type: "null" }, 404: { type: "object" }, 409: { type: "object" } }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const img = await opts.deps.images.getById(id);
      if (!img) {
        reply.code(404);
        return { message: "Image not found" };
      }
      await opts.deps.images.delete(id);
      await opts.deps.activityService
        ?.logEvent({
          type: "image.deleted",
          entityType: "image",
          entityId: id,
          message: "Image deleted",
          meta: { imageId: id }
        })
        .catch(() => undefined);
      reply.code(204);
      return;
    }
  );

  app.get(
    "/v1/admin/activity",
    {
      schema: {
        summary: "Admin activity",
        description: "Recent activity events emitted by the manager.",
        tags: ["admin"],
        querystring: {
          type: "object",
          properties: {
            limit: { type: "number" }
          }
        },
        response: { 200: { type: "array", items: { type: "object", additionalProperties: true } } }
      }
    },
    async (request) => {
      const limit = Number((request.query as any)?.limit ?? 50);
      const svc = opts.deps.activityService;
      if (!svc) return [];
      return svc.listEvents({ limit });
    }
  );

  app.get(
    "/v1/admin/events",
    {
      schema: {
        summary: "Admin events (SSE)",
        description: "Streams activity events as Server-Sent Events (SSE).",
        tags: ["admin"],
        response: { 200: { type: "string" }, 401: { type: "object" } }
      }
    },
    async (request, reply) => {
      if (!requireSession(request, reply)) return;
      const svc = opts.deps.activityService;
      if (!svc) {
        reply.code(503);
        return { message: "Activity service not available" };
      }

      const raw = reply.raw;
      reply.hijack();

      raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      raw.setHeader("Cache-Control", "no-cache, no-transform");
      raw.setHeader("Connection", "keep-alive");
      raw.flushHeaders?.();

      const safeJsonParse = (s: string | undefined) => {
        if (!s) return undefined;
        try {
          return JSON.parse(s);
        } catch {
          return undefined;
        }
      };

      const send = (eventName: string, id: string | undefined, data: unknown) => {
        if (raw.destroyed) return;
        raw.write(`event: ${eventName}\n`);
        if (id) raw.write(`id: ${id}\n`);
        raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // Initial comment so browsers treat the stream as open quickly.
      raw.write(`: connected\n\n`);

      const unsubscribe = svc.subscribe((ev) => {
        const payload = {
          ...ev,
          meta: safeJsonParse(ev.metaJson)
        };
        send("activity", ev.id, payload);
      });

      const heartbeat = setInterval(() => {
        if (raw.destroyed) return;
        raw.write(`: ping\n\n`);
      }, 15_000);

      raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    }
  );

  app.get(
    "/v1/admin/webhooks",
    {
      schema: {
        summary: "List webhooks",
        tags: ["admin"],
        response: { 200: { type: "array", items: { type: "object", additionalProperties: true } } }
      }
    },
    async (request, reply) => {
      if (!requireSession(request, reply)) return;
      const svc = opts.deps.webhookService;
      if (!svc) return [];
      return svc.list();
    }
  );

  app.post(
    "/v1/admin/webhooks",
    {
      bodyLimit: BODY_LIMITS.jsonSmall,
      schema: {
        summary: "Create webhook",
        tags: ["admin"],
        body: {
          type: "object",
          required: ["name", "url", "eventTypes"],
          properties: {
            name: { type: "string" },
            url: { type: "string" },
            enabled: { type: "boolean" },
            eventTypes: { type: "array", items: { type: "string" } }
          }
        },
        response: { 201: { type: "object", additionalProperties: true } }
      }
    },
    async (request, reply) => {
      if (!requireSession(request, reply)) return;
      const svc = opts.deps.webhookService;
      if (!svc) {
        reply.code(503);
        return { message: "Webhook service not available" };
      }
      const body = request.body as { name?: string; url?: string; enabled?: boolean; eventTypes?: unknown } | undefined;
      const name = String(body?.name ?? "").trim();
      const url = String(body?.url ?? "").trim();
      const enabled = body?.enabled !== false;
      const eventTypesRaw = body?.eventTypes;
      const eventTypes = Array.isArray(eventTypesRaw) ? eventTypesRaw.filter((x) => typeof x === "string") : [];

      if (!name) {
        reply.code(400);
        return { message: "name is required" };
      }
      try {
        // eslint-disable-next-line no-new
        new URL(url);
      } catch {
        reply.code(400);
        return { message: "url must be a valid URL" };
      }
      if (!eventTypes.length) {
        reply.code(400);
        return { message: "eventTypes must be a non-empty array of strings" };
      }

      const created = await svc.create({ name, url, enabled, eventTypes });
      reply.code(201);
      return created;
    }
  );

  app.patch(
    "/v1/admin/webhooks/:id",
    {
      bodyLimit: BODY_LIMITS.jsonSmall,
      schema: {
        summary: "Update webhook",
        tags: ["admin"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            url: { type: "string" },
            enabled: { type: "boolean" },
            eventTypes: { type: "array", items: { type: "string" } }
          }
        },
        response: { 200: { type: "object", additionalProperties: true }, 404: { type: "object" } }
      }
    },
    async (request, reply) => {
      if (!requireSession(request, reply)) return;
      const svc = opts.deps.webhookService;
      if (!svc) {
        reply.code(503);
        return { message: "Webhook service not available" };
      }
      const { id } = request.params as { id: string };
      const body = request.body as { name?: string; url?: string; enabled?: boolean; eventTypes?: unknown } | undefined;
      const patch: any = {};
      if (body?.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) {
          reply.code(400);
          return { message: "name cannot be empty" };
        }
        patch.name = name;
      }
      if (body?.url !== undefined) {
        const url = String(body.url).trim();
        try {
          // eslint-disable-next-line no-new
          new URL(url);
        } catch {
          reply.code(400);
          return { message: "url must be a valid URL" };
        }
        patch.url = url;
      }
      if (body?.enabled !== undefined) patch.enabled = Boolean(body.enabled);
      if (body?.eventTypes !== undefined) {
        const eventTypesRaw = body.eventTypes;
        const eventTypes = Array.isArray(eventTypesRaw) ? eventTypesRaw.filter((x) => typeof x === "string") : [];
        if (!eventTypes.length) {
          reply.code(400);
          return { message: "eventTypes must be a non-empty array of strings" };
        }
        patch.eventTypes = eventTypes;
      }
      const updated = await svc.update(id, patch);
      if (!updated) {
        reply.code(404);
        return { message: "Not found" };
      }
      return updated;
    }
  );

  app.delete(
    "/v1/admin/webhooks/:id",
    {
      schema: {
        summary: "Delete webhook",
        tags: ["admin"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        response: { 204: { type: "null" }, 404: { type: "object" } }
      }
    },
    async (request, reply) => {
      if (!requireSession(request, reply)) return;
      const svc = opts.deps.webhookService;
      if (!svc) {
        reply.code(503);
        return { message: "Webhook service not available" };
      }
      const { id } = request.params as { id: string };
      const ok = await svc.delete(id);
      if (!ok) {
        reply.code(404);
        return { message: "Not found" };
      }
      reply.code(204);
      return;
    }
  );

  app.post(
    "/v1/admin/api-keys",
    {
      bodyLimit: BODY_LIMITS.jsonSmall,
      schema: {
        summary: "Create API key",
        tags: ["admin"],
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            expiresAt: { type: ["string", "null"] }
          }
        }
      }
    },
    async (request, reply) => {
      if (!requireSession(request, reply)) return;
      const body = request.body as { name?: string; expiresAt?: string | null } | undefined;
      const name = (body?.name ?? "").trim();
      if (!name) {
        reply.code(400);
        return { message: "name is required" };
      }
      const created = await opts.deps.apiKeyService!.create({ name, expiresAt: body?.expiresAt ?? null });
      await opts.deps.activityService
        ?.logEvent({
          type: "apikey.created",
          entityType: "apiKey",
          entityId: created.record.id,
          message: "API key created",
          meta: { name: created.record.name }
        })
        .catch(() => undefined);
      reply.code(201);
      return { ...created.record, apiKey: created.apiKey };
    }
  );

  app.get(
    "/v1/admin/api-keys",
    {
      schema: {
        summary: "List API keys",
        tags: ["admin"],
        response: { 200: { type: "array", items: { type: "object", additionalProperties: true } } }
      }
    },
    async (request, reply) => {
      if (!requireSession(request, reply)) return;
      return opts.deps.apiKeyService!.list();
    }
  );

  app.post(
    "/v1/admin/api-keys/:id/revoke",
    {
      schema: {
        summary: "Revoke API key",
        tags: ["admin"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } }
      }
    },
    async (request, reply) => {
      if (!requireSession(request, reply)) return;
      const { id } = request.params as { id: string };
      const updated = await opts.deps.apiKeyService!.revoke(id);
      if (!updated) {
        reply.code(404);
        return { message: "Not found" };
      }
      await opts.deps.activityService
        ?.logEvent({
          type: "apikey.revoked",
          entityType: "apiKey",
          entityId: updated.id,
          message: "API key revoked",
          meta: { name: updated.name }
        })
        .catch(() => undefined);
      return updated;
    }
  );

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
          "Creates a VM snapshot (Firecracker mem+state) plus a disk baseline clone so that /workspace content (SDK uploads) is preserved for later restores.",
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
          "Creates and boots a new microVM. If snapshotId is provided, the VM is restored from that snapshot (including the /workspace disk baseline).",
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
                    snapshotId: { type: "string" },
                    imageId: { type: "string" },
                    diskSizeMb: { type: "number" }
                  }
                },
                examples: {
                  boot: { value: { cpu: 1, memMb: 256, allowIps: ["172.16.0.1/32"], outboundInternet: true, diskSizeMb: 512 } },
                  withImage: {
                    value: { cpu: 1, memMb: 256, allowIps: ["172.16.0.1/32"], outboundInternet: true, imageId: "img-<uuid>", diskSizeMb: 512 }
                  },
                  fromSnapshot: {
                    value: { cpu: 1, memMb: 256, allowIps: ["172.16.0.1/32"], outboundInternet: true, snapshotId: "snap-<uuid>", diskSizeMb: 512 }
                  }
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
            snapshotId: { type: "string", description: "Optional snapshot id created via POST /v1/vms/:id/snapshots" },
            imageId: { type: "string", description: "Optional guest image id (defaults to the configured default image)" },
            diskSizeMb: { type: "number", description: "Optional disk size (MiB). Must be >= base rootfs size." }
          },
          examples: [
            { cpu: 1, memMb: 256, allowIps: ["172.16.0.1/32"], outboundInternet: true, diskSizeMb: 512 },
            { cpu: 1, memMb: 256, allowIps: ["172.16.0.1/32"], outboundInternet: true, imageId: "img-<uuid>", diskSizeMb: 512 },
            { cpu: 1, memMb: 256, allowIps: ["172.16.0.1/32"], outboundInternet: true, snapshotId: "snap-<uuid>", diskSizeMb: 512 }
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
        | {
            cpu?: number;
            memMb?: number;
            allowIps?: string[];
            outboundInternet?: boolean;
            snapshotId?: string;
            imageId?: string;
            diskSizeMb?: number;
          }
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
        snapshotId: body.snapshotId,
        imageId: body.imageId,
        diskSizeMb: body.diskSizeMb
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
        description: "Executes a shell command inside the VM as uid/gid 1000, confined to /workspace.",
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
                  withTimeout: { value: { cmd: "ls -la /workspace", timeoutMs: 30000 } }
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
            cwd: { type: "string", description: "Working directory (defaults to /workspace)" },
            env: { type: "object", additionalProperties: { type: "string" }, description: "Environment variables" },
            timeoutMs: { type: "number", description: "Timeout in milliseconds" }
          },
          examples: [{ cmd: "echo hello" }, { cmd: "ls -la /workspace", timeoutMs: 30000 }]
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
          "Runs TypeScript inside the VM using Deno with strict /workspace read/write permissions. Provide either inline code or a file path.",
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
                  file: { value: { path: "/workspace/app/main.ts" } }
                }
              }
            }
          }
        },
        body: {
          type: "object",
          anyOf: [{ required: ["code"] }, { required: ["path"] }],
          properties: {
            path: { type: "string", description: "Path to a .ts file inside /workspace" },
            code: { type: "string", description: "Inline TypeScript code" },
            args: { type: "array", items: { type: "string" }, description: "Arguments passed to the program" },
            denoFlags: { type: "array", items: { type: "string" }, description: "Additional Deno flags (advanced)" },
            timeoutMs: { type: "number", description: "Timeout in milliseconds" }
          },
          examples: [{ code: "console.log(2 + 2)" }, { path: "/workspace/app/main.ts" }]
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
          "Uploads a tar.gz archive into the VM under the provided dest directory. Dest must be confined to /workspace. Symlinks and path traversal are rejected.",
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
        response: {
          204: { type: "null" },
          400: { type: "object", properties: { message: { type: "string" } }, additionalProperties: true },
          413: { type: "object", properties: { message: { type: "string" } }, additionalProperties: true }
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const dest = (request.query as { dest?: string }).dest ?? "";
      if (!dest) {
        reply.code(400);
        return { message: "dest is required" };
      }
      const bodyStream = request.body as any;
      let body: Buffer;
      try {
        body = await readStreamToBuffer(bodyStream, BODY_LIMITS.uploadCompressed);
      } catch (err: any) {
        if (err instanceof BodyTooLargeError || String(err?.message ?? err).includes("Body too large")) {
          reply.code(413);
          return { message: "Body too large" };
        }
        throw err;
      }
      try {
        await opts.deps.vmService.uploadFiles(id, dest, body);
        reply.code(204);
        return;
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (msg.includes("status=400")) {
          reply.code(400);
          // Surface guest-agent details when available (helps debugging invalid archives).
          return { message: msg };
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
        description: "Downloads a directory tree as a tar.gz archive. Path must be confined to /workspace.",
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
      request.log.info({ vmId: id, path }, "files.download requested");
      try {
        const data = await opts.deps.vmService.downloadFiles(id, path);
        reply.header("content-type", "application/gzip");
        request.log.info({ vmId: id, bytes: data.length }, "files.download responding");
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
