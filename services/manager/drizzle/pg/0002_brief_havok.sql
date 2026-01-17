CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" text NOT NULL,
	"expires_at" text,
	"revoked_at" text,
	"last_used_at" text
);
