ALTER TABLE "grants" ADD COLUMN "open_to_africa" boolean;--> statement-breakpoint
-- Grants.gov calls were all stored as "United States"; clear their content hash so the next harvest re-reads them and works out who can apply.
UPDATE "grants" SET "content_hash" = NULL WHERE "source" LIKE 'Grants.gov%';
