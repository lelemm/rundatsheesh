import path from "node:path";

const JAILER_EXEC_FILE_DIRNAME = "firecracker";

export function jailerVmDir(chrootBaseDir: string, vmId: string): string {
  // Jailer creates: <chrootBaseDir>/<exec_file_name>/<id>/root/...
  return path.join(chrootBaseDir, JAILER_EXEC_FILE_DIRNAME, vmId);
}

export function jailerRootDir(chrootBaseDir: string, vmId: string): string {
  // Firecracker jailer creates: <chrootBaseDir>/<id>/root
  return path.join(jailerVmDir(chrootBaseDir, vmId), "root");
}

export function jailerRunDir(chrootBaseDir: string, vmId: string): string {
  return path.join(jailerRootDir(chrootBaseDir, vmId), "run");
}

export function firecrackerApiSocketPath(chrootBaseDir: string, vmId: string): string {
  // Host-visible API socket path (inside the jail root).
  // Keep the filename short; Unix socket paths have a ~108-byte limit.
  return path.join(jailerRunDir(chrootBaseDir, vmId), "api.sock");
}

export function firecrackerVsockUdsPath(chrootBaseDir: string, vmId: string): string {
  // Host-visible vsock UDS path (inside the jail root).
  // Keep the filename short; Unix socket paths have a ~108-byte limit.
  return path.join(jailerRunDir(chrootBaseDir, vmId), "vsock.sock");
}

export function inChrootPathForHostPath(jailRootHostPath: string, hostPath: string): string {
  // Convert a host path under <...>/<id>/root to an in-chroot absolute path.
  // Example:
  //   jailRootHostPath=/var/lib/run-dat-sheesh/jailer/<id>/root
  //   hostPath=/var/lib/run-dat-sheesh/jailer/<id>/root/run/<id>.sock
  //   => /run/<id>.sock
  const rel = path.relative(jailRootHostPath, hostPath);
  // Ensure posix separators inside the VM chroot.
  const relPosix = rel.split(path.sep).join(path.posix.sep);
  return path.posix.join("/", relPosix);
}

