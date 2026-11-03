CREATE TYPE "public"."budget_category" AS ENUM('personnel', 'equipment', 'travel', 'materials', 'subcontracts', 'indirect', 'other');--> statement-breakpoint
CREATE TYPE "public"."budget_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TYPE "public"."funder_type" AS ENUM('government', 'foundation', 'corporate', 'international');--> statement-breakpoint
CREATE TYPE "public"."grant_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."match_feedback" AS ENUM('relevant', 'not_relevant');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('deadline', 'new_grant', 'match_alert', 'proposal_update', 'system');--> statement-breakpoint
CREATE TYPE "public"."org_status" AS ENUM('pending', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."org_type" AS ENUM('university', 'research_institute', 'nonprofit', 'company', 'government', 'individual');--> statement-breakpoint
CREATE TYPE "public"."persona" AS ENUM('academic', 'industry', 'student');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'review', 'approved', 'submitted', 'awarded', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."scraper_status" AS ENUM('running', 'ok', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scraper_trigger" AS ENUM('cron', 'manual');--> statement-breakpoint
CREATE TYPE "public"."team_grant_status" AS ENUM('planning', 'draft', 'submitted', 'awarded', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."team_role" AS ENUM('lead', 'member');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('researcher', 'grant_officer', 'institution_admin', 'super_admin');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_level" smallint,
	"org_id" uuid,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"request_id" uuid,
	"ip" "inet",
	"diff" jsonb,
	"prev_hash" "bytea",
	"hash" "bytea"
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"user_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"note" text,
	"remind_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmarks_user_id_grant_id_pk" PRIMARY KEY("user_id","grant_id")
);
--> statement-breakpoint
ALTER TABLE "bookmarks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"category" "budget_category" NOT NULL,
	"description" text,
	"year" smallint DEFAULT 1 NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"org_id" uuid,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"status" "budget_status" DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "funders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" "funder_type" NOT NULL,
	"website" text,
	"scrape_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funders_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "funders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "grant_matches" (
	"user_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"score" smallint NOT NULL,
	"similarity" real,
	"rationale" text,
	"breakdown" jsonb,
	"model" text,
	"feedback" "match_feedback",
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grant_matches_user_id_grant_id_pk" PRIMARY KEY("user_id","grant_id")
);
--> statement-breakpoint
ALTER TABLE "grant_matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"funder_id" uuid,
	"title" text NOT NULL,
	"subject" text,
	"category" text,
	"description" text DEFAULT '' NOT NULL,
	"objectives" text,
	"required_outcomes" text,
	"scope" text,
	"amount" numeric(14, 2),
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"deadline" date,
	"eligible_regions" text[] DEFAULT '{}'::text[] NOT NULL,
	"eligible_org_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "grant_status" DEFAULT 'active' NOT NULL,
	"source" text,
	"url" text NOT NULL,
	"content_hash" "bytea",
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"embedding" vector(768),
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(subject, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'C')) STORED,
	"scraped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grants_legacy_id_unique" UNIQUE("legacy_id"),
	CONSTRAINT "grants_url_unique" UNIQUE("url")
);
--> statement-breakpoint
ALTER TABLE "grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"grant_id" uuid,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "org_type" DEFAULT 'university' NOT NULL,
	"region" text,
	"invite_code" text,
	"status" "org_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "proposal_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"proposal_id" uuid NOT NULL,
	"actor_id" uuid,
	"from_status" "proposal_status",
	"to_status" "proposal_status" NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposal_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"org_id" uuid,
	"owner_id" uuid NOT NULL,
	"grant_id" uuid,
	"title" text NOT NULL,
	"status" "proposal_status" DEFAULT 'draft' NOT NULL,
	"body" jsonb,
	"notes" text,
	"requested_amount" numeric(14, 2),
	"deadline" date,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposals_legacy_id_unique" UNIQUE("legacy_id")
);
--> statement-breakpoint
ALTER TABLE "proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid,
	"user_agent" text,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "scraper_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" "scraper_trigger" NOT NULL,
	"source" text,
	"status" "scraper_status" DEFAULT 'running' NOT NULL,
	"items_found" integer DEFAULT 0 NOT NULL,
	"items_new" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "scraper_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "team_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"shared_by" uuid,
	"notes" text,
	"status" "team_grant_status" DEFAULT 'planning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "team_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "team_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"name" text NOT NULL,
	"description" text,
	"owner_id" uuid NOT NULL,
	"is_private" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_legacy_id_unique" UNIQUE("legacy_id")
);
--> statement-breakpoint
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"email" "citext" NOT NULL,
	"password_hash" text,
	"role" "user_role" DEFAULT 'researcher' NOT NULL,
	"org_id" uuid,
	"name" text NOT NULL,
	"persona" "persona" DEFAULT 'academic' NOT NULL,
	"region" text,
	"research_interests" text[] DEFAULT '{}'::text[] NOT NULL,
	"collaboration_interests" text[] DEFAULT '{}'::text[] NOT NULL,
	"qualifications" text,
	"funding_needs_min" numeric(14, 2),
	"past_projects" text,
	"past_publications" text,
	"project_descriptions" text,
	"team_members" text,
	"is_public_profile" boolean DEFAULT false NOT NULL,
	"profile_embedding" vector(768),
	"token_version" integer DEFAULT 0 NOT NULL,
	"failed_logins" smallint DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_legacy_id_unique" UNIQUE("legacy_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_matches" ADD CONSTRAINT "grant_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_matches" ADD CONSTRAINT "grant_matches_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_funder_id_funders_id_fk" FOREIGN KEY ("funder_id") REFERENCES "public"."funders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_events" ADD CONSTRAINT "proposal_events_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_events" ADD CONSTRAINT "proposal_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_grants" ADD CONSTRAINT "team_grants_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_grants" ADD CONSTRAINT "team_grants_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_grants" ADD CONSTRAINT "team_grants_shared_by_users_id_fk" FOREIGN KEY ("shared_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_org_idx" ON "audit_log" USING btree ("org_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "budget_lines_budget_idx" ON "budget_lines" USING btree ("budget_id");--> statement-breakpoint
