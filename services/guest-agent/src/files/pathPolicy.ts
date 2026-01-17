import path from "node:path";
import { USER_HOME } from "../config/constants.js";

export function resolveUserPath(inputPath: string): string {
  const resolved = path.resolve(USER_HOME, inputPath);
  if (!resolved.startsWith(USER_HOME + path.sep) && resolved !== USER_HOME) {
    throw new Error("Path escapes /home/user");
  }
  return resolved;
}
