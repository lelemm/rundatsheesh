import { describe, expect, it } from "vitest";
import { resolveUserPath } from "../pathPolicy.js";

describe("resolveUserPath", () => {
  it("allows paths within /home/user", () => {
    const resolved = resolveUserPath("project/file.txt");
    expect(resolved).toBe("/home/user/project/file.txt");
  });

  it("rejects paths that escape /home/user", () => {
    expect(() => resolveUserPath("../etc/passwd")).toThrow("Path escapes /home/user");
  });
});
