ALTER TABLE "grants" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grants_archived_idx" ON "grants" USING btree ("archived_at");