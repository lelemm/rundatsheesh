import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { HttpError } from "../../api/httpErrors.js";
import type { AgentClient, VmPeerLinkStore, VmStore } from "../../types/interfaces.js";
import type { VmCreateRequest, VmPeerLink, VmPeerSourceMode, VmPublic, VmRecord } from "../../types/vm.js";

const execFileAsync = promisify(execFile);
const SUPPORTED_TS_EXTS = new Set([".ts", ".mts", ".tsx"]);
const SUPPORTED_JS_EXTS = new Set([".js", ".mjs", ".cjs", ".jsx"]);
const MAX_REMOTE_TIMEOUT_MS = 120_000;
const MANAGER_GATEWAY_IP = "172.16.0.1";
const PROVIDER_MANIFEST_PATH = ".rds-peer/manifest.json";

export interface PeerInvokeRequest {
  alias: string;
  modulePath: string;
  exportName?: string;
  args?: unknown[];
  timeoutMs?: number;
}

interface PeerSdkManifest {
  sdk: {
    name: string;
    description: string;
  };
  modules: PeerManifestModule[];
}

interface PeerManifestModule {
  path: string;
  description?: string;
  exports: PeerManifestExport[];
}

interface PeerManifestExport {
  name: string;
  description: string;
  params: PeerManifestParam[];
  returns: PeerManifestReturn;
  examples: PeerManifestExample[];
}

interface PeerManifestParam {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

interface PeerManifestReturn {
  description: string;
  schema: Record<string, unknown>;
}

interface PeerManifestExample {
  description: string;
  code: string;
}

interface PeerIndexEntry {
  alias: string;
  sdkName: string;
  summary: string;
  manifestPath: string;
  readmePath: string;
  proxyRoot: string;
  sourceMode: VmPeerSourceMode;
}

interface NormalizedPeerLink extends VmPeerLink {
  sourceMode: VmPeerSourceMode;
}

export class PeerService {
  private readonly secretKey?: Buffer;
  private readonly managerInternalBaseUrl: string;

  constructor(
    private readonly deps: {
      store: VmStore;
      peerLinks: VmPeerLinkStore;
      agentClient: AgentClient;
      vmSecretKey?: string;
      managerInternalBaseUrl?: string;
    }
  ) {
    this.secretKey = deps.vmSecretKey ? createHash("sha256").update(deps.vmSecretKey).digest() : undefined;
    this.managerInternalBaseUrl = deps.managerInternalBaseUrl ?? `http://${MANAGER_GATEWAY_IP}:3000`;
  }

  async validateCreateRequest(request: VmCreateRequest): Promise<void> {
    if (request.secretEnv?.length) {
      this.requireSecretKey();
      parseEnvArray(request.secretEnv);
    }
    const links = request.peerLinks ?? [];
    const seenAliases = new Set<string>();
    for (const rawLink of links) {
      const link = normalizePeerLink(rawLink);
      assertValidAlias(link.alias);
      if (!link.vmId || typeof link.vmId !== "string") {
        throw new HttpError(400, "Invalid peerLinks vmId");
      }
      if (seenAliases.has(link.alias)) {
        throw new HttpError(400, "peerLinks aliases must be unique");
      }
      seenAliases.add(link.alias);
      const provider = await this.deps.store.get(link.vmId);
      if (!provider || provider.state === "DELETED") {
        throw new HttpError(400, `peerLinks target not found: ${link.vmId}`);
      }
    }
  }

  async buildCreatePatch(request: VmCreateRequest, vmId: string): Promise<Pick<VmRecord, "secretEnvCiphertext">> {
    const peerLinks = (request.peerLinks ?? []).map(normalizePeerLink);
    if (peerLinks.some((link) => link.vmId === vmId)) {
      throw new HttpError(400, "peerLinks cannot self-reference");
    }
    const secretEnvCiphertext = request.secretEnv?.length ? this.encryptEnv(request.secretEnv) : undefined;
    return { secretEnvCiphertext };
  }

  async persistPeerLinks(vmId: string, peerLinks: VmPeerLink[] | undefined): Promise<void> {
    await this.deps.peerLinks.replaceForConsumer(vmId, (peerLinks ?? []).map(normalizePeerLink));
  }

  async listPeerLinks(vmId: string): Promise<VmPeerLink[]> {
    return this.deps.peerLinks.listForConsumer(vmId);
  }

  async hasPeerLinks(vmId: string): Promise<boolean> {
    return (await this.listPeerLinks(vmId)).length > 0;
  }

