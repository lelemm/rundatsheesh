import type { AgentClient, FirecrackerManager, NetworkManager, StorageProvider, VmStore } from "./interfaces.js";
import type { VmService } from "../services/vmService.js";

export interface AppDeps {
  store: VmStore;
  firecracker: FirecrackerManager;
  network: NetworkManager;
  agentClient: AgentClient;
  storage: StorageProvider;
  vmService: VmService;
}