CREATE INDEX "budgets_proposal_idx" ON "budgets" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "grant_matches_user_score_idx" ON "grant_matches" USING btree ("user_id","score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "grants_deadline_idx" ON "grants" USING btree ("deadline");--> statement-breakpoint
CREATE INDEX "grants_status_idx" ON "grants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "grants_funder_idx" ON "grants" USING btree ("funder_id");--> statement-breakpoint
CREATE INDEX "grants_regions_idx" ON "grants" USING gin ("eligible_regions");--> statement-breakpoint
CREATE INDEX "grants_search_idx" ON "grants" USING gin ("search");--> statement-breakpoint
CREATE INDEX "grants_embedding_idx" ON "grants" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "proposal_events_proposal_idx" ON "proposal_events" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "proposals_owner_idx" ON "proposals" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "proposals_org_status_idx" ON "proposals" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scraper_runs_started_idx" ON "scraper_runs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "team_grants_team_grant_uq" ON "team_grants" USING btree ("team_id","grant_id");--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "team_messages_team_idx" ON "team_messages" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("org_id");--> statement-breakpoint
CREATE POLICY "audit_log_insert" ON "audit_log" AS PERMISSIVE FOR INSERT TO "gs_app", "gs_worker" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "audit_log_read" ON "audit_log" AS PERMISSIVE FOR SELECT TO "gs_app" USING ("audit_log"."actor_id" = app.uid()
        or ("audit_log"."org_id" = app.org() and app.level() >= 30)
        or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "bookmarks_owner" ON "bookmarks" AS PERMISSIVE FOR ALL TO "gs_app" USING ("bookmarks"."user_id" = app.uid() or app.level() >= 50) WITH CHECK ("bookmarks"."user_id" = app.uid());--> statement-breakpoint
CREATE POLICY "budget_lines_via_budget" ON "budget_lines" AS PERMISSIVE FOR ALL TO "gs_app" USING (exists (select 1 from budgets b where b.id = "budget_lines"."budget_id"));--> statement-breakpoint
CREATE POLICY "budgets_via_proposal" ON "budgets" AS PERMISSIVE FOR ALL TO "gs_app" USING (exists (select 1 from proposals p where p.id = "budgets"."proposal_id"));--> statement-breakpoint
CREATE POLICY "funders_read" ON "funders" AS PERMISSIVE FOR SELECT TO "gs_app", "gs_worker" USING (true);--> statement-breakpoint
CREATE POLICY "funders_write" ON "funders" AS PERMISSIVE FOR ALL TO "gs_app" USING (app.level() >= 50);--> statement-breakpoint
CREATE POLICY "grant_matches_owner" ON "grant_matches" AS PERMISSIVE FOR ALL TO "gs_app" USING ("grant_matches"."user_id" = app.uid() or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "grant_matches_worker" ON "grant_matches" AS PERMISSIVE FOR ALL TO "gs_worker" USING (true);--> statement-breakpoint
CREATE POLICY "grants_read" ON "grants" AS PERMISSIVE FOR SELECT TO "gs_app", "gs_worker" USING (true);--> statement-breakpoint
CREATE POLICY "grants_write_app" ON "grants" AS PERMISSIVE FOR ALL TO "gs_app" USING (app.level() >= 50);--> statement-breakpoint
CREATE POLICY "grants_write_worker" ON "grants" AS PERMISSIVE FOR ALL TO "gs_worker" USING (true);--> statement-breakpoint
CREATE POLICY "notifications_owner" ON "notifications" AS PERMISSIVE FOR ALL TO "gs_app" USING ("notifications"."user_id" = app.uid() or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "notifications_org_insert" ON "notifications" AS PERMISSIVE FOR INSERT TO "gs_app" WITH CHECK (app.level() >= 30
        and exists (select 1 from users u where u.id = "notifications"."user_id" and u.org_id = app.org()));--> statement-breakpoint
CREATE POLICY "notifications_worker" ON "notifications" AS PERMISSIVE FOR INSERT TO "gs_worker" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "organizations_read" ON "organizations" AS PERMISSIVE FOR SELECT TO "gs_app" USING ("organizations"."id" = app.org() or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "organizations_write" ON "organizations" AS PERMISSIVE FOR ALL TO "gs_app" USING (("organizations"."id" = app.org() and app.level() >= 40) or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "proposal_events_via_proposal" ON "proposal_events" AS PERMISSIVE FOR ALL TO "gs_app" USING (exists (select 1 from proposals p where p.id = "proposal_events"."proposal_id"));--> statement-breakpoint
CREATE POLICY "proposals_access" ON "proposals" AS PERMISSIVE FOR ALL TO "gs_app" USING ("proposals"."owner_id" = app.uid()
        or ("proposals"."org_id" = app.org() and app.level() >= 30)
        or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "refresh_tokens_system" ON "refresh_tokens" AS PERMISSIVE FOR ALL TO "gs_app" USING (app.level() >= 100);--> statement-breakpoint
CREATE POLICY "scraper_runs_admin" ON "scraper_runs" AS PERMISSIVE FOR ALL TO "gs_app" USING (app.level() >= 50);--> statement-breakpoint
CREATE POLICY "scraper_runs_worker" ON "scraper_runs" AS PERMISSIVE FOR ALL TO "gs_worker" USING (true);--> statement-breakpoint
CREATE POLICY "team_grants_members" ON "team_grants" AS PERMISSIVE FOR ALL TO "gs_app" USING (app.is_team_member("team_grants"."team_id"));--> statement-breakpoint
CREATE POLICY "team_members_read" ON "team_members" AS PERMISSIVE FOR SELECT TO "gs_app" USING (app.is_team_member("team_members"."team_id") or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "team_members_write" ON "team_members" AS PERMISSIVE FOR ALL TO "gs_app" USING ("team_members"."user_id" = app.uid()
        or exists (select 1 from teams tm where tm.id = "team_members"."team_id" and tm.owner_id = app.uid())
        or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "team_messages_members" ON "team_messages" AS PERMISSIVE FOR ALL TO "gs_app" USING (app.is_team_member("team_messages"."team_id")) WITH CHECK (app.is_team_member("team_messages"."team_id") and "team_messages"."author_id" = app.uid());--> statement-breakpoint
CREATE POLICY "teams_read" ON "teams" AS PERMISSIVE FOR SELECT TO "gs_app" USING (not "teams"."is_private" or app.is_team_member("teams"."id") or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "teams_insert" ON "teams" AS PERMISSIVE FOR INSERT TO "gs_app" WITH CHECK ("teams"."owner_id" = app.uid());--> statement-breakpoint
CREATE POLICY "teams_owner_write" ON "teams" AS PERMISSIVE FOR UPDATE TO "gs_app" USING ("teams"."owner_id" = app.uid() or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "teams_owner_delete" ON "teams" AS PERMISSIVE FOR DELETE TO "gs_app" USING ("teams"."owner_id" = app.uid() or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "users_read" ON "users" AS PERMISSIVE FOR SELECT TO "gs_app" USING ("users"."id" = app.uid()
        or ("users"."org_id" = app.org() and app.level() >= 30)
        or ("users"."is_public_profile" and app.level() >= 20)
        or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "users_update" ON "users" AS PERMISSIVE FOR UPDATE TO "gs_app" USING ("users"."id" = app.uid()
        or ("users"."org_id" = app.org() and app.level() >= 40)
        or app.level() >= 50) WITH CHECK ("users"."id" = app.uid()
        or (("users"."org_id" = app.org() or "users"."org_id" is null) and app.level() >= 40)
        or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "users_insert" ON "users" AS PERMISSIVE FOR INSERT TO "gs_app" WITH CHECK (app.level() >= 50);--> statement-breakpoint
CREATE POLICY "users_worker_read" ON "users" AS PERMISSIVE FOR SELECT TO "gs_worker" USING (true);--> statement-breakpoint
CREATE POLICY "users_worker_embed" ON "users" AS PERMISSIVE FOR UPDATE TO "gs_worker" USING (true);