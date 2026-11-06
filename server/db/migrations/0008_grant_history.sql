CREATE TABLE "grant_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grant_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "series_key" text GENERATED ALWAYS AS (coalesce(funder_id::text, source, '') || '|' || btrim(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(lower(title), '\m(19|20)[0-9]{2}(\s*[/-]\s*(19|20)?[0-9]{2})?\M', ' ', 'g'),
          '\mfy\s*[0-9]{2,4}\M', ' ', 'g'),
        '\m(round|cycle|call|phase|cohort|edition|wave|batch|intake)\s+([0-9]+|[ivx]+)\M', ' \1 ', 'g'),
      '\m[0-9]+(st|nd|rd|th)\M', ' ', 'g'),
    'programme', 'program', 'g'),
  '[^a-z0-9]+', ' ', 'g'))) STORED;--> statement-breakpoint
ALTER TABLE "grant_revisions" ADD CONSTRAINT "grant_revisions_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grant_revisions_grant_idx" ON "grant_revisions" USING btree ("grant_id","captured_at");--> statement-breakpoint
CREATE INDEX "grants_series_idx" ON "grants" USING btree ("series_key");--> statement-breakpoint
CREATE POLICY "grant_revisions_read" ON "grant_revisions" AS PERMISSIVE FOR SELECT TO "gs_app", "gs_worker" USING (true);--> statement-breakpoint
CREATE POLICY "grant_revisions_write_app" ON "grant_revisions" AS PERMISSIVE FOR ALL TO "gs_app" USING (app.level() >= 50);--> statement-breakpoint
CREATE POLICY "grant_revisions_write_worker" ON "grant_revisions" AS PERMISSIVE FOR INSERT TO "gs_worker" WITH CHECK (true);