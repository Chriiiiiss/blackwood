CREATE TABLE "spotify_connection" (
	"id" integer PRIMARY KEY NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"encrypted_tokens" text,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spotify_connection_singleton" CHECK ("spotify_connection"."id" = 1)
);
