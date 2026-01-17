import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const vms = sqliteTable("vms", {
  id: text("id").primaryKey(),
  state: text("state").notNull(),
  cpu: integer("cpu").notNull(),
  memMb: integer("mem_mb").notNull(),
  guestIp: text("guest_ip").notNull(),
  tapName: text("tap_name").notNull(),
  vsockCid: integer("vsock_cid").notNull(),
  outboundInternet: integer("outbound_internet", { mode: "boolean" }).notNull(),
  // JSON string (e.g. '["1.2.3.4/32"]') for cross-dialect portability.
  allowIps: text("allow_ips").notNull(),
  rootfsPath: text("rootfs_path").notNull(),
  kernelPath: text("kernel_path").notNull(),
  logsDir: text("logs_dir").notNull(),
  createdAt: text("created_at").notNull(),
  provisionMode: text("provision_mode")
});

