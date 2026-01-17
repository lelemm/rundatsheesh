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
}

export function loadEnv(): EnvConfig {
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
    snapshotTemplateMemMb
  };
}
