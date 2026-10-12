-- Issue #3802 (Wave 0) — one-time invite links; exclusivity and uniqueness
-- hardening.
--
--   * A team invitation is tied to the invited person with a one-time link
--     that expires. public.admin_team_invites holds one outstanding
--     invitation per person and stores only a hash. No client role can read
--     or write it.
--   * Both self-activation functions require that the caller's own account
--     opened their invitation's link in the last 24 hours.
--   * Every membership change through the one writer ends the person's
--     outstanding invitation; a re-send replaces it.
--   * One address can hold only one row in each membership table, however it
--     is spelled, and two writers for one person queue up.
--
-- One transaction. Follows 20270817003802 (already applied; never edited).
--
-- NOT modified here: is_admin_user(), get_admin_emails(), is_admin_email(text),
-- check_invited_admin(text), admin_team_list(), admin_team_my_access(),
-- admin_team_role(), admin_team_role_areas(text), admin_team_can(text),
-- admin_team_caller_email(), the triggers on the two membership tables, the
-- policy "Admins can read admin_users", the constraint admin_users_role_check.
--
-- Invariants (docs/INVARIANT_REGISTRY.md):
--   I-PROPOSED-3802-TEAM-INVITE-IS-A-ONE-TIME-LINK
--   I-PROPOSED-3802-TEAM-ACCESS-HAS-ONE-OWNER-ONLY-WRITER
--
-- ---------------------------------------------------------------------------
-- ROLLBACK (kept here as a comment; there is no down-migration file).
-- Order matters: roll the admin web client back FIRST (revert its pull request
-- with a [deploy] commit), then the database. Rolling the database back alone
-- leaves the new client unable to send invites (existing people still sign in).
--
--   BEGIN;
--   -- 1. restore the three replaced functions from 20270817003802
--   --    (admin_team_guard_exclusive, admin_team_set_member,
--   --    admin_team_activate_self) and activate_invited_admin from the
--   --    baseline migration. The previous client does not need EXECUTE on it
--   --    for PUBLIC or anon; do not re-grant those.
--   DROP FUNCTION IF EXISTS public.admin_team_invite_states();
--   DROP FUNCTION IF EXISTS public.admin_team_redeem_invite(text, uuid);
--   DROP FUNCTION IF EXISTS public.admin_team_invite_peek(text);
--   DROP FUNCTION IF EXISTS public.admin_team_issue_invite(text, text, text);
--   DROP TABLE IF EXISTS public.admin_team_invites;
--   DROP INDEX IF EXISTS public.admin_team_members_email_normalised_key;
--   DROP INDEX IF EXISTS public.admin_users_email_normalised_key;
--   COMMIT;
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Pre-flight. Counts only, never the addresses. Aborts before any change.
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT lower(btrim(email)) FROM public.admin_users GROUP BY 1 HAVING count(*) > 1) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'issue 3802 pre-flight: % normalised email(s) appear more than once in admin_users; merge them by hand (revoke the extra rows and re-address them) and re-run', n;
  END IF;
  SELECT count(*) INTO n FROM (
    SELECT lower(btrim(email)) FROM public.admin_team_members GROUP BY 1 HAVING count(*) > 1) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'issue 3802 pre-flight: % normalised email(s) appear more than once in admin_team_members', n;
  END IF;
END;
$pre$;

-- ---------------------------------------------------------------------------
-- 2. One row per address in each membership table, however it is spelled.
--
-- The second index repeats what the existing CHECK + UNIQUE on the team table
-- already give; it exists so the guarantee survives a later constraint change.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX admin_users_email_normalised_key
  ON public.admin_users (lower(btrim(email)));
CREATE UNIQUE INDEX admin_team_members_email_normalised_key
  ON public.admin_team_members (lower(btrim(email)));

