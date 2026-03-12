import type { AgentClient, FirecrackerManager, NetworkManager, StorageProvider, VmStore } from "./interfaces.js";
import type { VmService } from "../services/vmService.js";
import type { ActivityService } from "../telemetry/activityService.js";
import type { ApiKeyService } from "../apiKey/apiKeyService.js";
import type { ImageService } from "../services/imageService.js";
import type { PeerService } from "../services/peer/peerService.js";
import type { WebhookService } from "../services/webhookService.js";
import type { VmPeerLinkStore } from "./interfaces.js";

export interface AppDeps {
  store: VmStore;
  firecracker: FirecrackerManager;
  network: NetworkManager;
  agentClient: AgentClient;
  storage: StorageProvider;
  storageRoot: string;
  images: ImageService;
  vmService: VmService;
  vmPeerLinks?: VmPeerLinkStore;
  peerService?: PeerService;
  activityService?: ActivityService;
  apiKeyService?: ApiKeyService;
  webhookService?: WebhookService;
}
