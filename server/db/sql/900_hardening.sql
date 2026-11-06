-- Runs AFTER the drizzle-kit migrations. Idempotent.
--
-- Tables are owned by the migration role, never by gs_app/gs_worker, so RLS
-- applies to both without FORCE ROW LEVEL SECURITY. FORCE is deliberately
-- not used: it would also bind the owner and break owner-run migrations and
-- the audit hash trigger below.

/* ---------------------------------------------------------------- */
/* Privileges                                                        */
/* ---------------------------------------------------------------- */

GRANT USAGE ON SCHEMA public TO gs_app, gs_worker;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gs_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gs_app, gs_worker;

-- The worker: catalogue and matching writes, profile reads, nothing else.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM gs_worker;
GRANT SELECT ON funders TO gs_worker;
-- Structured profiles: scored against new grants. Never the uploaded documents.
GRANT SELECT ON applicant_profiles TO gs_worker;
GRANT SELECT, INSERT, UPDATE ON grants, grant_matches, scraper_runs TO gs_worker;
-- History: earlier versions of a call, saved before a re-scrape overwrites it.
GRANT SELECT, INSERT ON grant_revisions TO gs_worker;
GRANT INSERT ON notifications, audit_log TO gs_worker;
-- Matching inputs only: never email, password or session fields.
GRANT SELECT (id, org_id, role, persona, region, research_interests, qualifications,
              funding_needs_min, past_projects, past_publications, project_descriptions,
              profile_embedding, email_verified_at, suspended_at)
  ON users TO gs_worker;
GRANT UPDATE (profile_embedding) ON users TO gs_worker;

/* ---------------------------------------------------------------- */
/* Append-only, hash-chained audit log                               */
/* ---------------------------------------------------------------- */

REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM gs_app, gs_worker;

