import type { ExecRequest, ExecResult, RunJsRequest, RunTsRequest } from "./agent.js";
import type { NetConfigRequest } from "./agent.js";

export interface FirewallManager {
  /**
   * Apply outbound egress policy.
   *
   * When outboundInternet=false, outbound traffic is blocked (deny-by-default).
   * When outboundInternet=true, only allowIps destinations are allowed.
   *
   * allowIps entries are expected to be IPv4 addresses or CIDRs accepted by iptables `-d`,
   * e.g. "1.2.3.4/32" or "10.0.0.0/8".
   */
  applyAllowlist(allowIps: string[], outboundInternet: boolean): Promise<void>;
}

export interface ExecRunner {
  exec(payload: ExecRequest): Promise<ExecResult>;
  runTs(payload: RunTsRequest): Promise<ExecResult>;
  runJs(payload: RunJsRequest): Promise<ExecResult>;
}

export interface FileService {
  upload(dest: string, payload: NodeJS.ReadableStream): Promise<void>;
  download(path: string, replyStream: NodeJS.WritableStream): Promise<void>;
}

export interface NetworkConfigurator {
  configure(payload: NetConfigRequest): Promise<void>;
}
