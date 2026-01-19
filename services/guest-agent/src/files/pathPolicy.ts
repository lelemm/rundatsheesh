import path from "node:path";
import { USER_HOME } from "../config/constants.js";

export const WORKSPACE_ROOT = "/workspace";

function workspaceRelFromInput(inputPath: string): string {
  const posix = path.posix;
  const input = inputPath.trim();
  if (!input) {
    return "";
  }

  if (posix.isAbsolute(input)) {
    if (!input.startsWith(WORKSPACE_ROOT + "/") && input !== WORKSPACE_ROOT) {
      throw new Error("Only /workspace paths are allowed");
    }
    const normalized = posix.normalize(input);
    const rel = posix.relative(WORKSPACE_ROOT, normalized);
    if (!rel || rel === ".") return "";
    if (rel.startsWith("..")) throw new Error("Path escapes /workspace");
    return rel;
  }

  // Relative input; normalize and ensure it doesn't traverse.
  const normalizedRel = posix.normalize(input);
  if (posix.isAbsolute(normalizedRel)) {
    // Should not happen, but guard anyway.
    throw new Error("Only relative or /workspace paths are allowed");
  }
  if (normalizedRel.startsWith("..")) {
    throw new Error("Path escapes /workspace");
  }
  if (normalizedRel === "." || normalizedRel === "./") return "";
  return normalizedRel;
}

/**
 * Resolve a workspace input path into a chroot-visible absolute path under /workspace.
 * Accepts relative paths and absolute /workspace paths; rejects any other absolute roots.
 */
export function resolveWorkspacePathToChroot(inputPath: string): string {
  const rel = workspaceRelFromInput(inputPath);
  return rel ? path.posix.join(WORKSPACE_ROOT, rel) : WORKSPACE_ROOT;
}

/**
 * Resolve a workspace input path into a host filesystem path under /home/user.
 * This is used by the guest-agent itself (running outside the chroot) for file IO.
 */
export function resolveWorkspacePathToHost(inputPath: string): string {
  const rel = workspaceRelFromInput(inputPath);
  const resolved = rel ? path.resolve(USER_HOME, rel) : USER_HOME;
  if (!resolved.startsWith(USER_HOME + path.sep) && resolved !== USER_HOME) {
    // Defense-in-depth: should be impossible due to workspaceRelFromInput checks.
    throw new Error("Path escapes /home/user");
  }
  return resolved;
}
