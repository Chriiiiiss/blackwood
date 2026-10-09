CREATE TYPE "public"."attendance" AS ENUM('yes', 'no', 'to_confirm');--> statement-breakpoint
CREATE TABLE "invitation_responses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"first_name" varchar(50) NOT NULL,
	"attendance" "attendance" NOT NULL,
	"plus_one" boolean NOT NULL,
	"ideas" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "first_name_not_empty" CHECK (length(btrim("invitation_responses"."first_name")) > 0),
	CONSTRAINT "ideas_length" CHECK ("invitation_responses"."ideas" IS NULL OR length("invitation_responses"."ideas") <= 1000),
	CONSTRAINT "absent_without_plus_one" CHECK ("invitation_responses"."attendance" <> 'no' OR NOT "invitation_responses"."plus_one")
);