-- ---------------------------------------------------------------------------
-- 3. Exclusivity under concurrency.
--
-- Same body as before plus one statement: the per-person lock the writer
-- takes. Guarantee: at READ COMMITTED (the default, and what every client and
-- edge function uses) two sessions writing both tables for one person
-- serialise and the second sees the first's row. A trusted session that
-- deliberately runs REPEATABLE READ or SERIALIZABLE is outside the guarantee.
-- The triggers themselves are not re-created.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_team_guard_exclusive() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'revoked' THEN
    RETURN NEW;
  END IF;
  -- Same key admin_team_set_member takes: two writers for one person queue up,
  -- whichever role they run as. Re-entrant inside one transaction.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_team:' || lower(btrim(NEW.email)), 0));
  IF TG_TABLE_NAME = 'admin_users' THEN
    IF EXISTS (SELECT 1 FROM public.admin_team_members m
               WHERE m.email = lower(btrim(NEW.email)) AND m.status <> 'revoked') THEN
      RAISE EXCEPTION 'team_membership_conflict: % already has a non-admin team role', NEW.email
        USING ERRCODE = '23505';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.admin_users au
               WHERE lower(btrim(au.email)) = NEW.email AND au.status <> 'revoked') THEN
      RAISE EXCEPTION 'team_membership_conflict: % is already a full admin', NEW.email
        USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_guard_exclusive() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.admin_team_guard_exclusive() IS
  'Issue #3802. One live membership per person across both membership tables. Takes the per-person lock, so at READ COMMITTED two writers for one person queue up and the second sees the first''s row. A trusted session that deliberately runs REPEATABLE READ or SERIALIZABLE is outside that guarantee.';

-- ---------------------------------------------------------------------------
-- 4. Invitations. One row per person = their current invitation; it exists
-- only while an invitation is outstanding.
--
--   pending   redeemed_at IS NULL AND expires_at > now()
--   opened    redeemed_at IS NOT NULL AND redeemed_at > now() - 24 hours
--   expired   anything else
-- ---------------------------------------------------------------------------
CREATE TABLE public.admin_team_invites (
  email            text PRIMARY KEY,
  role             text NOT NULL,
  token_hash       text NOT NULL,
  issued_by        text NOT NULL,
  issued_at        timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  redeemed_at      timestamptz,
  redeemed_user_id uuid,
  CONSTRAINT admin_team_invites_email_normalised CHECK (email = lower(btrim(email)) AND email <> ''),
  CONSTRAINT admin_team_invites_role_check CHECK (role IN ('admin','growth','partner')),
  CONSTRAINT admin_team_invites_hash_key UNIQUE (token_hash),
  CONSTRAINT admin_team_invites_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_team_invites_redeemed_pair CHECK ((redeemed_at IS NULL) = (redeemed_user_id IS NULL))
);
ALTER TABLE public.admin_team_invites ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: every read and write goes through the functions below.
REVOKE ALL ON public.admin_team_invites FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_team_invites TO service_role;
COMMENT ON TABLE public.admin_team_invites IS
  'Issue #3802. One outstanding team invitation per person. Holds only a hash. No client reads or writes.';

-- ---------------------------------------------------------------------------
-- 5. Owner: issue or re-send an invitation.
--
-- Error tokens added to the writer's: invalid_token, already_active.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.admin_team_issue_invite(p_email text, p_role text, p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_res   jsonb;
  v_email text;
  v_actor text;
  v_exp   timestamptz := now() + interval '7 days';
