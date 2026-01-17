import path from "node:path";
import type { DbDialect } from "./index.js";

import { migrate as migrateSqlite } from "drizzle-orm/better-sqlite3/migrator";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";

export async function runMigrations(input: { dialect: DbDialect; db: any }) {
  const folder = path.join(process.cwd(), "drizzle", input.dialect === "sqlite" ? "sqlite" : "pg");

  if (input.dialect === "sqlite") {
    migrateSqlite(input.db, { migrationsFolder: folder });
    return;
  }

  await migratePg(input.db, { migrationsFolder: folder });
}

