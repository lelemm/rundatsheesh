CREATE TABLE "activity_events" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"type" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"message" text NOT NULL,
	"meta_json" text
);