  async decorateVmPublic(vm: VmPublic): Promise<VmPublic> {
    return {
      ...vm,
      peerLinks: await this.listPeerLinks(vm.id)
    };
  }

  async updatePeerSourceMode(vmId: string, alias: string, sourceMode: VmPeerSourceMode): Promise<void> {
    assertValidAlias(alias);
    const changed = await this.deps.peerLinks.updateSourceMode(vmId, alias, normalizeSourceMode(sourceMode));
    if (!changed) {
      throw new HttpError(404, `Peer alias ${alias} not found for VM ${vmId}`);
    }
  }

  async mergeExecEnv(vm: VmRecord, input?: Record<string, string>): Promise<Record<string, string> | undefined> {
    const secretEnv = await this.getSecretEnvMap(vm);
    const merged = { ...(input ?? {}), ...secretEnv };
    return Object.keys(merged).length ? merged : undefined;
  }

  async mergeEnvList(vm: VmRecord, input?: string[]): Promise<string[] | undefined> {
    const merged = {
      ...parseEnvArray(input),
      ...(await this.getSecretEnvMap(vm))
    };
    const entries = Object.entries(merged).map(([key, value]) => `${key}=${value}`);
    return entries.length ? entries : undefined;
  }

  async onVmRunning(vmId: string): Promise<void> {
    const vm = await this.requireVm(vmId);
    const links = await this.listPeerLinks(vmId);
    if (links.length === 0) {
      await this.deps.store.update(vmId, { bridgeTokenHash: undefined });
      await this.syncPeerFilesystem(vm.id);
      return;
    }

    const token = randomBytes(24).toString("base64url");
    await this.deps.store.update(vmId, { bridgeTokenHash: this.hashToken(token) });
    await this.materializeBridgeRuntime(vmId, token);
    await this.syncPeerFilesystem(vmId);
    await this.requireVm(vm.id);
  }

  async clearBridgeToken(vmId: string): Promise<void> {
    await this.deps.store.update(vmId, { bridgeTokenHash: undefined });
  }

  async deleteConsumerMetadata(vmId: string): Promise<void> {
    await this.clearBridgeToken(vmId);
    await this.deps.peerLinks.deleteForConsumer(vmId);
  }

