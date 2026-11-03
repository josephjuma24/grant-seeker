CREATE TYPE "public"."applicant_type" AS ENUM('individual', 'organisation');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('cv', 'publications', 'proposal', 'org_profile', 'annual_report', 'other');--> statement-breakpoint
CREATE TYPE "public"."match_eligibility" AS ENUM('eligible', 'check', 'ineligible');--> statement-breakpoint
CREATE TABLE "applicant_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"applicant_type" "applicant_type",
	"data" jsonb NOT NULL,
	"completeness" smallint DEFAULT 0 NOT NULL,
	"extracted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applicant_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profile_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" "bytea" NOT NULL,
	"pages" smallint,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "grant_matches" ADD COLUMN "fit" jsonb;--> statement-breakpoint
ALTER TABLE "grant_matches" ADD COLUMN "eligibility" "match_eligibility";--> statement-breakpoint
ALTER TABLE "applicant_profiles" ADD CONSTRAINT "applicant_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_documents" ADD CONSTRAINT "profile_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_documents_user_sha_uq" ON "profile_documents" USING btree ("user_id","sha256");--> statement-breakpoint
CREATE POLICY "applicant_profiles_owner" ON "applicant_profiles" AS PERMISSIVE FOR ALL TO "gs_app" USING ("applicant_profiles"."user_id" = app.uid() or app.level() >= 50) WITH CHECK ("applicant_profiles"."user_id" = app.uid() or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "applicant_profiles_worker_read" ON "applicant_profiles" AS PERMISSIVE FOR SELECT TO "gs_worker" USING (true);--> statement-breakpoint
CREATE POLICY "profile_documents_owner" ON "profile_documents" AS PERMISSIVE FOR ALL TO "gs_app" USING ("profile_documents"."user_id" = app.uid() or app.level() >= 50) WITH CHECK ("profile_documents"."user_id" = app.uid());