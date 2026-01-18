CREATE TABLE "guest_images" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"created_at" text NOT NULL,
	"kernel_filename" text,
	"rootfs_filename" text,
	"base_rootfs_bytes" integer
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "image_id" text;