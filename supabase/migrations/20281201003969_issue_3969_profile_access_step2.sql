-- ===========================================================================
-- #3969 Step 2 — profile access, server step (additive; no app change needed)
--
-- Every installed app keeps working after this file: nothing a current client
-- reads or writes is taken away. It narrows what a signed-in caller can do to
-- profiles beyond their own normal edits, and adds the read paths the next app
-- release moves to.
--
-- 1. Table privileges a client never uses are removed from public.profiles
--    (TRUNCATE, TRIGGER, REFERENCES, DELETE). RLS already allows no client
--    DELETE; the server keeps every privilege.
-- 2. The profiles_with_segment view is server-only (no app reads it).
-- 3. Account-control fields on a profile are set by the server. A signed-in
--    caller (non-admin) cannot change is_beta_tester, is_seed, account_type,
--    email_verified, referral_code or active on their row; email may only be
--    set to the caller's own sign-in email; explorer_deleted_at may only be
--    cleared (reactivation). A new own row cannot start with those fields set.
--    Same idiom as Step 1's phone guard: service role, SECURITY DEFINER code
--    and active admins are not affected, and re-sending a stored value is not
--    a change.
-- 4. get_my_profile(): the caller's own full row.
-- 5. issue_3969_resolve_person(text): find a person by email, username or id;
--    returns no contact fields.
-- 6. resolve_user_visibility_by_identifier(text): same signature and result
--    shape (installed apps call it); signed-in callers only; email is returned
--    only when the caller looked the person up by that email; matching is
--    deterministic.
-- 7. issue_3969_pair_partner_details(uuid[]): names and avatars for the given
--    people; birthday and gender only for people paired with the caller or in
--    a pending pair request with the caller.
--    issue_3969_friend_profile(uuid): the profile sheet fields; location only
--    for the caller and accepted friends.
-- 8. issue_3969_admin_profile_contacts(uuid[], text): admin and support staff
--    read of names, email and coach-mark step.
--
-- New functions: SECURITY DEFINER, search_path pinned, EXECUTE for
-- authenticated (and service_role) only.
-- ===========================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ── 1. Unused client table privileges ──────────────────────────────────────
REVOKE TRUNCATE, TRIGGER, REFERENCES, DELETE ON TABLE public.profiles FROM authenticated, anon;

-- ── 2. Segment view is server-only ─────────────────────────────────────────
REVOKE ALL ON TABLE public.profiles_with_segment FROM anon, authenticated;

-- ── 3. Account-control fields are set by the server ────────────────────────
-- True when p_email is the signed-in caller's own sign-in email.
CREATE OR REPLACE FUNCTION public.issue_3969_is_own_auth_email(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_email IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM auth.users u
        WHERE u.id = auth.uid()
          AND u.email IS NOT NULL
          AND lower(btrim(u.email)) = lower(btrim(p_email))
     );
$function$;

COMMENT ON FUNCTION public.issue_3969_is_own_auth_email(text) IS
  'issue #3969 step 2 — true when the argument is the signed-in caller''s own sign-in email.';

