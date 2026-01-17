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
}

export class VsockAgentClient implements AgentClient {
  private checkedVsockDevice = false;
  private vsockDeviceAvailable = false;

  constructor(private readonly options: VsockAgentOptions) {}

  async health(vmId: string): Promise<void> {
    await this.request(vmId, "GET", "/health");
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
    return this.request(vmId, "POST", "/exec", payload);
  }

  async runTs(vmId: string, payload: VmRunTsRequest): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return this.request(vmId, "POST", "/run-ts", payload);
  }

  async upload(vmId: string, dest: string, data: Buffer): Promise<void> {
    await this.requestBinary(vmId, "POST", `/files/upload?dest=${encodeURIComponent(dest)}`, data);
  }

  async download(vmId: string, path: string): Promise<Buffer> {
    return this.requestBinary(vmId, "GET", `/files/download?path=${encodeURIComponent(path)}`);
  }

  private async request<T>(vmId: string, method: string, pathName: string, body?: T): Promise<any> {
    await this.ensureVsockDevice();
    const response = await this.execVsockUdsWithRetry(vmId, buildJsonRequest(method, pathName, body));
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
    const response = await this.execVsockUdsWithRetry(vmId, buildBinaryRequest(method, pathName, body));
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
    requestPayload: Buffer
  ): Promise<{ stdout: Buffer; stderr: Buffer; exitCode: number | null }> {
    const attempts = 150;
    const delayMs = 200;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const response = await execVsockUdsRaw(
        { udsPath: this.vsockUdsPath(vmId), agentPort: this.options.agentPort, timeoutMs: 15000 },
        requestPayload
      );
      if (!shouldRetryVsock(attempt, attempts, response.stdout, response.stderr, response.exitCode)) {
        return response;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return execVsockUdsRaw({ udsPath: this.vsockUdsPath(vmId), agentPort: this.options.agentPort, timeoutMs: 15000 }, requestPayload);
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
    const dir = this.options.vsockUdsDir ?? "/run/fc";
    return path.join(dir, `${vmId}.vsock`);
  }
}