  async syncPeerFilesystem(vmId: string): Promise<void> {
    const consumer = await this.requireRunningVm(vmId);
    const links = await this.listPeerLinks(vmId);

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rds-peer-sync-"));
    const peersRoot = path.join(tempRoot, "peers");
    await fs.mkdir(peersRoot, { recursive: true });

    try {
      const indexEntries: PeerIndexEntry[] = [];

      for (const rawLink of links) {
        const link = normalizePeerLink(rawLink);
        try {
          const provider = await this.requireRunningVm(link.vmId);
          const providerWorkspace = await this.deps.agentClient.download(provider.id, "/workspace");
          const providerRoot = path.join(tempRoot, `provider-${link.alias}`);
          await fs.mkdir(providerRoot, { recursive: true });
          await extractTarGzToDir(providerWorkspace, providerRoot);
          await sanitizeMirroredWorkspace(providerRoot);

          const manifest = await this.loadValidatedManifest(provider, link.alias, providerRoot);
          const aliasRoot = path.join(peersRoot, link.alias);
          const proxyRoot = path.join(aliasRoot, "proxy");
          await fs.mkdir(proxyRoot, { recursive: true });
          await fs.writeFile(path.join(aliasRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
          await fs.writeFile(path.join(aliasRoot, "README.md"), buildPeerReadme(link.alias, link.sourceMode, manifest), "utf-8");
          await this.generateProxyTree(link.alias, manifest, proxyRoot);

          if (link.sourceMode === "mounted") {
            const sourceRoot = path.join(aliasRoot, "source");
            await fs.cp(providerRoot, sourceRoot, { recursive: true });
          }

          indexEntries.push({
            alias: link.alias,
            sdkName: manifest.sdk.name,
            summary: manifest.sdk.description,
            manifestPath: `/workspace/peers/${link.alias}/manifest.json`,
            readmePath: `/workspace/peers/${link.alias}/README.md`,
            proxyRoot: `/workspace/peers/${link.alias}/proxy`,
            sourceMode: link.sourceMode
          });
        } catch (error) {
          throw wrapPeerAliasError(link.alias, error);
        }
      }

      await fs.writeFile(path.join(peersRoot, "index.json"), JSON.stringify({ peers: indexEntries }, null, 2) + "\n", "utf-8");
      const tar = await createTarGzFromDir(peersRoot);
      await this.deps.agentClient.replaceTree(consumer.id, "/workspace/peers", tar, { ownership: "root", readOnly: true });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async invokeWithBridgeToken(token: string, request: PeerInvokeRequest): Promise<unknown> {
    const consumer = await this.findConsumerVmByToken(token);
    if (!consumer) {
      throw new HttpError(401, "Invalid bridge token");
    }

    const alias = String(request.alias ?? "").trim();
    if (!alias) {
      throw new HttpError(400, "alias is required");
    }
    const link = await this.deps.peerLinks.getForConsumerAlias(consumer.id, alias);
    if (!link) {
      throw new HttpError(403, `VM ${consumer.id} is not linked to alias ${alias}`);
    }
    const provider = await this.requireRunningVm(link.vmId);
    const modulePath = normalizeWorkspaceModulePath(request.modulePath);
    const exportName = normalizeExportName(request.exportName);
    const args = Array.isArray(request.args) ? request.args : [];
    const timeoutMs = clampTimeout(request.timeoutMs);
    return this.invokeProvider(provider, { modulePath, exportName, args, timeoutMs });
  }

  private async materializeBridgeRuntime(vmId: string, token: string): Promise<void> {
    const config = JSON.stringify(
      {
        baseUrl: this.managerInternalBaseUrl,
        token
      },
      null,
      2
    );

    const runtimeFiles = new Map<string, string>([
      ["peer-bridge.json", config],
      ["peer-runtime.ts", buildTsPeerRuntime()],
      ["peer-runtime.mjs", buildMjsPeerRuntime()],
      ["peer-runtime.cjs", buildCjsPeerRuntime()]
    ]);
    const tar = await createTarGzFromFiles(runtimeFiles);
    await this.deps.agentClient.replaceTree(vmId, "/workspace/.rds", tar, { ownership: "root", readOnly: true });
  }

  private async loadValidatedManifest(provider: VmRecord, alias: string, providerRoot: string): Promise<PeerSdkManifest> {
    const manifestPath = path.join(providerRoot, PROVIDER_MANIFEST_PATH);
    const manifestText = await fs.readFile(manifestPath, "utf-8").catch(() => {
      throw new HttpError(400, `missing provider manifest at /workspace/${PROVIDER_MANIFEST_PATH}`);
    });
    const parsed = parsePeerManifest(manifestText);

    const modules: PeerManifestModule[] = [];
    for (const moduleDef of parsed.modules) {
      const modulePath = normalizeProviderModulePath(moduleDef.path);
      const workspaceModulePath = `/workspace/${modulePath}`;
      const localModulePath = path.join(providerRoot, modulePath);
      const stat = await fs.stat(localModulePath).catch(() => null);
      if (!stat?.isFile()) {
        throw new HttpError(400, `declared module not found: ${workspaceModulePath}`);
      }

      const callableExports = new Set(await this.discoverCallableExports(provider, workspaceModulePath));
      if (moduleDef.exports.length === 0) {
        throw new HttpError(400, `module ${workspaceModulePath} must declare at least one export`);
      }

      const exports: PeerManifestExport[] = [];
      for (const exportDef of moduleDef.exports) {
        const exportName = normalizeManifestExportName(exportDef.name);
        if (!callableExports.has(exportName)) {
          throw new HttpError(400, `declared export ${exportName} is not callable in ${workspaceModulePath}`);
        }
        exports.push({
          name: exportName,
          description: normalizeRequiredString(exportDef.description, "export description"),
          params: normalizeManifestParams(exportDef.params),
          returns: normalizeManifestReturn(exportDef.returns),
          examples: normalizeManifestExamples(exportDef.examples)
        });
      }

      modules.push({
        path: modulePath,
        description: normalizeOptionalString(moduleDef.description),
        exports
      });
    }

    return {
      sdk: {
        name: parsed.sdk.name,
        description: parsed.sdk.description
      },
      modules
    };
  }

  private async generateProxyTree(alias: string, manifest: PeerSdkManifest, proxyRoot: string): Promise<void> {
    for (const moduleDef of manifest.modules) {
      const proxyPath = path.join(proxyRoot, moduleDef.path);
      await fs.mkdir(path.dirname(proxyPath), { recursive: true });
      await fs.writeFile(proxyPath, buildProxyModuleSource(alias, moduleDef), "utf-8");
    }
  }

  private async discoverCallableExports(provider: VmRecord, modulePath: string): Promise<string[]> {
    const ext = path.extname(modulePath).toLowerCase();
    const code = [
      `const mod = await import(${JSON.stringify(`file://${modulePath}`)});`,
      `const callable = [];`,
      `for (const [name, value] of Object.entries(mod)) {`,
      `  if (typeof value === "function") callable.push(name);`,
      `}`,
      `result.set({ exports: Array.from(new Set(callable)).sort() });`
    ].join("\n");

    const res = SUPPORTED_TS_EXTS.has(ext)
      ? await this.deps.agentClient.runTs(provider.id, {
          code,
          env: await this.mergeEnvList(provider),
          allowNet: provider.outboundInternet,
          timeoutMs: 20_000
        })
      : await this.deps.agentClient.runJs(provider.id, {
          code,
          env: await this.mergeEnvList(provider),
          timeoutMs: 20_000
        });

    if (res.exitCode !== 0) {
      const detail = String(res.stderr || (res.error as any)?.message || `failed to inspect ${modulePath}`).slice(0, 500);
      throw new HttpError(400, `unable to inspect ${modulePath}: ${detail}`);
    }
    const exports = (res.result as any)?.exports;
    if (!Array.isArray(exports)) {
      throw new HttpError(400, `module inspection did not return callable exports for ${modulePath}`);
    }
    return exports.filter((value): value is string => {
      if (typeof value !== "string" || value.length === 0) return false;
      if (value === "default") return true;
      return /^[$A-Z_a-z][$\w]*$/i.test(value);
    });
  }

  private async invokeProvider(
    provider: VmRecord,
    input: { modulePath: string; exportName: string; args: unknown[]; timeoutMs: number }
  ): Promise<unknown> {
    const ext = path.extname(input.modulePath).toLowerCase();
    const code = [
      `const mod = await import(${JSON.stringify(`file://${input.modulePath}`)});`,
      `const fn = ${JSON.stringify(input.exportName)} === "default" ? mod.default : mod[${JSON.stringify(input.exportName)}];`,
      `if (typeof fn !== "function") {`,
      `  result.error({ name: "RemoteExportError", message: "Export is not callable", exportName: ${JSON.stringify(input.exportName)} });`,
      `  ${SUPPORTED_TS_EXTS.has(ext) ? "Deno.exit(2);" : "process.exit(2);"}`,
      `}`,
      `const value = await fn(...${JSON.stringify(input.args)});`,
      `result.set(value);`
    ].join("\n");

    const res = SUPPORTED_TS_EXTS.has(ext)
      ? await this.deps.agentClient.runTs(provider.id, {
          code,
          env: await this.mergeEnvList(provider),
          allowNet: provider.outboundInternet,
          timeoutMs: input.timeoutMs
        })
      : await this.deps.agentClient.runJs(provider.id, {
          code,
          env: await this.mergeEnvList(provider),
          timeoutMs: input.timeoutMs
        });

    if (res.exitCode !== 0) {
      const detail = String(res.stderr || (res.error as any)?.message || "remote invocation failed").slice(0, 500);
      throw new HttpError(502, detail);
    }
    return res.result;
  }

  private async findConsumerVmByToken(token: string): Promise<VmRecord | null> {
    const expected = this.hashToken(token);
    const vms = await this.deps.store.list();
    return vms.find((vm) => vm.state !== "DELETED" && vm.bridgeTokenHash === expected) ?? null;
  }

  private async getSecretEnvMap(vm: VmRecord): Promise<Record<string, string>> {
    if (!vm.secretEnvCiphertext) return {};
    return parseEnvArray(this.decryptEnv(vm.secretEnvCiphertext));
  }

  private requireSecretKey(): Buffer {
    if (!this.secretKey) {
      throw new HttpError(500, "VM_SECRET_KEY is required for peer secret env support");
    }
    return this.secretKey;
  }

  private encryptEnv(env: string[]): string {
    const key = this.requireSecretKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const plaintext = Buffer.from(JSON.stringify(env), "utf-8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return JSON.stringify({
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      data: ciphertext.toString("base64")
    });
  }

  private decryptEnv(ciphertext: string): string[] {
    const key = this.requireSecretKey();
    const parsed = JSON.parse(ciphertext) as { iv?: string; tag?: string; data?: string };
    if (!parsed?.iv || !parsed?.tag || !parsed?.data) {
      throw new HttpError(500, "Invalid secret env payload");
    }
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(parsed.data, "base64")), decipher.final()]).toString("utf-8");
    const env = JSON.parse(plaintext);
    if (!Array.isArray(env)) {
      throw new HttpError(500, "Invalid decrypted secret env");
    }
    return env.filter((entry): entry is string => typeof entry === "string");
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private async requireVm(vmId: string): Promise<VmRecord> {
    const vm = await this.deps.store.get(vmId);
    if (!vm || vm.state === "DELETED") {
      throw new HttpError(404, `VM ${vmId} not found`);
    }
    return vm;
  }

  private async requireRunningVm(vmId: string): Promise<VmRecord> {
    const vm = await this.requireVm(vmId);
    if (vm.state !== "RUNNING") {
      throw new HttpError(409, `VM ${vmId} must be RUNNING (state=${vm.state})`);
    }
    return vm;
  }
}

export function parseEnvArray(env?: string[]): Record<string, string> {
  if (!env) return {};
  if (!Array.isArray(env)) {
    throw new HttpError(400, "env must be an array of strings in the format KEY=value");
  }
  const out: Record<string, string> = {};
  for (const entry of env) {
    if (typeof entry !== "string") {
      throw new HttpError(400, "env entries must be strings in the format KEY=value");
    }
    const idx = entry.indexOf("=");
    if (idx <= 0) {
      throw new HttpError(400, `Invalid env entry (expected KEY=value): ${entry}`);
    }
    const key = entry.slice(0, idx);
    const value = entry.slice(idx + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new HttpError(400, `Invalid env var name: ${key}`);
    }
    out[key] = value;
  }
  return out;
}

function normalizeWorkspaceModulePath(modulePath: string | undefined): string {
  const raw = String(modulePath ?? "").trim();
  if (!raw.startsWith("/workspace/")) {
    throw new HttpError(400, "modulePath must stay under /workspace");
  }
  const normalized = path.posix.normalize(raw);
  if (!normalized.startsWith("/workspace/")) {
    throw new HttpError(400, "modulePath escapes /workspace");
  }
  return normalized;
}

function normalizeProviderModulePath(modulePath: string): string {
  const raw = String(modulePath ?? "").trim();
  if (!raw || raw.startsWith("/")) {
    throw new HttpError(400, "module path must be relative to /workspace");
  }
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === "." || normalized.startsWith("../")) {
    throw new HttpError(400, `module path escapes /workspace: ${raw}`);
  }
  const ext = path.extname(normalized).toLowerCase();
  if (!SUPPORTED_TS_EXTS.has(ext) && !SUPPORTED_JS_EXTS.has(ext)) {
    throw new HttpError(400, `module path must point to a JS/TS module: ${raw}`);
  }
  return normalized;
}

function normalizeExportName(exportName: string | undefined): string {
  const value = String(exportName ?? "default").trim();
  if (!value) return "default";
  if (!/^[A-Za-z0-9_$]+$/.test(value)) {
    throw new HttpError(400, "Invalid exportName");
  }
  return value;
}

function normalizeManifestExportName(exportName: string): string {
  const value = normalizeRequiredString(exportName, "export name");
  if (value === "default") return value;
  if (!/^[$A-Z_a-z][$\w]*$/i.test(value)) {
    throw new HttpError(400, `Invalid manifest export name: ${value}`);
  }
  return value;
}

function normalizeManifestParams(value: unknown): PeerManifestParam[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "export params must be an array");
  }
  return value.map((param, index) => {
    if (!isRecord(param)) {
      throw new HttpError(400, `export params[${index}] must be an object`);
    }
    return {
      name: normalizeRequiredString(param.name, `params[${index}].name`),
      description: normalizeRequiredString(param.description, `params[${index}].description`),
      schema: normalizeSchemaObject(param.schema, `params[${index}].schema`)
    };
  });
}

