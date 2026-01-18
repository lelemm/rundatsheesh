import Database from "better-sqlite3";
import pg from "pg";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import fs from "node:fs";
import path from "node:path";

import * as sqliteSchema from "./schema.sqlite.js";
import * as pgSchema from "./schema.pg.js";

export type DbDialect = "sqlite" | "postgres";

export function createDb(input: { dialect: DbDialect; sqlitePath: string; databaseUrl?: string }) {
  if (input.dialect === "sqlite") {
    const dir = path.dirname(input.sqlitePath);
    if (dir && dir !== ".") {
      fs.mkdirSync(dir, { recursive: true });
    }
    const sqlite = new Database(input.sqlitePath);
    const db = drizzleSqlite(sqlite, { schema: sqliteSchema });
    return {
      dialect: input.dialect,
      db,
      vms: sqliteSchema.vms,
      guestImages: sqliteSchema.guestImages,
      settings: sqliteSchema.settings,
      activityEvents: sqliteSchema.activityEvents,
      apiKeys: sqliteSchema.apiKeys,
      close: async () => {
        sqlite.close();
      }
    } as const;
  }

  const { Pool } = pg;
  const pool = new Pool({ connectionString: input.databaseUrl });
  const db = drizzlePg(pool, { schema: pgSchema });
  return {
    dialect: input.dialect,
    db,
    vms: pgSchema.vms,
    guestImages: pgSchema.guestImages,
    settings: pgSchema.settings,
    activityEvents: pgSchema.activityEvents,
    apiKeys: pgSchema.apiKeys,
    close: async () => {
      await pool.end();
    }
  } as const;
}

