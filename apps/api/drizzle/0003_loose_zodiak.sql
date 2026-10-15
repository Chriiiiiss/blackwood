CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_profile_id" uuid,
	"purpose" varchar(6) NOT NULL,
	"status" varchar(8) NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"thumbnail_width" integer,
	"thumbnail_height" integer,
	"thumbnail_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_purpose" CHECK ("media_assets"."purpose" IN ('avatar', 'photo')),
	CONSTRAINT "media_status" CHECK ("media_assets"."status" IN ('pending', 'staged', 'ready', 'deleting')),
	CONSTRAINT "avatar_owner" CHECK ("media_assets"."purpose" <> 'avatar' OR "media_assets"."owner_profile_id" IS NOT NULL),
	CONSTRAINT "media_dimensions" CHECK ("media_assets"."status" IN ('pending', 'deleting') OR ("media_assets"."width" IS NOT NULL AND "media_assets"."height" IS NOT NULL AND "media_assets"."bytes" IS NOT NULL AND "media_assets"."width" > 0 AND "media_assets"."width" <= 1920 AND "media_assets"."height" > 0 AND "media_assets"."height" <= 1920 AND "media_assets"."bytes" > 0))
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_profile_id_profiles_id_fk" FOREIGN KEY ("owner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_avatar_media_id_media_assets_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;