import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createDb } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { VsockAgentClient } from "./agentClient/agentClient.js";
import { FirecrackerManagerImpl } from "./firecracker/firecrackerManager.js";
import { firecrackerVsockUdsPath } from "./firecracker/socketPaths.js";
import { SimpleNetworkManager } from "./network/networkManager.js";
import { LocalStorageProvider } from "./storage/storageProvider.js";
import { SqlVmStore } from "./state/sqlVmStore.js";
import { VmService } from "./services/vmService.js";
import fs from "node:fs/promises";
import { computeSnapshotVersion } from "./snapshots/snapshotVersion.js";

async function main() {
  const env = loadEnv();

  const db = createDb({ dialect: env.dbDialect, sqlitePath: env.sqlitePath, databaseUrl: env.databaseUrl });
  await runMigrations({ dialect: db.dialect, db: db.db });
  const store = new SqlVmStore(db.db as any, db.vms as any);
  // After manager restart/recreate, Firecracker processes won't be running.
  // Normalize any transient states so `GET /v1/vms` doesn't claim they're still RUNNING.
  for (const vm of await store.list()) {
    if (vm.state === "RUNNING" || vm.state === "STARTING" || vm.state === "STOPPING") {
      await store.update(vm.id, { state: "STOPPED" });
    }
  }
  const firecracker = new FirecrackerManagerImpl({
    firecrackerBin: env.firecrackerBin,
    jailerBin: env.jailer.bin,
    jailerChrootBaseDir: env.jailer.chrootBaseDir,
    jailerUid: env.jailer.uid,
    jailerGid: env.jailer.gid
  });
  const network = new SimpleNetworkManager({ subnetCidr: "172.16.0.0/24", gatewayIp: "172.16.0.1" });
  const agentClient = new VsockAgentClient({
    agentPort: env.agentVsockPort,
    // With jailer, the vsock UDS is inside the per-VM jail root; compute it deterministically.
    vsockUdsPathForVm: (vmId) => firecrackerVsockUdsPath(env.jailer.chrootBaseDir, vmId),
    retry: { attempts: env.vsock.retryAttempts, delayMs: env.vsock.retryDelayMs },
    timeouts: { defaultMs: env.vsock.timeoutMs, healthMs: env.vsock.healthTimeoutMs, binaryMs: env.vsock.binaryTimeoutMs },
    limits: { maxJsonResponseBytes: env.vsock.maxJsonResponseBytes, maxBinaryResponseBytes: env.vsock.maxBinaryResponseBytes }
  });
  const storage = new LocalStorageProvider({
    baseRootfsPath: env.baseRootfsPath,
    storageRoot: env.storageRoot,
    kernelSrcPath: env.kernelPath,
    jailerChrootBaseDir: env.jailer.chrootBaseDir,
    rootfsCloneMode: env.rootfsCloneMode
  });

  const snapshotVersion = env.enableSnapshots
    ? await computeSnapshotVersion({ kernelPath: env.kernelPath, baseRootfsPath: env.baseRootfsPath })
    : "";

  const vmService = new VmService({
    store,
    firecracker,
    network,
    agentClient,
    storage,
    limits: env.limits,
    snapshots: env.enableSnapshots
      ? { enabled: true, version: snapshotVersion, templateCpu: env.snapshotTemplateCpu, templateMemMb: env.snapshotTemplateMemMb }
      : undefined
  });

  const deps = {
    store,
    firecracker,
    network,
    agentClient,
    storage,
    vmService
  };

  if (process.argv[2] === "snapshot-build") {
    await buildTemplateSnapshot({
      firecracker,
      network,
      agentClient,
      storage,
      version: snapshotVersion,
      cpu: env.snapshotTemplateCpu,
      memMb: env.snapshotTemplateMemMb
    });
    return;
  }

  const app = buildApp({ apiKey: env.apiKey, deps });
  app.listen({ port: env.port, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err, "Failed to start server");
    process.exit(1);
  });

  const shutdown = async () => {
    await db.close().catch(() => undefined);
    await app.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function buildTemplateSnapshot(input: {
  firecracker: FirecrackerManagerImpl;
  network: SimpleNetworkManager;
  agentClient: VsockAgentClient;
  storage: LocalStorageProvider;
  version: string;
  cpu: number;
  memMb: number;
}) {
  const templateId = `template-${input.version}`;
  const createdAt = new Date().toISOString();
  const { guestIp, tapName } = await input.network.allocateIp();
  const { rootfsPath, logsDir, kernelPath } = await input.storage.prepareVmStorage(templateId);
  const vm = {
    id: templateId,
    state: "CREATED",
    cpu: input.cpu,
    memMb: input.memMb,
    guestIp,
    tapName,
    vsockCid: 4000,
    outboundInternet: false,
    allowIps: [],
    rootfsPath,
    kernelPath,
    logsDir,
    createdAt
  } as const;

  const snapshot = await input.storage.getSnapshotArtifactPaths(input.version);

  try {
    await input.network.configure(vm as any, tapName);
    await input.firecracker.createAndStart(vm as any, rootfsPath, kernelPath, tapName);
    await input.agentClient.health(templateId);
    await input.firecracker.createSnapshot(vm as any, { memPath: snapshot.memPath, statePath: snapshot.statePath });
    await fs.writeFile(
      snapshot.metaPath,
      JSON.stringify(
        {
          id: input.version,
          kind: "template",
          cpu: input.cpu,
          memMb: input.memMb,
          createdAt,
          hasDisk: false
        },
        null,
        2
      ),
      "utf-8"
    );
    // eslint-disable-next-line no-console
    console.info("[snapshot] created", { version: input.version, dir: snapshot.dir });
  } finally {
    await input.firecracker.destroy(vm as any).catch(() => undefined);
    await input.network.teardown(vm as any, tapName).catch(() => undefined);
    await input.storage.cleanupVmStorage(templateId).catch(() => undefined);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal error", err);
  process.exit(1);
});
