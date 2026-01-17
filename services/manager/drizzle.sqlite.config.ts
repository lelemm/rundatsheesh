import type { Config } from "drizzle-kit";

const sqlitePath = process.env.SQLITE_PATH ?? "./db/manager.db";
const sqliteUrl = sqlitePath.startsWith("file:") ? sqlitePath : `file:${sqlitePath}`;

export default {
  schema: "./src/db/schema.sqlite.ts",
  out: "./drizzle/sqlite",
  dialect: "sqlite",
  dbCredentials: {
    url: sqliteUrl
  }
} satisfies Config;

