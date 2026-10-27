CREATE TABLE "tv_pairing" (
	"id" integer PRIMARY KEY NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	CONSTRAINT "single_tv_pairing" CHECK ("tv_pairing"."id" = 1),
	CONSTRAINT "tv_pairing_attempts" CHECK ("tv_pairing"."attempts" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE TABLE "tv_sessions" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
