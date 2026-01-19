import { describe, expect, it } from "vitest";
import { resolveWorkspacePathToChroot, resolveWorkspacePathToHost } from "../pathPolicy.js";

describe("pathPolicy (workspace-only)", () => {
  it("allows relative paths (maps to /workspace and /home/user)", () => {
    expect(resolveWorkspacePathToChroot("project/file.txt")).toBe("/workspace/project/file.txt");
    expect(resolveWorkspacePathToHost("project/file.txt")).toBe("/home/user/project/file.txt");
  });

  it("allows absolute /workspace paths", () => {
    expect(resolveWorkspacePathToChroot("/workspace/project")).toBe("/workspace/project");
    expect(resolveWorkspacePathToHost("/workspace/project")).toBe("/home/user/project");
  });

  it("rejects /home/user inputs", () => {
    expect(() => resolveWorkspacePathToChroot("/home/user/project")).toThrow("Only /workspace paths are allowed");
  });

  it("rejects traversal", () => {
    expect(() => resolveWorkspacePathToChroot("../etc/passwd")).toThrow("Path escapes /workspace");
    expect(() => resolveWorkspacePathToChroot("/workspace/../etc")).toThrow("Path escapes /workspace");
  });
});
