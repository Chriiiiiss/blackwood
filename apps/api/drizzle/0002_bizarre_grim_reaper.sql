CREATE TABLE "companion_invitations" (
	"main_profile_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_profile_id" uuid,
	CONSTRAINT "companion_invitation_token_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "guest_companions" (
	"main_profile_id" uuid PRIMARY KEY NOT NULL,
	"companion_profile_id" uuid NOT NULL,
	CONSTRAINT "guest_companions_companion_profile_id_unique" UNIQUE("companion_profile_id"),
	CONSTRAINT "distinct_companion_profiles" CHECK ("guest_companions"."main_profile_id" <> "guest_companions"."companion_profile_id")
);
--> statement-breakpoint
CREATE TABLE "guest_sessions" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"hub_enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "single_hub_setting" CHECK ("hub_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "profile_response_links" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"response_id" uuid NOT NULL,
	CONSTRAINT "profile_response_links_response_id_unique" UNIQUE("response_id")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"first_name" varchar(50) NOT NULL,
	"role" varchar(9) NOT NULL,
	"avatar_media_id" uuid,
	"legacy_access_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_first_name_not_empty" CHECK (length(btrim("profiles"."first_name")) > 0),
	CONSTRAINT "profile_role" CHECK ("profiles"."role" IN ('main', 'companion'))
);
--> statement-breakpoint
ALTER TABLE "companion_invitations" ADD CONSTRAINT "companion_invitations_main_profile_id_profiles_id_fk" FOREIGN KEY ("main_profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_invitations" ADD CONSTRAINT "companion_invitations_claimed_profile_id_profiles_id_fk" FOREIGN KEY ("claimed_profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_companions" ADD CONSTRAINT "guest_companions_main_profile_id_profiles_id_fk" FOREIGN KEY ("main_profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_companions" ADD CONSTRAINT "guest_companions_companion_profile_id_profiles_id_fk" FOREIGN KEY ("companion_profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_response_links" ADD CONSTRAINT "profile_response_links_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_response_links" ADD CONSTRAINT "profile_response_links_response_id_invitation_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."invitation_responses"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- Backfill links without modifying invitation values or timestamps. Safe to re-run.
WITH missing AS MATERIALIZED (
  SELECT response.id AS response_id, gen_random_uuid() AS profile_id,
    response.first_name, response.created_at, response.updated_at
  FROM invitation_responses AS response
  WHERE NOT EXISTS (
    SELECT 1 FROM profile_response_links AS link WHERE link.response_id = response.id
  )
), inserted AS (
  INSERT INTO profiles (id, first_name, role, created_at, updated_at)
  SELECT profile_id, first_name, 'main', created_at, updated_at FROM missing
  RETURNING id
)
INSERT INTO profile_response_links (profile_id, response_id)
SELECT missing.profile_id, missing.response_id FROM missing
JOIN inserted ON inserted.id = missing.profile_id;
--> statement-breakpoint
INSERT INTO hub_settings (id, hub_enabled) VALUES (1, false) ON CONFLICT (id) DO NOTHING;
