import fs from "node:fs/promises";
import path from "node:path";
import type { AgentClient } from "../types/interfaces.js";
import type { VmExecRequest, VmRunTsRequest } from "../types/vm.js";
import { buildBinaryRequest, buildJsonRequest } from "./httpRequest.js";
import { parseHttpResponse } from "./httpResponse.js";
import { shouldRetryVsock } from "./retryPolicy.js";
import { execVsockUdsRaw } from "./vsockTransport.js";

export interface VsockAgentOptions {
  agentPort: number;
  vsockUdsDir?: string;
  vsockUdsPathForVm?: (vmId: string) => string;
  retry?: { attempts: number; delayMs: number };
  limits?: { maxJsonResponseBytes: number; maxBinaryResponseBytes: number };
  timeouts?: { defaultMs: number; healthMs: number; binaryMs: number };
}

export class VsockAgentClient implements AgentClient {
  private checkedVsockDevice = false;
  private vsockDeviceAvailable = false;

  constructor(private readonly options: VsockAgentOptions) {}

  async health(vmId: string): Promise<void> {
    await this.request(vmId, "GET", "/health", undefined, { timeoutMs: this.options.timeouts?.healthMs });
  }

  async applyAllowlist(vmId: string, allowIps: string[], outboundInternet: boolean): Promise<void> {
    await this.request(vmId, "POST", "/firewall/allowlist", { allowIps, outboundInternet });
  }

  async configureNetwork(
    vmId: string,
    payload: { ip: string; gateway: string; cidr?: number; mac?: string; iface?: string }
  ): Promise<void> {
    await this.request(vmId, "POST", "/net/config", payload);
  }

  async exec(vmId: string, payload: VmExecRequest): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined;
    return this.request(vmId, "POST", "/exec", payload, { timeoutMs });
  }

  async runTs(vmId: string, payload: VmRunTsRequest): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined;
    return this.request(vmId, "POST", "/run-ts", payload, { timeoutMs });
  }

  async upload(vmId: string, dest: string, data: Buffer): Promise<void> {
    await this.requestBinary(vmId, "POST", `/files/upload?dest=${encodeURIComponent(dest)}`, data);
  }

  async download(vmId: string, path: string): Promise<Buffer> {
    return this.requestBinary(vmId, "GET", `/files/download?path=${encodeURIComponent(path)}`);
  }

  private async request<T>(
    vmId: string,
    method: string,
    pathName: string,
    body?: T,
    opts?: { timeoutMs?: number }
  ): Promise<any> {
    await this.ensureVsockDevice();
    const maxBytes = this.options.limits?.maxJsonResponseBytes ?? 2_000_000;
    const response = await this.execVsockUdsWithRetry(vmId, buildJsonRequest(method, pathName, body), {
      timeoutMs: this.computeTimeoutMs(opts?.timeoutMs),
      maxResponseBytes: maxBytes
    });
    const parsed = parseHttpResponse(response.stdout);
    const { statusCode, body: responseBody, headers } = parsed;

    if (!statusCode) {
      console.warn("Empty agent response body", {
        vmId,
        method,
        path: pathName,
        headers,
        exitCode: response.exitCode,
        stderr: response.stderr.toString("utf-8", 0, Math.min(response.stderr.length, 512)),
        rawPreview: response.stdout.toString("utf-8", 0, Math.min(response.stdout.length, 512))
      });
      throw new Error(`Agent request returned no HTTP response (${method} ${pathName})`);
    }

    // Fastify returns 204 for allowlist; treat as success.
    if (statusCode === 204) {
      return {};
    }

    if (statusCode < 200 || statusCode >= 300) {
      const errText = responseBody.toString("utf-8", 0, Math.min(responseBody.length, 2048));
      throw new Error(`Agent request failed (${method} ${pathName}) status=${statusCode}: ${errText}`);
    }

    const text = responseBody.toString("utf-8");
    try {
      return JSON.parse(text);
    } catch (error) {
      console.warn("Failed to parse agent JSON response", {
        vmId,
        method,
        path: pathName,
        headers,
        exitCode: response.exitCode,
        stderr: response.stderr.toString("utf-8", 0, Math.min(response.stderr.length, 512)),
        rawPreview: response.stdout.toString("utf-8", 0, Math.min(response.stdout.length, 512))
      });
      throw error;
    }
  }

  private async requestBinary(vmId: string, method: string, pathName: string, body?: Buffer): Promise<Buffer> {
    await this.ensureVsockDevice();
    const maxBytes = this.options.limits?.maxBinaryResponseBytes ?? 50_000_000;
    const response = await this.execVsockUdsWithRetry(vmId, buildBinaryRequest(method, pathName, body), {
      timeoutMs: this.options.timeouts?.binaryMs ?? this.options.timeouts?.defaultMs,
      maxResponseBytes: maxBytes
    });
    const { statusCode, body: responseBody } = parseHttpResponse(response.stdout);
    if (!statusCode) {
      throw new Error(`Agent request returned no HTTP response (${method} ${pathName})`);
    }
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`Agent request failed (${method} ${pathName}) status=${statusCode}`);
    }
    return responseBody;
  }

  private async execVsockUdsWithRetry(
    vmId: string,
    requestPayload: Buffer,
    opts?: { timeoutMs?: number; maxResponseBytes?: number }
  ): Promise<{ stdout: Buffer; stderr: Buffer; exitCode: number | null }> {
    const attempts = this.options.retry?.attempts ?? 150;
    const delayMs = this.options.retry?.delayMs ?? 200;
    const timeoutMs = opts?.timeoutMs ?? this.options.timeouts?.defaultMs ?? 15000;
    const maxResponseBytes = opts?.maxResponseBytes;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const response = await execVsockUdsRaw(
        { udsPath: this.vsockUdsPath(vmId), agentPort: this.options.agentPort, timeoutMs, maxResponseBytes },
        requestPayload
      );
      if (!shouldRetryVsock(attempt, attempts, response.stdout, response.stderr, response.exitCode)) {
        return response;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return execVsockUdsRaw(
      { udsPath: this.vsockUdsPath(vmId), agentPort: this.options.agentPort, timeoutMs, maxResponseBytes },
      requestPayload
    );
  }

  private computeTimeoutMs(requestTimeoutMs?: number): number {
    // For long-running exec/run-ts, the agent won't respond until the command completes.
    // So we must allow a timeout >= requested timeout (+ small overhead).
    const base = this.options.timeouts?.defaultMs ?? 15000;
    if (typeof requestTimeoutMs !== "number" || !Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      return base;
    }
    const overheadMs = 5_000;
    return Math.max(base, Math.min(requestTimeoutMs + overheadMs, 5 * 60_000));
  }

  private async ensureVsockDevice(): Promise<void> {
    if (this.checkedVsockDevice) {
      if (!this.vsockDeviceAvailable) {
        throw new Error("vhost-vsock device not available at /dev/vhost-vsock");
      }
      return;
    }
    this.checkedVsockDevice = true;
    try {
      await fs.stat("/dev/vhost-vsock");
      this.vsockDeviceAvailable = true;
    } catch {
      this.vsockDeviceAvailable = false;
      throw new Error("vhost-vsock device not available at /dev/vhost-vsock");
    }
  }

  private vsockUdsPath(vmId: string): string {
    if (typeof this.options.vsockUdsPathForVm === "function") {
      return this.options.vsockUdsPathForVm(vmId);
    }
    const dir = this.options.vsockUdsDir ?? "/run/fc";
    return path.join(dir, `${vmId}.vsock`);
  }
}