function normalizeManifestReturn(value: unknown): PeerManifestReturn {
  if (!isRecord(value)) {
    throw new HttpError(400, "export returns must be an object");
  }
  return {
    description: normalizeRequiredString(value.description, "returns.description"),
    schema: normalizeSchemaObject(value.schema, "returns.schema")
  };
}

function normalizeManifestExamples(value: unknown): PeerManifestExample[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "export examples must be a non-empty array");
  }
  return value.map((example, index) => {
    if (!isRecord(example)) {
      throw new HttpError(400, `examples[${index}] must be an object`);
    }
    return {
      description: normalizeRequiredString(example.description, `examples[${index}].description`),
      code: normalizeRequiredString(example.code, `examples[${index}].code`)
    };
  });
}

function parsePeerManifest(text: string): PeerSdkManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "provider manifest must be valid JSON");
  }
  if (!isRecord(parsed)) {
    throw new HttpError(400, "provider manifest must be an object");
  }
  if (!isRecord(parsed.sdk)) {
    throw new HttpError(400, "provider manifest sdk must be an object");
  }
  if (!Array.isArray(parsed.modules)) {
    throw new HttpError(400, "provider manifest modules must be an array");
  }

  return {
    sdk: {
      name: normalizeRequiredString(parsed.sdk.name, "sdk.name"),
      description: normalizeRequiredString(parsed.sdk.description, "sdk.description")
    },
    modules: parsed.modules.map((moduleValue, moduleIndex) => {
      if (!isRecord(moduleValue)) {
        throw new HttpError(400, `modules[${moduleIndex}] must be an object`);
      }
      if (!Array.isArray(moduleValue.exports)) {
        throw new HttpError(400, `modules[${moduleIndex}].exports must be an array`);
      }
      return {
        path: normalizeRequiredString(moduleValue.path, `modules[${moduleIndex}].path`),
        description: normalizeOptionalString(moduleValue.description),
        exports: moduleValue.exports.map((exportValue, exportIndex) => {
          if (!isRecord(exportValue)) {
            throw new HttpError(400, `modules[${moduleIndex}].exports[${exportIndex}] must be an object`);
          }
          return {
            name: normalizeRequiredString(exportValue.name, `modules[${moduleIndex}].exports[${exportIndex}].name`),
            description: normalizeRequiredString(
              exportValue.description,
              `modules[${moduleIndex}].exports[${exportIndex}].description`
            ),
            params: exportValue.params,
            returns: exportValue.returns,
            examples: exportValue.examples
          };
        })
      };
    })
  };
}

function clampTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return 30_000;
  }
  return Math.min(Math.floor(timeoutMs), MAX_REMOTE_TIMEOUT_MS);
}

function toPosix(input: string): string {
  return input.split(path.sep).join(path.posix.sep);
}

async function createTarGzFromDir(dir: string): Promise<Buffer> {
  const outPath = path.join(os.tmpdir(), `rds-peer-${randomBytes(8).toString("hex")}.tar.gz`);
  try {
    await execFileAsync("tar", ["-czf", outPath, "."], { cwd: dir });
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(outPath, { force: true }).catch(() => undefined);
  }
}

async function createTarGzFromFiles(files: Map<string, string>): Promise<Buffer> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rds-peer-files-"));
  try {
    for (const [relPath, content] of files.entries()) {
      const fullPath = path.join(tempRoot, relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
    }
    return await createTarGzFromDir(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function extractTarGzToDir(data: Buffer, destDir: string): Promise<void> {
  const tempTar = path.join(os.tmpdir(), `rds-peer-${randomBytes(8).toString("hex")}.tar.gz`);
  try {
    await fs.writeFile(tempTar, data);
    await execFileAsync("tar", ["-xzf", tempTar, "-C", destDir, "--no-same-owner", "--no-same-permissions"]);
  } finally {
    await fs.rm(tempTar, { force: true }).catch(() => undefined);
  }
}

async function sanitizeMirroredWorkspace(root: string): Promise<void> {
  for (const entry of [".deno", ".tmp", ".rds", ".nvm", "peers"]) {
    await fs.rm(path.join(root, entry), { recursive: true, force: true }).catch(() => undefined);
  }
  await removeSymlinksRecursive(root);
}

async function removeSymlinksRecursive(root: string): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      await fs.rm(fullPath, { recursive: true, force: true }).catch(() => undefined);
      continue;
    }
    if (entry.isDirectory()) {
      await removeSymlinksRecursive(fullPath);
    }
  }
}

