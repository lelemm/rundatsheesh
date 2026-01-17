export interface EnvConfig {
  apiKey: string;
  port: number;
  kernelPath: string;
  baseRootfsPath: string;
  storageRoot: string;
  agentVsockPort: number;
  firecrackerBin: string;
  rootfsCloneMode: "auto" | "reflink" | "copy";
  enableSnapshots: boolean;
  snapshotTemplateCpu: number;
  snapshotTemplateMemMb: number;
  limits: {
    maxVms: number;
    maxCpu: number;
    maxMemMb: number;
    maxAllowIps: number;
    maxExecTimeoutMs: number;
    maxRunTsTimeoutMs: number;
  };
  vsock: {
    retryAttempts: number;
    retryDelayMs: number;
    timeoutMs: number;
    healthTimeoutMs: number;
    binaryTimeoutMs: number;
    maxJsonResponseBytes: number;
    maxBinaryResponseBytes: number;
  };
}

export function loadEnv(): EnvConfig {
  const parsePositiveInt = (raw: string | undefined, name: string, fallback: number) => {
    const n = Number(raw ?? String(fallback));
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`${name} must be a positive number`);
    }
    return Math.floor(n);
  };

  const apiKey = process.env.API_KEY ?? "";
  if (!apiKey) {
    throw new Error("API_KEY is required");
  }

  const portRaw = process.env.PORT ?? "3000";
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("PORT must be a positive number");
  }

  const kernelPath = process.env.KERNEL_PATH ?? "";
  if (!kernelPath) {
    throw new Error("KERNEL_PATH is required");
  }

  const baseRootfsPath = process.env.BASE_ROOTFS_PATH ?? "";
  if (!baseRootfsPath) {
    throw new Error("BASE_ROOTFS_PATH is required");
  }

  const storageRoot = process.env.STORAGE_ROOT ?? "/var/lib/run-dat-sheesh";

  const agentVsockPortRaw = process.env.AGENT_VSOCK_PORT ?? "8080";
  const agentVsockPort = Number(agentVsockPortRaw);
  if (!Number.isFinite(agentVsockPort) || agentVsockPort <= 0) {
    throw new Error("AGENT_VSOCK_PORT must be a positive number");
  }

  const firecrackerBin = process.env.FIRECRACKER_BIN ?? "firecracker";

  const rootfsCloneModeRaw = (process.env.ROOTFS_CLONE_MODE ?? "auto").toLowerCase();
  const rootfsCloneMode = (["auto", "reflink", "copy"] as const).includes(rootfsCloneModeRaw as any)
    ? (rootfsCloneModeRaw as "auto" | "reflink" | "copy")
    : null;
  if (!rootfsCloneMode) {
    throw new Error("ROOTFS_CLONE_MODE must be one of: auto, reflink, copy");
  }

  const enableSnapshots = (process.env.ENABLE_SNAPSHOTS ?? "false").toLowerCase() === "true";

  const snapshotTemplateCpuRaw = process.env.SNAPSHOT_TEMPLATE_CPU ?? "1";
  const snapshotTemplateCpu = Number(snapshotTemplateCpuRaw);
  if (!Number.isFinite(snapshotTemplateCpu) || snapshotTemplateCpu <= 0) {
    throw new Error("SNAPSHOT_TEMPLATE_CPU must be a positive number");
  }

  const snapshotTemplateMemMbRaw = process.env.SNAPSHOT_TEMPLATE_MEM_MB ?? "256";
  const snapshotTemplateMemMb = Number(snapshotTemplateMemMbRaw);
  if (!Number.isFinite(snapshotTemplateMemMb) || snapshotTemplateMemMb <= 0) {
    throw new Error("SNAPSHOT_TEMPLATE_MEM_MB must be a positive number");
  }

  return {
    apiKey,
    port,
    kernelPath,
    baseRootfsPath,
    storageRoot,
    agentVsockPort,
    firecrackerBin,
    rootfsCloneMode,
    enableSnapshots,
    snapshotTemplateCpu,
    snapshotTemplateMemMb,
    limits: {
      maxVms: parsePositiveInt(process.env.MAX_VMS, "MAX_VMS", 20),
      maxCpu: parsePositiveInt(process.env.MAX_CPU, "MAX_CPU", 4),
      maxMemMb: parsePositiveInt(process.env.MAX_MEM_MB, "MAX_MEM_MB", 2048),
      maxAllowIps: parsePositiveInt(process.env.MAX_ALLOW_IPS, "MAX_ALLOW_IPS", 64),
      maxExecTimeoutMs: parsePositiveInt(process.env.MAX_EXEC_TIMEOUT_MS, "MAX_EXEC_TIMEOUT_MS", 120_000),
      maxRunTsTimeoutMs: parsePositiveInt(process.env.MAX_RUNTS_TIMEOUT_MS, "MAX_RUNTS_TIMEOUT_MS", 120_000)
    },
    vsock: {
      retryAttempts: parsePositiveInt(process.env.VSOCK_RETRY_ATTEMPTS, "VSOCK_RETRY_ATTEMPTS", 30),
      retryDelayMs: parsePositiveInt(process.env.VSOCK_RETRY_DELAY_MS, "VSOCK_RETRY_DELAY_MS", 100),
      timeoutMs: parsePositiveInt(process.env.VSOCK_TIMEOUT_MS, "VSOCK_TIMEOUT_MS", 15_000),
      healthTimeoutMs: parsePositiveInt(process.env.VSOCK_HEALTH_TIMEOUT_MS, "VSOCK_HEALTH_TIMEOUT_MS", 15_000),
      binaryTimeoutMs: parsePositiveInt(process.env.VSOCK_BINARY_TIMEOUT_MS, "VSOCK_BINARY_TIMEOUT_MS", 30_000),
      maxJsonResponseBytes: parsePositiveInt(process.env.VSOCK_MAX_JSON_RESPONSE_BYTES, "VSOCK_MAX_JSON_RESPONSE_BYTES", 2_000_000),
      maxBinaryResponseBytes: parsePositiveInt(process.env.VSOCK_MAX_BINARY_RESPONSE_BYTES, "VSOCK_MAX_BINARY_RESPONSE_BYTES", 50_000_000)
    }
  };
}
