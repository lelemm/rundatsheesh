import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { SANDBOX_ROOT, USER_HOME } from "../config/constants.js";

async function isMountPoint(mountPoint: string): Promise<boolean> {
  const content = await fs.readFile("/proc/self/mountinfo", "utf-8");
  for (const line of content.split("\n")) {
    if (!line) continue;
    // mountinfo: ... <mount-point> ... - <fstype> <source> <superopts>
    const parts = line.split(" ");
    if (parts.length < 5) continue;
    const mp = parts[4];
    if (mp === mountPoint) return true;
  }
  return false;
}

async function run(cmd: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code ?? -1}`));
    });
  });
}

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

async function ensureBindMount(source: string, target: string): Promise<void> {
  await ensureDir(target);
  if (await isMountPoint(target)) return;
  // Prefer util-linux mount; fall back to BusyBox mount if needed.
  try {
    await run("/bin/mount", ["--bind", source, target]);
  } catch {
    await run("/bin/busybox", ["mount", "--bind", source, target]);
  }
}

/**
 * Ensure the /exec sandbox is ready:
 * - chroot root at SANDBOX_ROOT exists and contains a minimal toolchain (provided by the image)
 * - bind-mount real USER_HOME into /home/user and /workspace inside the sandbox
 */
export async function ensureExecSandboxReady(): Promise<void> {
  await ensureDir(SANDBOX_ROOT);
  await ensureDir(`${SANDBOX_ROOT}/dev`);
  await ensureDir(`${SANDBOX_ROOT}/proc`);
  await ensureDir(`${SANDBOX_ROOT}/home/user`);
  await ensureDir(`${SANDBOX_ROOT}/workspace`);

  // Bind mounts make /home/user visible inside the chroot without symlink tricks.
  await ensureBindMount(USER_HOME, `${SANDBOX_ROOT}/home/user`);
  await ensureBindMount(USER_HOME, `${SANDBOX_ROOT}/workspace`);

  // Provide a working /dev inside the chroot. Creating device nodes in the image build
  // can fail depending on the filesystem/permissions; bind-mounting /dev is reliable.
  await ensureBindMount("/dev", `${SANDBOX_ROOT}/dev`);

  // Some runtimes (notably Deno on Alpine/musl) rely on /proc for basic introspection
  // (e.g. /proc/self/exe). Bind-mount /proc so jailed commands can run reliably.
  await ensureBindMount("/proc", `${SANDBOX_ROOT}/proc`);
}

