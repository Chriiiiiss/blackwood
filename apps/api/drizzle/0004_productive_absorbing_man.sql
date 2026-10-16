CREATE TABLE "guest_code_login_limits" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	CONSTRAINT "positive_guest_code_attempts" CHECK ("guest_code_login_limits"."attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "guest_codes" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "guest_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "guest_codes" ADD CONSTRAINT "guest_codes_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;