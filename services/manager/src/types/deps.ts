import type { AgentClient, FirecrackerManager, NetworkManager, StorageProvider, VmStore } from "./interfaces.js";
import type { VmService } from "../services/vmService.js";
import type { ActivityService } from "../telemetry/activityService.js";
import type { ApiKeyService } from "../apiKey/apiKeyService.js";

export interface AppDeps {
  store: VmStore;
  firecracker: FirecrackerManager;
  network: NetworkManager;
  agentClient: AgentClient;
  storage: StorageProvider;
  storageRoot: string;
  vmService: VmService;
  activityService?: ActivityService;
  apiKeyService?: ApiKeyService;
}
