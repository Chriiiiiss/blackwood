CREATE TABLE "organizer_login_limit" (
	"id" integer PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	CONSTRAINT "single_login_limit" CHECK ("organizer_login_limit"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "organizer_sessions" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"credential_fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_activity" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
