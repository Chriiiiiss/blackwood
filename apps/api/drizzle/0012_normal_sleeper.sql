CREATE TABLE "guest_code_reservations" (
	"code_hash" varchar(64) PRIMARY KEY NOT NULL
);

--> statement-breakpoint
INSERT INTO "guest_code_reservations" ("code_hash") SELECT "code_hash" FROM "guest_codes" ON CONFLICT DO NOTHING;
