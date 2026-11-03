CREATE POLICY "team_members_insert" ON "team_members" AS PERMISSIVE FOR INSERT TO "gs_app" WITH CHECK (("team_members"."user_id" = app.uid()
          and exists (select 1 from teams tm where tm.id = "team_members"."team_id" and not tm.is_private))
        or exists (select 1 from teams tm where tm.id = "team_members"."team_id" and tm.owner_id = app.uid())
        or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "team_members_update" ON "team_members" AS PERMISSIVE FOR UPDATE TO "gs_app" USING (exists (select 1 from teams tm where tm.id = "team_members"."team_id" and tm.owner_id = app.uid())
        or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "team_members_delete" ON "team_members" AS PERMISSIVE FOR DELETE TO "gs_app" USING ("team_members"."user_id" = app.uid()
        or exists (select 1 from teams tm where tm.id = "team_members"."team_id" and tm.owner_id = app.uid())
        or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "team_messages_read" ON "team_messages" AS PERMISSIVE FOR SELECT TO "gs_app" USING (app.is_team_member("team_messages"."team_id") or app.level() >= 50);--> statement-breakpoint
CREATE POLICY "team_messages_post" ON "team_messages" AS PERMISSIVE FOR INSERT TO "gs_app" WITH CHECK (app.is_team_member("team_messages"."team_id") and "team_messages"."author_id" = app.uid());--> statement-breakpoint
CREATE POLICY "team_messages_own_update" ON "team_messages" AS PERMISSIVE FOR UPDATE TO "gs_app" USING ("team_messages"."author_id" = app.uid());--> statement-breakpoint
CREATE POLICY "team_messages_own_delete" ON "team_messages" AS PERMISSIVE FOR DELETE TO "gs_app" USING ("team_messages"."author_id" = app.uid() or app.level() >= 50);--> statement-breakpoint
ALTER POLICY "team_members_write" ON "team_members" TO gs_app USING ("team_members"."user_id" = app.uid());--> statement-breakpoint
ALTER POLICY "team_messages_members" ON "team_messages" TO gs_app USING (app.is_team_member("team_messages"."team_id")) WITH CHECK  (app.is_team_member("team_messages"."team_id") and "team_messages"."author_id" = app.uid());--> statement-breakpoint
ALTER POLICY "teams_read" ON "teams" TO gs_app USING (not "teams"."is_private" or "teams"."owner_id" = app.uid() or app.is_team_member("teams"."id") or app.level() >= 50);--> statement-breakpoint
ALTER POLICY "teams_owner_write" ON "teams" TO gs_app USING ("teams"."owner_id" = app.uid() or app.level() >= 50) WITH CHECK (app.is_team_member("teams"."id") or app.level() >= 50);