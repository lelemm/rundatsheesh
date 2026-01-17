import path from "node:path";

export function firecrackerApiSocketPath(apiSocketDir: string, vmId: string): string {
  return path.join(apiSocketDir, `${vmId}.sock`);
}

export function firecrackerVsockUdsPath(apiSocketDir: string, vmId: string): string {
  return path.join(apiSocketDir, `${vmId}.vsock`);
}

