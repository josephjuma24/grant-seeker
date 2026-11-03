-- Runs BEFORE the drizzle-kit migrations: the policies in schema.ts reference
-- these roles and functions. Idempotent; executed by db/migrate.ts as the
-- database owner.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;

-- Login roles. Passwords are set out of band:
--   ALTER ROLE gs_app PASSWORD '...';
-- Neither role owns tables nor has BYPASSRLS, so policies always apply.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gs_app') THEN
    CREATE ROLE gs_app LOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gs_worker') THEN
    CREATE ROLE gs_worker LOGIN NOBYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO gs_app, gs_worker;

-- Session identity, written per transaction by withUserTx()/withSystemTx()
-- via set_config(..., is_local => true). Empty or unset means anonymous.
CREATE OR REPLACE FUNCTION app.uid() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.org() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.level() RETURNS integer
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(nullif(current_setting('app.level', true), '')::integer, 0) $$;

-- SECURITY DEFINER so team policies can check membership without the
-- team_members policy recursing into itself. plpgsql defers the table
-- lookup until call time, so this can be created before team_members exists.
CREATE OR REPLACE FUNCTION app.is_team_member(p_team uuid) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.team_members
    WHERE team_id = p_team AND user_id = app.uid()
  );
END $$;

REVOKE ALL ON FUNCTION app.is_team_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.uid(), app.org(), app.level(), app.is_team_member(uuid)
  TO gs_app, gs_worker;
