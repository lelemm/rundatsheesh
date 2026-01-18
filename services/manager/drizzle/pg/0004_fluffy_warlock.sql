CREATE TABLE "webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"enabled" boolean NOT NULL,
	"event_types_json" text NOT NULL,
	"created_at" text NOT NULL
);