REVOKE ALL ON FUNCTION public.issue_3969_is_own_auth_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3969_is_own_auth_email(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_3969_profiles_account_fields_server_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_field text;
BEGIN
  -- current_user is the role the statement runs as: `service_role` for the
  -- server, the function owner inside SECURITY DEFINER code, and
  -- `authenticated` / `anon` for a direct client request.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF current_user = 'authenticated' AND public.is_admin_user() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_field := CASE
      WHEN NEW.is_seed IS DISTINCT FROM false THEN 'is_seed'
      WHEN NEW.account_type IS NOT NULL THEN 'account_type'
      WHEN NEW.email_verified IS TRUE THEN 'email_verified'
      WHEN NEW.referral_code IS NOT NULL THEN 'referral_code'
      WHEN NEW.active IS DISTINCT FROM true THEN 'active'
      WHEN NEW.explorer_deleted_at IS NOT NULL THEN 'explorer_deleted_at'
      WHEN NEW.email IS NOT NULL AND NOT public.issue_3969_is_own_auth_email(NEW.email) THEN 'email'
    END;
  ELSE
    v_field := CASE
      WHEN NEW.is_beta_tester IS DISTINCT FROM OLD.is_beta_tester THEN 'is_beta_tester'
      WHEN NEW.is_seed IS DISTINCT FROM OLD.is_seed THEN 'is_seed'
      WHEN NEW.account_type IS DISTINCT FROM OLD.account_type THEN 'account_type'
      WHEN NEW.email_verified IS DISTINCT FROM OLD.email_verified THEN 'email_verified'
      WHEN NEW.referral_code IS DISTINCT FROM OLD.referral_code THEN 'referral_code'
      WHEN NEW.active IS DISTINCT FROM OLD.active THEN 'active'
      WHEN NEW.explorer_deleted_at IS DISTINCT FROM OLD.explorer_deleted_at
           AND NEW.explorer_deleted_at IS NOT NULL THEN 'explorer_deleted_at'
      WHEN NEW.email IS DISTINCT FROM OLD.email
           AND NOT public.issue_3969_is_own_auth_email(NEW.email) THEN 'email'
    END;
  END IF;

  IF v_field IS NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'profiles.% is managed by Mingla', v_field
    USING ERRCODE = '42501',
          HINT = 'This field is set by the server.';
END;
$function$;

COMMENT ON FUNCTION public.issue_3969_profiles_account_fields_server_only() IS
  'issue #3969 step 2 — BEFORE INSERT / UPDATE on public.profiles: a client role (active admins '
  'excepted) may not set account-control fields; email only to the caller''s sign-in email; '
  'explorer_deleted_at only cleared.';

REVOKE ALL ON FUNCTION public.issue_3969_profiles_account_fields_server_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_3969_profiles_account_fields_server_only ON public.profiles;
CREATE TRIGGER issue_3969_profiles_account_fields_server_only
  BEFORE INSERT OR UPDATE OF is_beta_tester, is_seed, account_type, email_verified,
                             referral_code, active, explorer_deleted_at, email
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.issue_3969_profiles_account_fields_server_only();

-- ── 4. The caller's own full profile ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS SETOF public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p.* FROM public.profiles p WHERE p.id = auth.uid();
$function$;

COMMENT ON FUNCTION public.get_my_profile() IS
  'issue #3969 step 2 — the signed-in caller''s own profile row (every field).';

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated, service_role;

-- ── 5. Find a person without contact fields ────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3969_resolve_person(p_identifier text)
RETURNS TABLE(user_exists boolean, can_view boolean, is_blocked boolean, profile_id uuid, username text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_ident text := btrim(COALESCE(p_identifier, ''));
  v_id uuid;
  v_username text;
BEGIN
  IF v_caller IS NULL OR v_ident = '' THEN
    RETURN QUERY SELECT false, false, false, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF position('@' in v_ident) > 0 THEN
    SELECT p.id, p.username INTO v_id, v_username
      FROM public.profiles p
     WHERE lower(p.email) = lower(v_ident)
     ORDER BY EXISTS (SELECT 1 FROM auth.users u
                       WHERE u.id = p.id AND lower(btrim(u.email)) = lower(v_ident)) DESC,
              p.created_at ASC NULLS LAST, p.id ASC
     LIMIT 1;
  ELSE
    SELECT p.id, p.username INTO v_id, v_username
      FROM public.profiles p
     WHERE lower(p.username) = lower(v_ident)
     ORDER BY p.created_at ASC NULLS LAST, p.id ASC
     LIMIT 1;

    IF v_id IS NULL AND v_ident ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT p.id, p.username INTO v_id, v_username
        FROM public.profiles p
       WHERE p.id = v_ident::uuid;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    RETURN QUERY SELECT false, false, false, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    true,
    (v_id = v_caller OR NOT public.is_blocked_by(v_id, v_caller)),
    EXISTS (SELECT 1 FROM public.blocked_users bu
             WHERE (bu.blocker_id = v_id AND bu.blocked_id = v_caller)
                OR (bu.blocker_id = v_caller AND bu.blocked_id = v_id)),
    v_id,
    v_username;
END;
$function$;

COMMENT ON FUNCTION public.issue_3969_resolve_person(text) IS
  'issue #3969 step 2 — find a person by email, username or id for a signed-in caller; '
  'returns no contact fields.';

REVOKE ALL ON FUNCTION public.issue_3969_resolve_person(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3969_resolve_person(text) TO authenticated, service_role;

-- ── 6. Existing lookup: same shape, narrower result ────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_user_visibility_by_identifier(p_identifier text)
RETURNS TABLE(user_exists boolean, can_view boolean, is_blocked boolean, profile_id uuid, username text, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  caller_id uuid;
  v_ident text;
  v_by_email boolean;
  target_profile record;
BEGIN
  caller_id := auth.uid();
  v_ident := btrim(COALESCE(p_identifier, ''));

  IF v_ident = '' THEN
    RETURN QUERY SELECT FALSE, FALSE, FALSE, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  v_by_email := position('@' in v_ident) > 0;

  IF v_by_email THEN
    SELECT p.id, p.username, p.email
      INTO target_profile
      FROM public.profiles p
     WHERE lower(p.email) = lower(v_ident)
     ORDER BY EXISTS (SELECT 1 FROM auth.users u
                       WHERE u.id = p.id AND lower(btrim(u.email)) = lower(v_ident)) DESC,
              p.created_at ASC NULLS LAST, p.id ASC
     LIMIT 1;
  ELSE
    SELECT p.id, p.username, p.email
      INTO target_profile
      FROM public.profiles p
     WHERE lower(p.username) = lower(v_ident)
     ORDER BY p.created_at ASC NULLS LAST, p.id ASC
     LIMIT 1;
  END IF;

  IF target_profile.id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE, FALSE, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    TRUE AS user_exists,
    (
      target_profile.id = caller_id
      OR NOT EXISTS (
        SELECT 1
          FROM public.blocked_users bu
         WHERE bu.blocker_id = target_profile.id
           AND bu.blocked_id = caller_id
      )
    ) AS can_view,
    EXISTS (
      SELECT 1
        FROM public.blocked_users bu
       WHERE (bu.blocker_id = target_profile.id AND bu.blocked_id = caller_id)
          OR (bu.blocker_id = caller_id AND bu.blocked_id = target_profile.id)
    ) AS is_blocked,
    target_profile.id::uuid,
    target_profile.username::text,
    -- The caller typed this email; nothing new is disclosed.
    CASE WHEN v_by_email THEN target_profile.email::text END;
END;
$function$;

COMMENT ON FUNCTION public.resolve_user_visibility_by_identifier(text) IS
  'issue #3969 step 2 — signed-in callers only; email is returned only for an email lookup.';

REVOKE ALL ON FUNCTION public.resolve_user_visibility_by_identifier(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_user_visibility_by_identifier(text) TO authenticated, service_role;

-- ── 7. Paired people and the friend profile sheet ──────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3969_pair_partner_details(p_user_ids uuid[])
RETURNS TABLE(id uuid, display_name text, first_name text, last_name text, avatar_url text, birthday date, gender text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL OR p_user_ids IS NULL OR cardinality(p_user_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_user_ids) > 500 THEN
    RAISE EXCEPTION 'too_many_ids' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT p.id, p.display_name, p.first_name, p.last_name, p.avatar_url,
         CASE WHEN rel.linked THEN p.birthday END,
         CASE WHEN rel.linked THEN p.gender END
    FROM public.profiles p
    CROSS JOIN LATERAL (
      SELECT (
        p.id = v_caller
        OR EXISTS (SELECT 1 FROM public.pairings pr
                    WHERE (pr.user_a_id = v_caller AND pr.user_b_id = p.id)
                       OR (pr.user_b_id = v_caller AND pr.user_a_id = p.id))
        OR EXISTS (SELECT 1 FROM public.pair_requests rq
                    WHERE rq.status = 'pending'
                      AND ((rq.sender_id = v_caller AND rq.receiver_id = p.id)
                        OR (rq.receiver_id = v_caller AND rq.sender_id = p.id)))
      ) AS linked
    ) rel
   WHERE p.id = ANY (p_user_ids)
     AND (p.id = v_caller OR NOT public.is_blocked_by(p.id, v_caller));
END;
$function$;

COMMENT ON FUNCTION public.issue_3969_pair_partner_details(uuid[]) IS
  'issue #3969 step 2 — names and avatars for the given people; birthday and gender only for '
  'the caller, people paired with the caller, or in a pending pair request with the caller.';

REVOKE ALL ON FUNCTION public.issue_3969_pair_partner_details(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3969_pair_partner_details(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_3969_friend_profile(p_user_id uuid)
RETURNS TABLE(id uuid, first_name text, last_name text, username text, avatar_url text,
              country text, bio text, location text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL OR p_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.first_name, p.last_name, p.username, p.avatar_url, p.country, p.bio,
         CASE
           WHEN p.id = v_caller
             OR EXISTS (SELECT 1 FROM public.friends f
                         WHERE f.status = 'accepted'
                           AND f.deleted_at IS NULL
                           AND ((f.user_id = v_caller AND f.friend_user_id = p.id)
                             OR (f.friend_user_id = v_caller AND f.user_id = p.id)))
           THEN p.location
         END
    FROM public.profiles p
   WHERE p.id = p_user_id
     AND (p.id = v_caller OR NOT public.is_blocked_by(p.id, v_caller));
END;
$function$;

COMMENT ON FUNCTION public.issue_3969_friend_profile(uuid) IS
  'issue #3969 step 2 — profile sheet fields for a signed-in caller; location only for the '
  'caller and accepted friends.';

REVOKE ALL ON FUNCTION public.issue_3969_friend_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3969_friend_profile(uuid) TO authenticated, service_role;

-- ── 8. Admin console read ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3969_admin_profile_contacts(
  p_user_ids uuid[] DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS TABLE(id uuid, display_name text, username text, email text, coach_mark_step integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_email text := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');
BEGIN
  IF NOT (public.is_admin_user() OR COALESCE(public.is_support_staff(auth.uid()), false)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_user_ids IS NULL AND v_email IS NULL THEN
    RETURN;
  END IF;
  IF p_user_ids IS NOT NULL AND cardinality(p_user_ids) > 1000 THEN
    RAISE EXCEPTION 'too_many_ids' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT p.id, p.display_name, p.username, p.email, p.coach_mark_step
    FROM public.profiles p
   WHERE (p_user_ids IS NULL OR p.id = ANY (p_user_ids))
     AND (v_email IS NULL OR lower(p.email) = v_email)
   ORDER BY p.display_name NULLS LAST, p.id
   LIMIT 1000;
END;
$function$;

COMMENT ON FUNCTION public.issue_3969_admin_profile_contacts(uuid[], text) IS
  'issue #3969 step 2 — admin and support staff read of names, email and coach-mark step, '
  'by user ids and / or exact email.';

REVOKE ALL ON FUNCTION public.issue_3969_admin_profile_contacts(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3969_admin_profile_contacts(uuid[], text) TO authenticated, service_role;

COMMIT;

-- ===========================================================================
-- ROLLBACK (restores the production state captured on 2026-11-23)
--
-- BEGIN;
-- SET LOCAL lock_timeout = '3s';
-- DROP TRIGGER IF EXISTS issue_3969_profiles_account_fields_server_only ON public.profiles;
-- DROP FUNCTION IF EXISTS public.issue_3969_profiles_account_fields_server_only();
-- DROP FUNCTION IF EXISTS public.issue_3969_is_own_auth_email(text);
-- DROP FUNCTION IF EXISTS public.get_my_profile();
-- DROP FUNCTION IF EXISTS public.issue_3969_resolve_person(text);
-- DROP FUNCTION IF EXISTS public.issue_3969_pair_partner_details(uuid[]);
-- DROP FUNCTION IF EXISTS public.issue_3969_friend_profile(uuid);
-- DROP FUNCTION IF EXISTS public.issue_3969_admin_profile_contacts(uuid[], text);
-- GRANT TRUNCATE, TRIGGER, REFERENCES, DELETE ON TABLE public.profiles TO authenticated;
-- GRANT SELECT ON TABLE public.profiles_with_segment TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.resolve_user_visibility_by_identifier(text) TO PUBLIC, anon;
-- -- then re-create resolve_user_visibility_by_identifier from
-- -- 20260505000000_baseline_squash_orch_0729.sql (search_path 'public').
-- COMMIT;
-- ===========================================================================