function buildProxyModuleSource(alias: string, moduleDef: PeerManifestModule): string {
  const ext = path.extname(moduleDef.path).toLowerCase();
  const isTs = SUPPORTED_TS_EXTS.has(ext);
  const isCjs = ext === ".cjs";
  if (isCjs) {
    return buildCjsProxyModule(alias, moduleDef);
  }

  const runtimePath = isTs ? "file:///workspace/.rds/peer-runtime.ts" : "file:///workspace/.rds/peer-runtime.mjs";
  const lines = [`import { invokePeer } from ${JSON.stringify(runtimePath)};`, ""];
  for (const exportDef of moduleDef.exports) {
    lines.push(...buildDocCommentLines(exportDef, alias, moduleDef.path));
    if (exportDef.name === "default") {
      lines.push(
        `export default async function (...args${isTs ? ": unknown[]" : ""}) {`,
        `  return invokePeer({ alias: ${JSON.stringify(alias)}, modulePath: ${JSON.stringify(`/workspace/${toPosix(moduleDef.path)}`)}, exportName: "default", args });`,
        `}`,
        ``
      );
      continue;
    }
    lines.push(
      `export async function ${exportDef.name}(...args${isTs ? ": unknown[]" : ""}) {`,
      `  return invokePeer({ alias: ${JSON.stringify(alias)}, modulePath: ${JSON.stringify(`/workspace/${toPosix(moduleDef.path)}`)}, exportName: ${JSON.stringify(exportDef.name)}, args });`,
      `}`,
      ``
    );
  }
  return lines.join("\n");
}

