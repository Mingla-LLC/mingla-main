-- ===========================================================================
-- #3969 — tighten profile read and write access (server only, no app change)
--
-- 1. public.profiles is for signed-in callers only.
--    - `anon` loses every privilege on the table.
--    - The SELECT policy "Profiles viewable except by blocked users" is scoped
--      to `authenticated`; its USING expression is unchanged, so what a
--      signed-in caller can see is identical to before.
--
-- 2. profiles.phone is written by the server, after verification.
--    A BEFORE UPDATE OF phone trigger refuses a change to `phone` when the
--    statement runs as a client role (`authenticated` / `anon`), unless the
--    signed-in caller is an active admin (the admin console's user editor
--    already edits this field). The server paths keep working:
--      - verify-otp / send-otp use the service role (current_user = service_role);
--      - SECURITY DEFINER functions run as their owner;
--      - other own-row updates by a signed-in user are untouched, and an update
--        that re-sends the same phone value is not a change.
--    The AFTER UPDATE triggers that act on a phone change still fire on every
--    accepted change.
--
-- Baseline captured from production (gqnoajqerqhnvulmnyvv) on 2026-10-19 before
-- writing this file; the repo baseline (20260505000000) matches it for both the
-- policy and the table grants.
-- ===========================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ── 1. Reads and writes: signed-in callers only ────────────────────────────
-- Revoking the table privileges also revokes the per-column privileges.
REVOKE ALL ON TABLE public.profiles FROM anon;

ALTER POLICY "Profiles viewable except by blocked users"
  ON public.profiles
  TO authenticated;

-- ── 2. profiles.phone is set by the server ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3969_profiles_phone_server_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.phone IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NEW;
  END IF;

  -- current_user is the role the statement runs as: `service_role` for the
  -- server, the function owner inside SECURITY DEFINER code, and
  -- `authenticated` / `anon` for a direct client request.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF current_user = 'authenticated' AND public.is_admin_user() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'profiles.phone can only be changed through phone verification'
    USING ERRCODE = '42501',
          HINT = 'Verify the number with the send-otp / verify-otp flow.';
END;
$function$;

COMMENT ON FUNCTION public.issue_3969_profiles_phone_server_only() IS
  'issue #3969 — BEFORE UPDATE OF phone on public.profiles: a client role may '
  'not change phone (active admins excepted); the server sets it after verification.';

REVOKE ALL ON FUNCTION public.issue_3969_profiles_phone_server_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_3969_profiles_phone_server_only ON public.profiles;
CREATE TRIGGER issue_3969_profiles_phone_server_only
  BEFORE UPDATE OF phone ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.issue_3969_profiles_phone_server_only();

COMMIT;

-- ===========================================================================
-- ROLLBACK (restores the production state captured on 2026-10-19)
--
-- BEGIN;
-- SET LOCAL lock_timeout = '3s';
-- DROP TRIGGER IF EXISTS issue_3969_profiles_phone_server_only ON public.profiles;
-- DROP FUNCTION IF EXISTS public.issue_3969_profiles_phone_server_only();
-- ALTER POLICY "Profiles viewable except by blocked users"
--   ON public.profiles
--   TO public;
-- -- captured: roles {public}, cmd SELECT,
-- --   USING ((auth.uid() = id) OR (NOT is_blocked_by(id, auth.uid())))
-- GRANT ALL ON TABLE public.profiles TO anon;
-- -- captured: anon held DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE,
-- --   UPDATE at table level (ACL anon=arwdDxtm/postgres), which also yields
-- --   SELECT, INSERT, UPDATE, REFERENCES on all 38 columns.
-- COMMIT;
-- ===========================================================================
