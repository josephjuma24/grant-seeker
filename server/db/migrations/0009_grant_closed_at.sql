ALTER TABLE "grants" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
-- Calls closed before closed_at existed: closed on their deadline, else when last updated.
UPDATE "grants" SET "closed_at" = coalesce("deadline"::timestamptz, "updated_at") WHERE "status" = 'closed' AND "closed_at" IS NULL;
