export interface EnvConfig {
  apiKey: string;
  adminEmail: string;
  adminPassword: string;
  port: number;
  kernelPath?: string;
  baseRootfsPath?: string;
  storageRoot: string;
  imagesDir: string;
  dbDialect: "sqlite" | "postgres";
  sqlitePath: string;
  databaseUrl?: string;
  vmSecretKey?: string;
  managerInternalBaseUrl: string;
  agentVsockPort: number;
  firecrackerBin: string;
  jailer: {
    bin: string;
    chrootBaseDir: string;
    uid: number;
    gid: number;
  };
  rootfsCloneMode: "auto" | "reflink" | "copy";
  overlaySizeBytes: number;
  firecrackerLogLevel: "Error" | "Warning" | "Info" | "Debug";
  overlayDeviceWaitMs: number;
  snapshotTemplateCpu: number;
  snapshotTemplateMemMb: number;
  warmPool: {
    enabled: boolean;
    target: number;
    maxVms: number;
  };
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
  /**
   * Optional DNS server IP to be configured inside the guest (written to /etc/resolv.conf).
   * If unset, the guest uses the VM gateway IP as DNS.
   */
  dnsServerIp?: string;
}

export function loadEnv(): EnvConfig {
  const parsePositiveInt = (raw: string | undefined, name: string, fallback: number) => {
    const n = Number(raw ?? String(fallback));
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`${name} must be a positive number`);
    }
    return Math.floor(n);
  };
  const parseNonNegativeInt = (raw: string | undefined, name: string, fallback: number) => {
    const n = Number(raw ?? String(fallback));
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`${name} must be a non-negative number`);
    }
    return Math.floor(n);
  };

  const apiKey = process.env.API_KEY ?? "";
  if (!apiKey) {
    throw new Error("API_KEY is required");
  }

  const adminEmail = process.env.ADMIN_EMAIL ?? "";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";
  if (!adminEmail) {
    throw new Error("ADMIN_EMAIL is required");
  }
  if (!adminPassword) {
    throw new Error("ADMIN_PASSWORD is required");
  }

  const portRaw = process.env.PORT ?? "3000";
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("PORT must be a positive number");
  }

  const kernelPath = process.env.KERNEL_PATH || undefined;
  const baseRootfsPath = process.env.BASE_ROOTFS_PATH || undefined;

  const storageRoot = process.env.STORAGE_ROOT ?? "/var/lib/run-dat-sheesh";
  const imagesDir = process.env.IMAGES_DIR ?? `${storageRoot}/images`;

  const dbDialectRaw = (process.env.DB_DIALECT ?? "sqlite").toLowerCase();
  const dbDialect = (["sqlite", "postgres"] as const).includes(dbDialectRaw as any) ? (dbDialectRaw as "sqlite" | "postgres") : null;
  if (!dbDialect) {
    throw new Error("DB_DIALECT must be one of: sqlite, postgres");
  }
  // Dev default: keep SQLite DB in-repo under ./db/ so local runs don't require /var/lib paths.
  // Production (docker) should set SQLITE_PATH explicitly (e.g. /var/lib/run-dat-sheesh/manager.db).
  const sqlitePath = process.env.SQLITE_PATH ?? "./db/manager.db";
  const databaseUrl = process.env.DATABASE_URL;
  if (dbDialect === "postgres" && !databaseUrl) {
    throw new Error("DATABASE_URL is required when DB_DIALECT=postgres");
  }

  const agentVsockPortRaw = process.env.AGENT_VSOCK_PORT ?? "8080";
  const agentVsockPort = Number(agentVsockPortRaw);
  if (!Number.isFinite(agentVsockPort) || agentVsockPort <= 0) {
    throw new Error("AGENT_VSOCK_PORT must be a positive number");
  }

  // Jailer requires an exec-file path that can be canonicalized; do not rely on PATH lookup here.
  const firecrackerBin = process.env.FIRECRACKER_BIN ?? "/usr/local/bin/firecracker";

  const jailerBin = process.env.JAILER_BIN ?? "/usr/local/bin/jailer";
  const jailerChrootBaseDir = process.env.JAILER_CHROOT_BASE_DIR ?? `${storageRoot}/jailer`;
  if (!jailerChrootBaseDir || typeof jailerChrootBaseDir !== "string" || !jailerChrootBaseDir.startsWith("/")) {
    throw new Error("JAILER_CHROOT_BASE_DIR must be an absolute path");
  }
  const jailerUid = parsePositiveInt(process.env.JAILER_UID, "JAILER_UID", 1234);
  const jailerGid = parsePositiveInt(process.env.JAILER_GID, "JAILER_GID", 1234);

  const rootfsCloneModeRaw = (process.env.ROOTFS_CLONE_MODE ?? "auto").toLowerCase();
  const rootfsCloneMode = (["auto", "reflink", "copy"] as const).includes(rootfsCloneModeRaw as any)
    ? (rootfsCloneModeRaw as "auto" | "reflink" | "copy")
    : null;
  if (!rootfsCloneMode) {
    throw new Error("ROOTFS_CLONE_MODE must be one of: auto, reflink, copy");
  }

  // Overlay mode is always enabled; this controls only the writable overlay disk size.
  const overlaySizeBytes = parsePositiveInt(process.env.OVERLAY_SIZE_BYTES, "OVERLAY_SIZE_BYTES", 512 * 1024 * 1024);
  const overlayDeviceWaitMs = parsePositiveInt(process.env.OVERLAY_DEVICE_WAIT_MS, "OVERLAY_DEVICE_WAIT_MS", 200);

  const firecrackerLogLevelRaw = (process.env.FIRECRACKER_LOG_LEVEL ?? "Warning").trim();
  const firecrackerLogLevel = (["Error", "Warning", "Info", "Debug"] as const).includes(firecrackerLogLevelRaw as any)
    ? (firecrackerLogLevelRaw as "Error" | "Warning" | "Info" | "Debug")
    : null;
  if (!firecrackerLogLevel) {
    throw new Error("FIRECRACKER_LOG_LEVEL must be one of: Error, Warning, Info, Debug");
  }

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

  const dnsServerIpRaw = (process.env.DNS_SERVER_IP ?? "").trim();
  const dnsServerIp = dnsServerIpRaw ? dnsServerIpRaw : undefined;
  if (dnsServerIp && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(dnsServerIp)) {
    throw new Error("DNS_SERVER_IP must be an IPv4 address");
  }

  const warmPoolEnabled = (process.env.ENABLE_WARM_POOL ?? "false").toLowerCase() === "true";
  const warmPoolTarget = parseNonNegativeInt(process.env.WARM_POOL_TARGET, "WARM_POOL_TARGET", 1);
  const warmPoolMaxVms = parsePositiveInt(process.env.WARM_POOL_MAX_VMS, "WARM_POOL_MAX_VMS", 4);

  return {
    apiKey,
    adminEmail,
    adminPassword,
    port,
    kernelPath,
    baseRootfsPath,
    storageRoot,
    imagesDir,
    dbDialect,
    sqlitePath,
    databaseUrl,
    vmSecretKey: process.env.VM_SECRET_KEY || undefined,
    managerInternalBaseUrl: process.env.MANAGER_INTERNAL_BASE_URL ?? `http://172.16.0.1:${port}`,
    agentVsockPort,
    firecrackerBin,
    jailer: {
      bin: jailerBin,
      chrootBaseDir: jailerChrootBaseDir,
      uid: jailerUid,
      gid: jailerGid
    },
    rootfsCloneMode,
    overlaySizeBytes,
    firecrackerLogLevel,
    overlayDeviceWaitMs,
    snapshotTemplateCpu,
    snapshotTemplateMemMb,
    warmPool: {
      enabled: warmPoolEnabled,
      target: warmPoolEnabled ? warmPoolTarget : 0,
      maxVms: warmPoolMaxVms
    },
    limits: {
      maxVms: parsePositiveInt(process.env.MAX_VMS, "MAX_VMS", 20),
      maxCpu: parsePositiveInt(process.env.MAX_CPU, "MAX_CPU", 4),
      maxMemMb: parsePositiveInt(process.env.MAX_MEM_MB, "MAX_MEM_MB", 2048),
      maxAllowIps: parsePositiveInt(process.env.MAX_ALLOW_IPS, "MAX_ALLOW_IPS", 64),
      maxExecTimeoutMs: parsePositiveInt(process.env.MAX_EXEC_TIMEOUT_MS, "MAX_EXEC_TIMEOUT_MS", 120_000),
      maxRunTsTimeoutMs: parsePositiveInt(process.env.MAX_RUNTS_TIMEOUT_MS, "MAX_RUNTS_TIMEOUT_MS", 120_000)
    },
    vsock: {
      retryAttempts: parsePositiveInt(process.env.VSOCK_RETRY_ATTEMPTS, "VSOCK_RETRY_ATTEMPTS", 150),
      retryDelayMs: parsePositiveInt(process.env.VSOCK_RETRY_DELAY_MS, "VSOCK_RETRY_DELAY_MS", 100),
      timeoutMs: parsePositiveInt(process.env.VSOCK_TIMEOUT_MS, "VSOCK_TIMEOUT_MS", 15_000),
      healthTimeoutMs: parsePositiveInt(process.env.VSOCK_HEALTH_TIMEOUT_MS, "VSOCK_HEALTH_TIMEOUT_MS", 15_000),
      binaryTimeoutMs: parsePositiveInt(process.env.VSOCK_BINARY_TIMEOUT_MS, "VSOCK_BINARY_TIMEOUT_MS", 30_000),
      maxJsonResponseBytes: parsePositiveInt(process.env.VSOCK_MAX_JSON_RESPONSE_BYTES, "VSOCK_MAX_JSON_RESPONSE_BYTES", 2_000_000),
      maxBinaryResponseBytes: parsePositiveInt(process.env.VSOCK_MAX_BINARY_RESPONSE_BYTES, "VSOCK_MAX_BINARY_RESPONSE_BYTES", 50_000_000)
    },
    dnsServerIp
  };
}