BEGIN
  IF NOT COALESCE(public.admin_team_role() = 'owner', false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = '22023';
  END IF;

  -- Validation, owner/self protection, per-person lock, table move and the
  -- audit row all live in the one writer.
  v_res   := public.admin_team_set_member(p_email, p_role, 'invited');
  v_email := v_res ->> 'email';

  -- Inviting must never take access away from someone who already has it.
  IF v_res -> 'previous' ->> 'status' = 'active' THEN
    RAISE EXCEPTION 'already_active' USING ERRCODE = '23505';   -- rolls the writer's change back
  END IF;

  SELECT lower(btrim(u.email)) INTO v_actor FROM auth.users u WHERE u.id = auth.uid();

  INSERT INTO public.admin_team_invites AS i (email, role, token_hash, issued_by, issued_at, expires_at)
  VALUES (v_email, p_role, p_token_hash, v_actor, now(), v_exp)
  ON CONFLICT (email) DO UPDATE
     SET role = EXCLUDED.role, token_hash = EXCLUDED.token_hash, issued_by = EXCLUDED.issued_by,
         issued_at = EXCLUDED.issued_at, expires_at = EXCLUDED.expires_at,
         redeemed_at = NULL, redeemed_user_id = NULL;

  IF NOT (v_res ->> 'changed')::boolean THEN      -- same role, still invited: a re-send
    INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, metadata)
    VALUES (v_actor, 'team.invite_resend', 'team_member', v_email, '{}'::jsonb);
  END IF;

  RETURN v_res || jsonb_build_object('expires_at', v_exp);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_issue_invite(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_issue_invite(text, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The one writer: same body as before plus one statement. Any change to a
-- person's membership ends their outstanding invitation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_team_set_member(p_email text, p_role text, p_status text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor         text;
  v_email         text;
  v_prev_role     text;
  v_prev_status   text;
  v_prev_accepted timestamptz;
  v_accepted      timestamptz;
  v_action        text;
  v_previous      jsonb;
BEGIN
  -- Gate FIRST. Only the owner may add people, change a role or remove access.
  IF NOT COALESCE(public.admin_team_role() = 'owner', false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_email := lower(btrim(COALESCE(p_email, '')));
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('admin','growth','partner') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';       -- 'owner' can never be assigned
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('invited','active','revoked') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  SELECT lower(btrim(u.email)) INTO v_actor FROM auth.users u WHERE u.id = auth.uid();
  IF v_email = v_actor THEN
    RAISE EXCEPTION 'cannot_change_self' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin_team:' || v_email, 0));

  IF EXISTS (SELECT 1 FROM public.admin_users au
             WHERE lower(btrim(au.email)) = v_email AND au.role = 'owner') THEN
    RAISE EXCEPTION 'cannot_change_owner' USING ERRCODE = '42501';
  END IF;

  -- Current membership: the non-revoked row wins.
  SELECT x.r, x.s, x.aa INTO v_prev_role, v_prev_status, v_prev_accepted
  FROM (
    SELECT 'admin'::text AS r, au.status AS s, au.accepted_at AS aa, au.created_at AS ca
    FROM public.admin_users au WHERE lower(btrim(au.email)) = v_email
    UNION ALL
    SELECT m.role, m.status, m.accepted_at, m.created_at
    FROM public.admin_team_members m WHERE m.email = v_email
  ) x
  ORDER BY (x.s <> 'revoked') DESC, x.aa DESC NULLS LAST, x.ca DESC
  LIMIT 1;

  v_previous := CASE WHEN v_prev_status IS NULL THEN NULL
                     ELSE jsonb_build_object('role', v_prev_role, 'status', v_prev_status) END;

  -- Removing someone who has no access: nothing to do.
  IF p_status = 'revoked' AND (v_prev_status IS NULL OR v_prev_status = 'revoked') THEN
    IF v_prev_status IS NULL THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('email', v_email, 'role', v_prev_role, 'status', 'revoked',
                              'changed', false, 'previous', v_previous);
  END IF;

  -- A repeated request changes nothing.
  IF p_status <> 'revoked' AND v_prev_role = p_role AND v_prev_status = p_status THEN
    RETURN jsonb_build_object('email', v_email, 'role', p_role, 'status', p_status,
                              'changed', false, 'previous', v_previous);
  END IF;

  -- 'active' may only RESTORE someone who activated themselves before. The owner can
  -- never activate a mailbox whose holder has not signed in.
  IF p_status = 'active' AND v_prev_accepted IS NULL THEN
    RAISE EXCEPTION 'never_activated' USING ERRCODE = '22023';
  END IF;

  -- Any change to a person's membership ends their outstanding invitation.
  DELETE FROM public.admin_team_invites i WHERE i.email = v_email;

  v_accepted := CASE WHEN p_status = 'invited' THEN NULL ELSE v_prev_accepted END;

  IF p_status = 'revoked' THEN
    UPDATE public.admin_users
       SET status = 'revoked'
     WHERE lower(btrim(email)) = v_email AND status <> 'revoked';
    UPDATE public.admin_team_members
       SET status = 'revoked', updated_at = now()
     WHERE email = v_email AND status <> 'revoked';
    v_action := 'team.remove';

  ELSIF p_role = 'admin' THEN
    -- Full admin: leave the non-admin table first (exclusivity guard), then admin_users.
    UPDATE public.admin_team_members
       SET status = 'revoked', updated_at = now()
     WHERE email = v_email AND status <> 'revoked';
    UPDATE public.admin_users
       SET role = 'admin', status = p_status, accepted_at = v_accepted,
           invited_by = CASE WHEN p_status = 'invited' THEN v_actor ELSE invited_by END
     WHERE lower(btrim(email)) = v_email;
    IF NOT FOUND THEN
      INSERT INTO public.admin_users (email, role, status, invited_by, accepted_at)
      VALUES (v_email, 'admin', p_status, v_actor, v_accepted);
    END IF;

  ELSE
    -- growth | partner: leave admin_users first (revoke, never delete: other
    -- records point at admin_users rows), then the team table.
    UPDATE public.admin_users
       SET status = 'revoked'
     WHERE lower(btrim(email)) = v_email AND status <> 'revoked';
    UPDATE public.admin_team_members
       SET role = p_role, status = p_status, accepted_at = v_accepted, updated_at = now(),
           invited_by = CASE WHEN p_status = 'invited' THEN v_actor ELSE invited_by END
     WHERE email = v_email;
    IF NOT FOUND THEN
      INSERT INTO public.admin_team_members (email, role, status, invited_by, accepted_at)
      VALUES (v_email, p_role, p_status, v_actor, v_accepted);
    END IF;
  END IF;

  IF v_action IS NULL THEN
    v_action := CASE
      WHEN v_prev_status IS NULL OR v_prev_status = 'revoked'
        THEN CASE WHEN p_status = 'invited' THEN 'team.invite' ELSE 'team.restore' END
      WHEN v_prev_role IS DISTINCT FROM p_role THEN 'team.role_change'
      ELSE 'team.status_change'
    END;
  END IF;

  INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, metadata)
  VALUES (v_actor, v_action, 'team_member', v_email,
          jsonb_build_object('before', v_previous,
                             'after', jsonb_build_object('role', p_role, 'status', p_status)));

  RETURN jsonb_build_object(
    'email', v_email,
    'role', CASE WHEN p_status = 'revoked' THEN v_prev_role ELSE p_role END,
    'status', p_status, 'changed', true, 'previous', v_previous);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_set_member(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_set_member(text, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Service-role-only functions, called by the two invite edge functions.
-- ---------------------------------------------------------------------------

-- What state is the invitation with this hash in? Changes nothing.
CREATE FUNCTION public.admin_team_invite_peek(p_token_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.admin_team_invites i WHERE i.token_hash = p_token_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  RETURN jsonb_build_object(
    'state', CASE WHEN v.redeemed_at IS NOT NULL THEN 'used'
                  WHEN v.expires_at <= now() THEN 'expired'
                  ELSE 'pending' END,
    'email', v.email,
    'role', v.role,
    'user_id', (SELECT u.id FROM auth.users u
                 WHERE lower(btrim(u.email)) = v.email
                 ORDER BY u.created_at LIMIT 1));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_invite_peek(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_invite_peek(text) TO service_role;

-- Open an invitation for one account. Works once; the row lock makes two
-- simultaneous attempts produce exactly one 'redeemed'.
CREATE FUNCTION public.admin_team_redeem_invite(p_token_hash text, p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.admin_team_invites i WHERE i.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','invalid'); END IF;
  IF v.redeemed_at IS NOT NULL THEN RETURN jsonb_build_object('state','used'); END IF;
  IF v.expires_at <= now() THEN RETURN jsonb_build_object('state','expired'); END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u
                 WHERE u.id = p_user_id AND lower(btrim(u.email)) = v.email) THEN
    RETURN jsonb_build_object('state','invalid');
  END IF;
  UPDATE public.admin_team_invites i
     SET redeemed_at = now(), redeemed_user_id = p_user_id
   WHERE i.email = v.email;
  RETURN jsonb_build_object('state','redeemed','email',v.email,'role',v.role);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_redeem_invite(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_redeem_invite(text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Owner read: where each outstanding invitation stands. The roster function
-- is unchanged; the client joins the two by email.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.admin_team_invite_states()
RETURNS TABLE (email text, state text, expires_at timestamptz, issued_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF NOT COALESCE(public.admin_team_role() = 'owner', false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT i.email,
         CASE WHEN i.redeemed_at IS NULL AND i.expires_at > now() THEN 'pending'
              WHEN i.redeemed_at IS NOT NULL AND i.redeemed_at > now() - interval '24 hours' THEN 'opened'
              ELSE 'expired' END,
         i.expires_at,
         i.issued_at
  FROM public.admin_team_invites i
  ORDER BY i.email;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_invite_states() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_invite_states() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Activation requires an opened invitation.
--
-- Contract kept: never raises for a signed-in caller with a confirmed address;
-- idempotent; cannot change a role; a caller with no invitation gets their
-- current access back. Without an invitation opened by the caller's own
-- account nothing changes and the returned status stays 'invited'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_team_activate_self() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_role  text;
  v_a int := 0;
  v_b int := 0;
BEGIN
  v_email := public.admin_team_caller_email();
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin_team:' || v_email, 0));

  -- The invitation must have been opened from the emailed link, by THIS account.
  SELECT i.role INTO v_role
  FROM public.admin_team_invites i
  WHERE i.email = v_email
    AND i.redeemed_user_id = auth.uid()
    AND i.redeemed_at > now() - interval '24 hours';
  IF NOT FOUND THEN
    RETURN public.admin_team_my_access();      -- unchanged: still invited, or no access
  END IF;

  IF v_role = 'admin' THEN
    UPDATE public.admin_users
       SET status = 'active', accepted_at = now()
     WHERE lower(btrim(email)) = v_email AND status = 'invited';
    GET DIAGNOSTICS v_a = ROW_COUNT;
  ELSE
    UPDATE public.admin_team_members
       SET status = 'active', accepted_at = now(), updated_at = now()
     WHERE email = v_email AND status = 'invited' AND role = v_role;
    GET DIAGNOSTICS v_b = ROW_COUNT;
  END IF;

  IF v_a + v_b > 0 THEN
    DELETE FROM public.admin_team_invites i WHERE i.email = v_email;
    INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, metadata)
    VALUES (v_email, 'team.activate', 'team_member', v_email, '{}'::jsonb);
  END IF;

  RETURN public.admin_team_my_access();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_activate_self() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_activate_self() TO authenticated, service_role;

-- The previous self-activation function: same name, same signature, same
-- quiet return for a caller with nothing to activate. It now resolves names
-- against nothing and needs the same opened invitation.
CREATE OR REPLACE FUNCTION public.activate_invited_admin() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_email TEXT;
BEGIN
  v_email := lower(coalesce(
    current_setting('request.jwt.claims', true)::json->>'email',
    ''
  ));

  IF v_email = '' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin_team:' || v_email, 0));

  UPDATE public.admin_users
  SET status = 'active',
      accepted_at = now()
  WHERE lower(email) = v_email
    AND status = 'invited'
    AND EXISTS (SELECT 1 FROM public.admin_team_invites i
                WHERE i.email = v_email AND i.role = 'admin'
                  AND i.redeemed_user_id = auth.uid()
                  AND i.redeemed_at > now() - interval '24 hours');
  IF FOUND THEN
    DELETE FROM public.admin_team_invites i WHERE i.email = v_email;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.activate_invited_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.activate_invited_admin() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Self-check. Aborts the apply unless the access shape above really holds.
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  f        record;
  v_role   text;
  v_priv   text;
  v_got    text;
  v_owners int;
BEGIN
  -- 10.1-10.4 who may execute each of the fourteen team functions.
  FOR f IN
    SELECT * FROM (VALUES
      ('public.admin_team_role()',                         true),
      ('public.admin_team_role_areas(text)',               true),
      ('public.admin_team_can(text)',                      true),
      ('public.admin_team_my_access()',                    true),
      ('public.admin_team_activate_self()',                true),
      ('public.admin_team_list()',                         true),
      ('public.admin_team_set_member(text,text,text)',     true),
      ('public.admin_team_issue_invite(text,text,text)',   true),
      ('public.admin_team_invite_states()',                true),
      ('public.activate_invited_admin()',                  true),
      ('public.admin_team_caller_email()',                 false),
      ('public.admin_team_guard_exclusive()',              false),
      ('public.admin_team_invite_peek(text)',              false),
      ('public.admin_team_redeem_invite(text,uuid)',       false)
    ) AS v(sig, signed_in)
  LOOP
    IF has_function_privilege('anon', f.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 3802 self-check: anon can execute %', f.sig;
    END IF;
    IF (SELECT p.proacl IS NULL FROM pg_catalog.pg_proc p WHERE p.oid = f.sig::regprocedure)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, aclexplode(p.proacl) a
                  WHERE p.oid = f.sig::regprocedure AND a.grantee = 0) THEN
      RAISE EXCEPTION 'issue 3802 self-check: everyone can execute %', f.sig;
    END IF;
    IF has_function_privilege('authenticated', f.sig, 'EXECUTE') IS DISTINCT FROM f.signed_in THEN
      RAISE EXCEPTION 'issue 3802 self-check: signed-in execute on % is %, expected %',
        f.sig, has_function_privilege('authenticated', f.sig, 'EXECUTE'), f.signed_in;
    END IF;
    IF f.sig <> 'public.admin_team_guard_exclusive()'
       AND NOT has_function_privilege('service_role', f.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 3802 self-check: service_role cannot execute %', f.sig;
    END IF;
  END LOOP;

  -- 10.5 clients hold nothing on the invitations table; row security on; no policy.
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF has_table_privilege(v_role, 'public.admin_team_invites', v_priv) THEN
        RAISE EXCEPTION 'issue 3802 self-check: % holds % on admin_team_invites', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
           WHERE c.oid = 'public.admin_team_invites'::regclass) THEN
    RAISE EXCEPTION 'issue 3802 self-check: row security is off on admin_team_invites';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
             WHERE p.polrelid = 'public.admin_team_invites'::regclass) THEN
    RAISE EXCEPTION 'issue 3802 self-check: a policy exists on admin_team_invites';
  END IF;

  -- 10.6 both normalised-email indexes are there, unique and valid.
  IF (SELECT count(*) FROM pg_catalog.pg_index x
        JOIN pg_catalog.pg_class c ON c.oid = x.indexrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname IN ('admin_users_email_normalised_key', 'admin_team_members_email_normalised_key')
         AND x.indisunique AND x.indisvalid) <> 2 THEN
    RAISE EXCEPTION 'issue 3802 self-check: a normalised-email unique index is missing or invalid';
  END IF;

  -- 10.7 the triggers on the two membership tables are exactly the two guards.
  SELECT string_agg(t.tgname, ',' ORDER BY t.tgname) INTO v_got
  FROM pg_catalog.pg_trigger t
  WHERE t.tgrelid IN ('public.admin_users'::regclass, 'public.admin_team_members'::regclass)
    AND NOT t.tgisinternal;
  IF v_got IS DISTINCT FROM 'admin_team_members_guard_exclusive,admin_users_guard_exclusive' THEN
    RAISE EXCEPTION 'issue 3802 self-check: unexpected triggers on the membership tables: %', v_got;
  END IF;

  -- 10.8 the first migration's shape still holds.
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
      IF has_table_privilege(v_role, 'public.admin_users', v_priv) THEN
        RAISE EXCEPTION 'issue 3802 self-check: % holds % on admin_users', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.admin_users', 'SELECT') THEN
    RAISE EXCEPTION 'issue 3802 self-check: authenticated lost SELECT on admin_users';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
             WHERE p.polrelid = 'public.admin_users'::regclass
               AND p.polcmd IN ('a','w','d','*')) THEN
    RAISE EXCEPTION 'issue 3802 self-check: a write policy exists on admin_users';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF has_table_privilege(v_role, 'public.admin_team_members', v_priv) THEN
        RAISE EXCEPTION 'issue 3802 self-check: % holds % on admin_team_members', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- 10.9 the replaced bodies are the ones above.
  IF (SELECT p.prosrc FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.admin_team_guard_exclusive()'::regprocedure) !~ 'pg_advisory_xact_lock' THEN
    RAISE EXCEPTION 'issue 3802 self-check: the exclusivity guard takes no lock';
  END IF;
  IF (SELECT p.prosrc FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.admin_team_activate_self()'::regprocedure) !~ 'redeemed_user_id'
     OR (SELECT p.prosrc FROM pg_catalog.pg_proc p
          WHERE p.oid = 'public.activate_invited_admin()'::regprocedure) !~ 'redeemed_user_id' THEN
    RAISE EXCEPTION 'issue 3802 self-check: an activation function does not require an opened invitation';
  END IF;

  -- Not an abort: a freshly built test database has no owner row.
  SELECT count(*) INTO v_owners
  FROM public.admin_users au
  WHERE au.role = 'owner' AND au.status = 'active';
  IF v_owners <> 1 THEN
    RAISE WARNING 'issue 3802 self-check: expected exactly 1 active owner, found %', v_owners;
  END IF;
END;
$check$;

COMMIT;