function buildCjsProxyModule(alias: string, moduleDef: PeerManifestModule): string {
  const lines = [`const { invokePeer } = require("/workspace/.rds/peer-runtime.cjs");`, `module.exports = {};`, ``];
  for (const exportDef of moduleDef.exports) {
    lines.push(...buildDocCommentLines(exportDef, alias, moduleDef.path));
    const target = exportDef.name === "default" ? "default" : exportDef.name;
    lines.push(
      `module.exports[${JSON.stringify(target)}] = async (...args) => invokePeer({`,
      `  alias: ${JSON.stringify(alias)},`,
      `  modulePath: ${JSON.stringify(`/workspace/${toPosix(moduleDef.path)}`)},`,
      `  exportName: ${JSON.stringify(exportDef.name)},`,
      `  args`,
      `});`,
      ``
    );
  }
  return lines.join("\n");
}

function buildDocCommentLines(exportDef: PeerManifestExport, alias: string, modulePath: string): string[] {
  const lines = ["/**"];
  for (const line of wrapDocLines(exportDef.description)) {
    lines.push(` * ${line}`);
  }
  if (exportDef.params.length > 0) {
    lines.push(" *", " * Parameters:");
    for (const param of exportDef.params) {
      lines.push(` * - ${sanitizeDocLine(param.name)}: ${sanitizeDocLine(param.description)} (${sanitizeDocLine(summarizeSchema(param.schema))})`);
    }
  }
  lines.push(" *", ` * Returns: ${sanitizeDocLine(exportDef.returns.description)} (${sanitizeDocLine(summarizeSchema(exportDef.returns.schema))})`);
  if (exportDef.examples.length > 0) {
    lines.push(" *", ` * Example: ${sanitizeDocLine(exportDef.examples[0].description)}`);
    for (const line of exportDef.examples[0].code.split("\n")) {
      if (!line.trim()) continue;
      lines.push(` * ${sanitizeDocLine(line)}`);
    }
  } else {
    const importLine =
      exportDef.name === "default"
        ? `import fn from "file:///workspace/peers/${alias}/proxy/${toPosix(modulePath)}";`
        : `import { ${exportDef.name} } from "file:///workspace/peers/${alias}/proxy/${toPosix(modulePath)}";`;
    lines.push(" *", " * Import:", ` * ${sanitizeDocLine(importLine)}`);
  }
  lines.push(" */");
  return lines;
}

function buildPeerReadme(alias: string, sourceMode: VmPeerSourceMode, manifest: PeerSdkManifest): string {
  const lines = [
    `# ${manifest.sdk.name}`,
    ``,
    manifest.sdk.description,
    ``,
    `Alias: \`${alias}\``,
    `Manifest path: \`/workspace/peers/${alias}/manifest.json\``,
    `Proxy root: \`/workspace/peers/${alias}/proxy\``,
    `Source access: \`${sourceMode}\``,
    ``,
    `Use proxy imports for execution. Source stays hidden by default and should only be enabled for explicit debugging.`,
    ``
  ];

  for (const moduleDef of manifest.modules) {
    lines.push(`## ${moduleDef.path}`, ``);
    if (moduleDef.description) {
      lines.push(moduleDef.description, ``);
    }
    for (const exportDef of moduleDef.exports) {
      lines.push(`### ${exportDef.name}`, ``, exportDef.description, ``);
      lines.push(`Import:`, ``, "```ts");
      if (exportDef.name === "default") {
        lines.push(`import fn from "file:///workspace/peers/${alias}/proxy/${moduleDef.path}";`);
      } else {
        lines.push(`import { ${exportDef.name} } from "file:///workspace/peers/${alias}/proxy/${moduleDef.path}";`);
      }
      lines.push("```", ``);

      lines.push(`Parameters:`, ``);
      if (exportDef.params.length === 0) {
        lines.push(`- none`, ``);
      } else {
        for (const param of exportDef.params) {
          lines.push(`- \`${param.name}\`: ${param.description} (${summarizeSchema(param.schema)})`);
        }
        lines.push(``);
      }

      lines.push(`Returns: ${exportDef.returns.description} (${summarizeSchema(exportDef.returns.schema)})`, ``);
      for (const example of exportDef.examples) {
        lines.push(`Example: ${example.description}`, ``, "```ts", example.code, "```", ``);
      }
    }
  }

  return lines.join("\n");
}

