CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid,
	"kind" varchar(20) NOT NULL,
	"page" varchar(24) NOT NULL,
	"route" varchar(200),
	"method" varchar(8),
	"status" integer,
	"code" varchar(32),
	"source" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_kind_valid" CHECK ("activity_events"."kind" in ('page_view', 'action', 'api_error', 'client_error', 'network_error'))
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_created_idx" ON "activity_events" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "activity_profile_created_idx" ON "activity_events" USING btree ("profile_id","created_at");