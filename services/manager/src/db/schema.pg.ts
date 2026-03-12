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
  imageId: text("image_id"),
  rootfsPath: text("rootfs_path").notNull(),
  overlayPath: text("overlay_path"),
  kernelPath: text("kernel_path").notNull(),
  logsDir: text("logs_dir").notNull(),
  createdAt: text("created_at").notNull(),
  provisionMode: text("provision_mode"),
  baseSeedSnapshotId: text("base_seed_snapshot_id"),
  poolTag: text("pool_tag"),
  secretEnvCiphertext: text("secret_env_ciphertext"),
  bridgeTokenHash: text("bridge_token_hash")
});

export const vmPeerLinks = pgTable("vm_peer_links", {
  consumerVmId: text("consumer_vm_id").notNull(),
  providerVmId: text("provider_vm_id").notNull(),
  alias: text("alias").notNull(),
  sourceMode: text("source_mode").notNull().default("hidden")
});

export const guestImages = pgTable("guest_images", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  createdAt: text("created_at").notNull(),
  kernelFilename: text("kernel_filename"),
  rootfsFilename: text("rootfs_filename"),
  baseRootfsBytes: integer("base_rootfs_bytes"),
  kernelUploadedAt: text("kernel_uploaded_at"),
  rootfsUploadedAt: text("rootfs_uploaded_at"),
  seedSnapshotId: text("seed_snapshot_id"),
  seedStatus: text("seed_status"),
  seedUpdatedAt: text("seed_updated_at"),
  seedError: text("seed_error")
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull()
});

export const activityEvents = pgTable("activity_events", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  type: text("type").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  message: text("message").notNull(),
  metaJson: text("meta_json")
});

export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  hash: text("hash").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at"),
  revokedAt: text("revoked_at"),
  lastUsedAt: text("last_used_at")
});

export const webhooks = pgTable("webhooks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  enabled: boolean("enabled").notNull(),
  // JSON string array (e.g. '["vm.started","image.kernel_uploaded"]')
  eventTypesJson: text("event_types_json").notNull(),
  createdAt: text("created_at").notNull()
});
