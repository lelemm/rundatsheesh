export type VmState =
  | "CREATED"
  | "STARTING"
  | "RUNNING"
  | "STOPPING"
  | "STOPPED"
  | "DELETED"
  | "ERROR";

export type VmProvisionMode = "boot" | "snapshot";

export interface VmRecord {
  id: string;
  state: VmState;
  cpu: number;
  memMb: number;
  guestIp: string;
  tapName: string;
  vsockCid: number;
  outboundInternet: boolean;
  allowIps: string[];
  imageId?: string;
  rootfsPath: string;
  kernelPath: string;
  logsDir: string;
  createdAt: string;
  provisionMode?: VmProvisionMode;
}

export interface VmPublic {
  id: string;
  state: VmState;
  cpu: number;
  memMb: number;
  guestIp: string;
  outboundInternet: boolean;
  createdAt: string;
  provisionMode?: VmProvisionMode;
  imageId?: string;
}

export interface VmCreateRequest {
  cpu: number;
  memMb: number;
  allowIps: string[];
  outboundInternet?: boolean;
  snapshotId?: string;
  imageId?: string;
  diskSizeMb?: number;
}

export interface VmExecRequest {
  cmd: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface VmRunTsRequest {
  path?: string;
  code?: string;
  args?: string[];
  denoFlags?: string[];
  timeoutMs?: number;
  allowNet?: boolean;
  /**
   * Additional environment variables passed to the run-ts process.
   * Format: ["KEY=value", ...]
   */
  env?: string[];
}
