export interface ExecRequest {
  cmd: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface RunTsRequest {
  path?: string;
  code?: string;
  args?: string[];
  denoFlags?: string[];
  timeoutMs?: number;
  allowNet?: boolean;
  /**
   * Additional environment variables for the program execution.
   * Format: ["KEY=value", ...]
   */
  env?: string[];
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface NetConfigRequest {
  /**
   * Only eth0 is supported for now.
   */
  iface?: string;
  ip: string;
  cidr?: number;
  gateway: string;
  mac?: string;
}
