import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dialect = (process.env.DB_DIALECT ?? "sqlite").toLowerCase();
const config = dialect === "postgres" ? "drizzle.pg.config.ts" : "drizzle.sqlite.config.ts";

if (dialect !== "postgres") {
  const sqlitePath = process.env.SQLITE_PATH ?? "./db/manager.db";
  const rawPath = sqlitePath.startsWith("file:") ? sqlitePath.slice("file:".length) : sqlitePath;
  const dir = path.dirname(rawPath);
  if (dir && dir !== ".") {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const bin = process.platform === "win32" ? "drizzle-kit.cmd" : "drizzle-kit";
const res = spawnSync(bin, ["migrate", "--config", config], { stdio: "inherit" });
process.exit(res.status ?? 1);

