ALTER TABLE "coffres" DROP CONSTRAINT "single_coffre";--> statement-breakpoint
ALTER TABLE "coffres" ADD CONSTRAINT "coffre_positive_id" CHECK ("coffres"."id" > 0);