function buildTsPeerRuntime(): string {
  return [
    `const config = JSON.parse(await Deno.readTextFile("/workspace/.rds/peer-bridge.json"));`,
    ``,
    `export async function invokePeer(input: { alias: string; modulePath: string; exportName?: string; args?: unknown[]; timeoutMs?: number }) {`,
    `  const response = await fetch(config.baseUrl + "/internal/v1/peer/invoke", {`,
    `    method: "POST",`,
    `    headers: {`,
    `      "content-type": "application/json",`,
    `      authorization: "Bearer " + config.token`,
    `    },`,
    `    body: JSON.stringify(input)`,
    `  });`,
    `  const text = await response.text();`,
    `  const body = text ? JSON.parse(text) : {};`,
    `  if (!response.ok) {`,
    `    throw new Error(String(body.message ?? text ?? ("peer invoke failed: " + response.status)));`,
    `  }`,
    `  return body.result;`,
    `}`,
    ``
  ].join("\n");
}

function buildMjsPeerRuntime(): string {
  return [
    `import fs from "node:fs/promises";`,
    `const config = JSON.parse(await fs.readFile("/workspace/.rds/peer-bridge.json", "utf-8"));`,
    ``,
    `export async function invokePeer(input) {`,
    `  const response = await fetch(config.baseUrl + "/internal/v1/peer/invoke", {`,
    `    method: "POST",`,
    `    headers: {`,
    `      "content-type": "application/json",`,
    `      authorization: "Bearer " + config.token`,
    `    },`,
    `    body: JSON.stringify(input)`,
    `  });`,
    `  const text = await response.text();`,
    `  const body = text ? JSON.parse(text) : {};`,
    `  if (!response.ok) {`,
    `    throw new Error(String(body.message ?? text ?? ("peer invoke failed: " + response.status)));`,
    `  }`,
    `  return body.result;`,
    `}`,
    ``
  ].join("\n");
}

function buildCjsPeerRuntime(): string {
  return [
    `const fs = require("node:fs");`,
    `const config = JSON.parse(fs.readFileSync("/workspace/.rds/peer-bridge.json", "utf-8"));`,
    ``,
    `async function invokePeer(input) {`,
    `  const response = await fetch(config.baseUrl + "/internal/v1/peer/invoke", {`,
    `    method: "POST",`,
    `    headers: {`,
    `      "content-type": "application/json",`,
    `      authorization: "Bearer " + config.token`,
    `    },`,
    `    body: JSON.stringify(input)`,
    `  });`,
    `  const text = await response.text();`,
    `  const body = text ? JSON.parse(text) : {};`,
    `  if (!response.ok) {`,
    `    throw new Error(String(body.message ?? text ?? ("peer invoke failed: " + response.status)));`,
    `  }`,
    `  return body.result;`,
    `}`,
    ``,
    `module.exports = { invokePeer };`,
    ``
  ].join("\n");
}

function normalizePeerLink(link: VmPeerLink): NormalizedPeerLink {
  return {
    alias: String(link.alias ?? ""),
    vmId: String(link.vmId ?? ""),
    sourceMode: normalizeSourceMode(link.sourceMode)
  };
}

function normalizeSourceMode(value: unknown): VmPeerSourceMode {
  if (value === "mounted") return "mounted";
  return "hidden";
}

function assertValidAlias(alias: string): void {
  if (!alias || !/^[A-Za-z0-9_-]+$/.test(alias)) {
    throw new HttpError(400, "Invalid peerLinks alias");
  }
}

function wrapPeerAliasError(alias: string, error: unknown): never {
  if (error instanceof HttpError) {
    throw new HttpError(error.statusCode, `Peer alias ${alias}: ${error.message}`);
  }
  throw new HttpError(500, `Peer alias ${alias}: unexpected peer sync error`);
}

function normalizeRequiredString(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new HttpError(400, `Invalid ${field}`);
  }
  return text;
}

function normalizeOptionalString(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function normalizeSchemaObject(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new HttpError(400, `Invalid ${field}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeSchema(schema: Record<string, unknown>): string {
  if (typeof schema.type === "string") {
    return schema.type;
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return `enum(${schema.enum.map((item) => JSON.stringify(item)).join(", ")})`;
  }
  const text = JSON.stringify(schema);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function sanitizeDocLine(text: string): string {
  return text.replace(/\*\//g, "* /");
}

function wrapDocLines(text: string): string[] {
  return sanitizeDocLine(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
