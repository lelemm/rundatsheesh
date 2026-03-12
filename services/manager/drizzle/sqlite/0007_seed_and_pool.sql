ALTER TABLE `vms` ADD `base_seed_snapshot_id` text;
--> statement-breakpoint
ALTER TABLE `vms` ADD `pool_tag` text;
--> statement-breakpoint
ALTER TABLE `guest_images` ADD `seed_snapshot_id` text;
--> statement-breakpoint
ALTER TABLE `guest_images` ADD `seed_status` text;
--> statement-breakpoint
ALTER TABLE `guest_images` ADD `seed_updated_at` text;
--> statement-breakpoint
ALTER TABLE `guest_images` ADD `seed_error` text;
