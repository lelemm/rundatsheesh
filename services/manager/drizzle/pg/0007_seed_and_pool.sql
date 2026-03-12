ALTER TABLE "vms" ADD COLUMN "base_seed_snapshot_id" text;
--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "pool_tag" text;
--> statement-breakpoint
ALTER TABLE "guest_images" ADD COLUMN "seed_snapshot_id" text;
--> statement-breakpoint
ALTER TABLE "guest_images" ADD COLUMN "seed_status" text;
--> statement-breakpoint
ALTER TABLE "guest_images" ADD COLUMN "seed_updated_at" text;
--> statement-breakpoint
ALTER TABLE "guest_images" ADD COLUMN "seed_error" text;
