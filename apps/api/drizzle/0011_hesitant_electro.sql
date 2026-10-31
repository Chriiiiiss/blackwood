CREATE TABLE "mission_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"mission_key" varchar(40) NOT NULL,
	"text" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "mission_once_per_profile" UNIQUE("profile_id","mission_key")
);
--> statement-breakpoint
CREATE TABLE "mission_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assignment_id" uuid NOT NULL,
	"recipient_profile_id" uuid NOT NULL,
	"status" varchar(9) NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "mission_claim_status" CHECK ("mission_claims"."status" IN ('pending', 'confirmed', 'rejected', 'cancelled')),
	CONSTRAINT "mission_claim_decision" CHECK (("mission_claims"."status" = 'pending' AND "mission_claims"."decided_at" IS NULL) OR ("mission_claims"."status" <> 'pending' AND "mission_claims"."decided_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "mission_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"show_scores_with_memories" boolean DEFAULT false NOT NULL,
	CONSTRAINT "single_mission_setting" CHECK ("mission_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "mission_assignments" ADD CONSTRAINT "mission_assignments_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_claims" ADD CONSTRAINT "mission_claims_assignment_id_mission_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."mission_assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_claims" ADD CONSTRAINT "mission_claims_recipient_profile_id_profiles_id_fk" FOREIGN KEY ("recipient_profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_current_mission" ON "mission_assignments" USING btree ("profile_id") WHERE "mission_assignments"."completed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "one_pending_mission_claim" ON "mission_claims" USING btree ("assignment_id") WHERE "mission_claims"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "one_confirmed_mission_claim" ON "mission_claims" USING btree ("assignment_id") WHERE "mission_claims"."status" = 'confirmed';--> statement-breakpoint
CREATE INDEX "mission_incoming_claims" ON "mission_claims" USING btree ("recipient_profile_id","status");