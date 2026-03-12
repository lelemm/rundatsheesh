ALTER TABLE "vms" ADD COLUMN "secret_env_ciphertext" text;
--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "bridge_token_hash" text;
--> statement-breakpoint
CREATE TABLE "vm_peer_links" (
  "consumer_vm_id" text NOT NULL,
  "provider_vm_id" text NOT NULL,
  "alias" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "vm_peer_links_consumer_alias_idx" ON "vm_peer_links" ("consumer_vm_id", "alias");
