import { pgTable, text, integer, boolean } from "drizzle-orm/pg-core";

export const vms = pgTable("vms", {
  id: text("id").primaryKey(),
  state: text("state").notNull(),
  cpu: integer("cpu").notNull(),
  memMb: integer("mem_mb").notNull(),
  guestIp: text("guest_ip").notNull(),
  tapName: text("tap_name").notNull(),
  vsockCid: integer("vsock_cid").notNull(),
  outboundInternet: boolean("outbound_internet").notNull(),
  // JSON string (e.g. '["1.2.3.4/32"]') for cross-dialect portability.
  allowIps: text("allow_ips").notNull(),
  rootfsPath: text("rootfs_path").notNull(),
  kernelPath: text("kernel_path").notNull(),
  logsDir: text("logs_dir").notNull(),
  createdAt: text("created_at").notNull(),
  provisionMode: text("provision_mode")
});