-- The one definition of a row's hash, used by the trigger below and by
-- GET /api/admin/audit/verify. Every field is rendered explicitly
-- (timestamp in UTC, fixed format), so the result never depends on the
-- session's TimeZone or DateStyle. Empty markers keep NULL distinct from
-- an empty string, which concat_ws alone would not.
CREATE OR REPLACE FUNCTION app.audit_row_hash(p_prev bytea, r audit_log) RETURNS bytea
  LANGUAGE sql IMMUTABLE
  SET search_path = public, pg_temp
  AS $$
  SELECT digest(
    coalesce(p_prev, '\x'::bytea) || convert_to(concat_ws('|',
      r.id::text,
      to_char(r.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      coalesce(r.actor_id::text, '∅'),
      coalesce(r.actor_level::text, '∅'),
      coalesce(r.org_id::text, '∅'),
      r.action,
      coalesce(r.entity, '∅'),
      coalesce(r.entity_id, '∅'),
      coalesce(r.request_id::text, '∅'),
      coalesce(host(r.ip), '∅'),
      coalesce(r.diff::text, '∅')
    ), 'UTF8'),
    'sha256'
  )
$$;
GRANT EXECUTE ON FUNCTION app.audit_row_hash(bytea, audit_log) TO gs_app;

-- SECURITY DEFINER: the previous row must be read past RLS, otherwise each
-- user would chain onto the last row *they* can see.
CREATE OR REPLACE FUNCTION app.audit_log_chain() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  v_prev bytea;
BEGIN
  -- Serialise writers so two inserts never chain onto the same parent.
  PERFORM pg_advisory_xact_lock(hashtext('audit_log_chain'));

  SELECT hash INTO v_prev FROM audit_log ORDER BY id DESC LIMIT 1;

  NEW.prev_hash := v_prev;
  NEW.hash := app.audit_row_hash(v_prev, NEW);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.audit_log_immutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS audit_log_chain ON audit_log;
CREATE TRIGGER audit_log_chain
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION app.audit_log_chain();

DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log;
CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION app.audit_log_immutable();

DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION app.audit_log_immutable();

/* ---------------------------------------------------------------- */
/* Privilege-escalation guard on users                               */
/* ---------------------------------------------------------------- */

-- RLS decides which user rows a session may update; this decides which
-- columns. It holds even if a route forgets a check:
--   * email, password, lockout and token_version: auth service only
--     (withSystemTx, level 100), or a super admin for token_version and
--     suspension;
--   * role and org_id: never on your own row; institution admins only
--     within their org and only among researcher/grant_officer; super
--     admins anywhere.
-- Owner sessions (migrations) are not gs_app/gs_worker and pass through.
CREATE OR REPLACE FUNCTION app.users_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_level integer := app.level();
BEGIN
  IF current_user NOT IN ('gs_app', 'gs_worker') OR v_level >= 100 THEN
    RETURN NEW;
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email
     OR NEW.password_hash IS DISTINCT FROM OLD.password_hash
     OR NEW.failed_logins IS DISTINCT FROM OLD.failed_logins
     OR NEW.locked_until IS DISTINCT FROM OLD.locked_until
     OR NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at THEN
    RAISE EXCEPTION 'credential fields change only through the auth service'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF (NEW.token_version IS DISTINCT FROM OLD.token_version
      OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at)
     AND v_level < 50 THEN
    RAISE EXCEPTION 'only a super admin may suspend users or revoke their sessions'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    IF OLD.id = app.uid() THEN
      RAISE EXCEPTION 'you cannot change your own role or organisation'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_level < 50 AND NOT (
         v_level >= 40
         AND OLD.org_id = app.org()
         AND (NEW.org_id = app.org() OR NEW.org_id IS NULL)
         AND OLD.role IN ('researcher', 'grant_officer')
         AND NEW.role IN ('researcher', 'grant_officer')
       ) THEN
      RAISE EXCEPTION 'role or organisation change not permitted for this tier'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_guard ON users;
CREATE TRIGGER users_guard
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION app.users_guard();

/* ---------------------------------------------------------------- */
/* Display names past RLS, narrowly                                  */
/* ---------------------------------------------------------------- */

-- A researcher cannot read other users' rows, yet should see who approved
-- their proposal or who wrote in their team chat. This returns the name
-- only (no email or profile), and only for yourself, members of your
-- organisation, people you share a team with, public profiles, or to a
-- super admin. Anyone else's id yields NULL.
CREATE OR REPLACE FUNCTION app.display_name(p_user uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  SELECT u.name FROM users u
   WHERE u.id = p_user
     AND (u.id = app.uid()
          OR (u.org_id IS NOT NULL AND u.org_id = app.org())
          OR u.is_public_profile
          OR EXISTS (SELECT 1 FROM team_members a
                       JOIN team_members b ON b.team_id = a.team_id
                      WHERE a.user_id = app.uid() AND b.user_id = p_user)
          OR app.level() >= 50)
$$;

-- An organisation's name for display (collaborator directory). Only
-- active organisations, and never the invite code or anything else.
CREATE OR REPLACE FUNCTION app.org_display_name(p_org uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  SELECT name FROM organizations WHERE id = p_org AND status = 'active'
$$;
REVOKE ALL ON FUNCTION app.org_display_name(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.org_display_name(uuid) TO gs_app;

-- How many people are in a team, for a team the caller can see (public,
-- or one they belong to). Member identities stay behind team_members RLS.
CREATE OR REPLACE FUNCTION app.team_member_count(p_team uuid) RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  SELECT count(*)::int FROM team_members m
   WHERE m.team_id = p_team
     AND EXISTS (SELECT 1 FROM teams t
                  WHERE t.id = p_team
                    AND (NOT t.is_private OR app.is_team_member(p_team) OR app.level() >= 50))
$$;
REVOKE ALL ON FUNCTION app.team_member_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.team_member_count(uuid) TO gs_app;
REVOKE ALL ON FUNCTION app.display_name(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.display_name(uuid) TO gs_app;

/* ---------------------------------------------------------------- */
/* Removing a member from an organisation                            */
/* ---------------------------------------------------------------- */

-- RLS checks an UPDATE's new row against the SELECT policy too, and once
-- org_id is NULL the institution admin can no longer see that row, so the
-- removal cannot be a plain UPDATE. This function does it with the same
-- rules users_guard applies: caller at institution_admin or above, never
-- yourself, same organisation, target no higher than grant_officer unless
-- the caller is a super admin. Returns false when no such member exists.
CREATE OR REPLACE FUNCTION app.remove_org_member(p_user uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF app.level() < 40 THEN
    RAISE EXCEPTION 'removing members needs institution_admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_user = app.uid() THEN
    RAISE EXCEPTION 'you cannot remove yourself' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE users
     SET org_id = NULL, role = 'researcher', updated_at = now()
   WHERE id = p_user
     AND org_id = app.org()
     AND (role IN ('researcher', 'grant_officer') OR app.level() >= 50);
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION app.remove_org_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.remove_org_member(uuid) TO gs_app;

/* ---------------------------------------------------------------- */
/* Housekeeping for the harvester                                    */
/* ---------------------------------------------------------------- */

-- The worker has no access to refresh_tokens; this deletes only expired
-- rows. Used and revoked tokens stay until they expire: reuse detection
-- needs them to recognise a stolen token replayed later and revoke its
-- whole family. Returns the count.
CREATE OR REPLACE FUNCTION app.purge_expired_refresh_tokens() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM refresh_tokens WHERE expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  -- Password reset links are single-use and short-lived; keep a day for audit questions.
  DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '1 day';
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION app.purge_expired_refresh_tokens() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_expired_refresh_tokens() TO gs_worker;

/* ---------------------------------------------------------------- */
/* Live dashboard: tell the API when catalogue data changes          */
/* ---------------------------------------------------------------- */

-- Statement-level, so a harvest batch sends one notice per statement and
-- Postgres folds identical notices within a transaction. The API debounces
-- and pushes a "changed" event to open dashboards (GET /api/grants/live).
CREATE OR REPLACE FUNCTION app.notify_grants_changed() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  PERFORM pg_notify('grants_changed', TG_TABLE_NAME);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS grants_changed_notify ON grants;
CREATE TRIGGER grants_changed_notify AFTER INSERT OR UPDATE OR DELETE ON grants
  FOR EACH STATEMENT EXECUTE FUNCTION app.notify_grants_changed();
DROP TRIGGER IF EXISTS grant_matches_changed_notify ON grant_matches;
CREATE TRIGGER grant_matches_changed_notify AFTER INSERT OR UPDATE OR DELETE ON grant_matches
  FOR EACH STATEMENT EXECUTE FUNCTION app.notify_grants_changed();
DROP TRIGGER IF EXISTS scraper_runs_changed_notify ON scraper_runs;
CREATE TRIGGER scraper_runs_changed_notify AFTER INSERT OR UPDATE ON scraper_runs
  FOR EACH STATEMENT EXECUTE FUNCTION app.notify_grants_changed();
