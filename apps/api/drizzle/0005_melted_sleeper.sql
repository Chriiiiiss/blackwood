CREATE TABLE "coffre_contributions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"coffre_id" integer NOT NULL,
	"author_profile_id" uuid,
	"text" text,
	"photo_media_id" uuid,
	"visibility" varchar(7) NOT NULL,
	"frame_id" varchar(32) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "coffre_contributions_photo_media_id_unique" UNIQUE("photo_media_id"),
	CONSTRAINT "contribution_visibility" CHECK ("coffre_contributions"."visibility" IN ('public', 'private')),
	CONSTRAINT "contribution_frame" CHECK ("coffre_contributions"."frame_id" IN ('plain', 'one-wish-willow')),
	CONSTRAINT "contribution_text_length" CHECK ("coffre_contributions"."text" IS NULL OR (length("coffre_contributions"."text") <= 500 AND length(btrim("coffre_contributions"."text")) > 0)),
	CONSTRAINT "contribution_content" CHECK (("coffre_contributions"."deleted_at" IS NULL AND ("coffre_contributions"."text" IS NOT NULL OR "coffre_contributions"."photo_media_id" IS NOT NULL)) OR ("coffre_contributions"."deleted_at" IS NOT NULL AND "coffre_contributions"."text" IS NULL AND "coffre_contributions"."photo_media_id" IS NULL)),
	CONSTRAINT "willow_text_only" CHECK ("coffre_contributions"."frame_id" <> 'one-wish-willow' OR "coffre_contributions"."photo_media_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "coffres" (
	"id" integer PRIMARY KEY NOT NULL,
	"duration_seconds" integer NOT NULL,
	"started_at" timestamp with time zone,
	"deadline" timestamp with time zone,
	CONSTRAINT "single_coffre" CHECK ("coffres"."id" = 1),
	CONSTRAINT "coffre_duration" CHECK ("coffres"."duration_seconds" BETWEEN 1 AND 604800),
	CONSTRAINT "coffre_timing" CHECK (("coffres"."started_at" IS NULL AND "coffres"."deadline" IS NULL) OR ("coffres"."started_at" IS NOT NULL AND "coffres"."deadline" IS NOT NULL AND "coffres"."deadline" = "coffres"."started_at" + "coffres"."duration_seconds" * interval '1 second'))
);
--> statement-breakpoint
ALTER TABLE "coffre_contributions" ADD CONSTRAINT "coffre_contributions_coffre_id_coffres_id_fk" FOREIGN KEY ("coffre_id") REFERENCES "public"."coffres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coffre_contributions" ADD CONSTRAINT "coffre_contributions_author_profile_id_profiles_id_fk" FOREIGN KEY ("author_profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coffre_contributions" ADD CONSTRAINT "coffre_contributions_photo_media_id_media_assets_id_fk" FOREIGN KEY ("photo_media_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contribution_public_page" ON "coffre_contributions" USING btree ("coffre_id","visibility","id") WHERE "coffre_contributions"."deleted_at" IS NULL;