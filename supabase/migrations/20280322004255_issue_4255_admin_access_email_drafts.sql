-- Issue #4255 (Wave 1) — admin access, team management, shared email drafts,
-- blog writers.
--
-- Seth's decisions (issue #4255): D3 Founding partners are full admins,
-- including refunds, pricing and Stripe actions, and keep their label. D4
-- Admins and partners invite, change and remove everyone except the owner.
-- D5 Everyone on the team can send email.
--
--   1. 'partner' becomes an admin_users role. Every gate that reads an active
--      admin_users row (is_admin_user(), the money edge functions, RLS) now
--      lets partners in. Active and invited partner rows move over from
--      admin_team_members, idempotently; that table keeps only growth people.
--   2. A trigger on admin_users refuses deleting, demoting, deactivating or
--      re-addressing the owner row, and a second owner, for every caller
--      (service role and postgres included).
--   3. Owner, admin and partner hold team_manage. The team functions gate on
--      team_manage instead of "is the owner"; cannot_change_owner and
--      cannot_change_self stay.
--   4. Gates that named ('owner','admin') name partner too.
--   5. New table admin_email_drafts: every active teammate reads and creates;
--      the author or an admin/partner updates or deletes. Saves go through
--      admin_email_draft_save, which raises PT409 on a stale revision.
--   6. email_templates is readable by every active teammate (writes stay with
--      admins). Every active teammate may upload email images.
--   7. issue_4137_blog_can_write means any active teammate. Publishing is
--      unchanged (admin/partner seat or a Support lead).
--   8. Areas: email_drafts for every role; blog when the caller may write.
--
-- Conflicts raise PT409 (never 40001). Static SQL only: no EXECUTE.
--
-- Invariants (declared beside the enforcing pg17 test,
-- supabase/migrations/__tests__/issue_4255_admin_access_email_drafts.implementor.pg17.test.sql):
--   I-4255-OWNER-ROW-IS-IMMUTABLE
--   I-4255-PARTNER-IS-FULL-ADMIN
--   I-4255-TEAM-MANAGE-NEVER-TOUCHES-OWNER-OR-SELF
--   I-4255-EMAIL-DRAFTS-TEAM-SHARED
--
-- ---------------------------------------------------------------------------
-- ROLLBACK (comment only; there is no down-migration file). Roll the admin
-- client back first, then:
--   BEGIN;
--   -- partners back to the team table (they lose full-admin access):
--   --   UPDATE admin_users SET status='revoked' WHERE role='partner' AND status<>'revoked'
--   --   and re-insert / re-activate their admin_team_members rows (role partner);
--   --   then restore admin_users_role_check to ('owner','admin') after
--   --   UPDATE admin_users SET role='admin' WHERE role='partner'.
--   DROP TRIGGER admin_users_protect_owner ON public.admin_users;
--   DROP FUNCTION public.admin_users_protect_owner();
--   DROP TABLE public.admin_email_drafts;   -- drops its trigger and policies
--   DROP FUNCTION public.admin_email_draft_save(uuid,text,jsonb,jsonb,text,integer);
--   DROP FUNCTION public.admin_email_draft_delete(uuid);
--   DROP FUNCTION public.admin_email_drafts_stamp();
--   DROP POLICY "Team reads templates" ON public.email_templates;
--   DROP POLICY admin_email_assets_team_insert ON storage.objects;
--   -- re-apply the previous bodies of every function replaced below from the
--   -- migrations named beside each one (git show).
--   COMMIT;
-- ---------------------------------------------------------------------------

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 0. Pre-flight. Counts only, never addresses.
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM public.admin_team_members m
  JOIN public.admin_users au ON lower(btrim(au.email)) = m.email
  WHERE m.role = 'partner' AND m.status <> 'revoked' AND au.status <> 'revoked';
  IF n > 0 THEN
    RAISE EXCEPTION 'issue 4255 pre-flight: % partner(s) also hold a live admin_users row; resolve by hand first', n;
  END IF;
  SELECT count(*) INTO n
  FROM public.admin_team_members m
  JOIN public.admin_users au ON lower(btrim(au.email)) = m.email
  WHERE m.role = 'partner' AND m.status <> 'revoked' AND au.role = 'owner';
  IF n > 0 THEN
    RAISE EXCEPTION 'issue 4255 pre-flight: % partner row(s) share the owner address', n;
  END IF;
  SELECT count(*) INTO n FROM public.admin_users au WHERE au.role = 'owner' AND au.status <> 'revoked';
  IF n > 1 THEN
    RAISE EXCEPTION 'issue 4255 pre-flight: % live owner rows; expected at most one', n;
  END IF;
END;
$pre$;

-- ---------------------------------------------------------------------------
-- 1. partner is an admin_users role.
-- ---------------------------------------------------------------------------
ALTER TABLE public.admin_users DROP CONSTRAINT admin_users_role_check;
ALTER TABLE public.admin_users ADD CONSTRAINT admin_users_role_check
  CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'partner'::text]));

-- Move live partner rows (active and invited). Idempotent: a second run finds
-- none. The team row is revoked first so the exclusivity trigger lets the
-- admin_users write through.
CREATE TEMP TABLE issue4255_partner_move ON COMMIT DROP AS
SELECT m.email, m.status, m.invited_by, m.created_at, m.accepted_at
FROM public.admin_team_members m
WHERE m.role = 'partner' AND m.status <> 'revoked';

UPDATE public.admin_team_members m
   SET status = 'revoked', updated_at = now()
  FROM issue4255_partner_move mv
 WHERE m.email = mv.email AND m.status <> 'revoked';

UPDATE public.admin_users au
   SET role = 'partner', status = mv.status, accepted_at = mv.accepted_at,
       invited_by = COALESCE(mv.invited_by, au.invited_by)
  FROM issue4255_partner_move mv
 WHERE lower(btrim(au.email)) = mv.email AND au.role IS DISTINCT FROM 'owner';

INSERT INTO public.admin_users (email, role, status, invited_by, created_at, accepted_at)
SELECT mv.email, 'partner', mv.status, mv.invited_by, mv.created_at, mv.accepted_at
FROM issue4255_partner_move mv
WHERE NOT EXISTS (SELECT 1 FROM public.admin_users au WHERE lower(btrim(au.email)) = mv.email);

INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, metadata)
SELECT 'system', 'team.role_change', 'team_member', mv.email,
       jsonb_build_object('before', jsonb_build_object('role', 'partner', 'status', mv.status, 'table', 'admin_team_members'),
                          'after', jsonb_build_object('role', 'partner', 'status', mv.status, 'table', 'admin_users'),
                          'issue', 4255)
FROM issue4255_partner_move mv;

-- The team table never holds a live partner again.
ALTER TABLE public.admin_team_members ADD CONSTRAINT admin_team_members_partner_moved
  CHECK (role <> 'partner' OR status = 'revoked');

-- ---------------------------------------------------------------------------
-- 2. The owner row cannot be removed, demoted, deactivated or re-addressed,
--    and there is never a second owner. Every caller, every path.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.admin_users_protect_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' THEN
      RAISE EXCEPTION 'cannot_change_owner' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.role = 'owner' THEN
    IF NEW.role IS DISTINCT FROM 'owner'
       OR NEW.status IS DISTINCT FROM OLD.status
       OR lower(btrim(NEW.email)) IS DISTINCT FROM lower(btrim(OLD.email)) THEN
      RAISE EXCEPTION 'cannot_change_owner' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.role = 'owner' THEN
    IF TG_OP = 'UPDATE' THEN
      -- Nobody is promoted to owner.
      RAISE EXCEPTION 'cannot_change_owner' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.admin_users au
               WHERE au.role = 'owner' AND au.status <> 'revoked') THEN
      RAISE EXCEPTION 'owner_exists' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_users_protect_owner() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.admin_users_protect_owner() IS
  'Issue #4255. Refuses deleting, demoting, deactivating or re-addressing the owner row, promoting anyone to owner, and a second live owner. Fires for every caller, service role and postgres included (I-4255-OWNER-ROW-IS-IMMUTABLE).';

CREATE TRIGGER admin_users_protect_owner
  BEFORE INSERT OR UPDATE OR DELETE ON public.admin_users
  FOR EACH ROW EXECUTE FUNCTION public.admin_users_protect_owner();

-- TRUNCATE skips row triggers; refuse it while an owner row exists.
CREATE FUNCTION public.admin_users_protect_owner_truncate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.admin_users au WHERE au.role = 'owner') THEN
    RAISE EXCEPTION 'cannot_change_owner' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_users_protect_owner_truncate() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER admin_users_protect_owner_truncate
  BEFORE TRUNCATE ON public.admin_users
  FOR EACH STATEMENT EXECUTE FUNCTION public.admin_users_protect_owner_truncate();

-- ---------------------------------------------------------------------------
-- 3. Areas. The ONE role-to-areas map. Owner, admin and partner are equal
--    (D3, D4). 'admin_console' stays equivalent to is_admin_user(): every
--    role that holds it lives in admin_users. Element order is pinned by tests.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_team_role_areas(p_role text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE p_role
    WHEN 'owner'   THEN ARRAY['admin_console','team_manage','crm','beta_leads','email_drafts']
    WHEN 'admin'   THEN ARRAY['admin_console','team_manage','crm','beta_leads','email_drafts']
    WHEN 'partner' THEN ARRAY['admin_console','team_manage','crm','beta_leads','email_drafts']
    WHEN 'growth'  THEN ARRAY['role_home','crm','beta_leads','email_drafts']
    ELSE ARRAY[]::text[]
  END
$$;
COMMENT ON FUNCTION public.admin_team_role_areas(text) IS
  'Issue #3802, #4255. The one role-to-areas map. admin_console is held only by roles that live in admin_users (owner, admin, partner), so it stays equivalent to is_admin_user(). Element order is pinned by tests.';


-- ---------------------------------------------------------------------------
-- 4. Team functions and gates. Each body below is the live one with only the
--    #4255 change: team_manage instead of "is the owner", partner labelled
--    and seated in admin_users, and partner named wherever ('owner','admin')
--    was. Owner-only actions (tour reset, Work settings, agent-key overview)
--    stay owner-only.
-- ---------------------------------------------------------------------------
-- admin_team_set_member: the body from 20270831003802 with the #4255 gate and partner seat.
CREATE OR REPLACE FUNCTION public.admin_team_set_member(p_email text, p_role text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Gate FIRST. #4255 (D4): the owner, admins and partners (team_manage) may
  -- add people, change a role or remove access. Never the owner, never themselves.
  IF NOT COALESCE(public.admin_team_can('team_manage'), false) THEN
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
    SELECT CASE WHEN au.role = 'partner' THEN 'partner' ELSE 'admin' END AS r,
           au.status AS s, au.accepted_at AS aa, au.created_at AS ca
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
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('team_agent_key:' || v_email, 0));
    UPDATE public.team_agent_keys
       SET revoked_at = now(), revoked_by = v_actor, revoke_reason = 'access_removed'
     WHERE owner_email = v_email AND revoked_at IS NULL;
    UPDATE public.team_agent_setup_codes
       SET voided_at = now()
     WHERE owner_email = v_email AND consumed_at IS NULL AND voided_at IS NULL;
    v_action := 'team.remove';

  ELSIF p_role IN ('admin', 'partner') THEN
    -- Full admin seat (#4255: partner too): leave the non-admin table first
    -- (exclusivity guard), then admin_users.
    UPDATE public.admin_team_members
       SET status = 'revoked', updated_at = now()
     WHERE email = v_email AND status <> 'revoked';
    UPDATE public.admin_users
       SET role = p_role, status = p_status, accepted_at = v_accepted,
           invited_by = CASE WHEN p_status = 'invited' THEN v_actor ELSE invited_by END
     WHERE lower(btrim(email)) = v_email;
    IF NOT FOUND THEN
      INSERT INTO public.admin_users (email, role, status, invited_by, accepted_at)
      VALUES (v_email, p_role, p_status, v_actor, v_accepted);
    END IF;

  ELSE
    -- growth: leave admin_users first (revoke, never delete: other
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
$function$;

-- admin_team_role: the live body, with only the #4255 change(s) marked by the diff in this file's PR.
CREATE OR REPLACE FUNCTION public.admin_team_role()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_email text;
  v_role  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  -- Full admins: is_admin_user() stays the ONLY authority for "is a full admin".
  -- This branch only labels an already-authorised full admin as owner or admin.
  IF public.is_admin_user() THEN
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = auth.uid();
    SELECT au.role INTO v_role
    FROM public.admin_users au
    WHERE au.email = v_email AND au.status = 'active';   -- same exact match is_admin_user() uses
    -- #4255: partner is a full-admin seat too; keep its label.
    RETURN CASE WHEN v_role IN ('owner', 'partner') THEN v_role ELSE 'admin' END;
  END IF;

  SELECT m.role INTO v_role
  FROM public.admin_team_members m
  WHERE m.email = public.admin_team_caller_email()
    AND m.status = 'active';
  RETURN v_role;   -- growth | NULL (#4255: partner rows left this table)
END;
$function$;

-- admin_team_my_access: the live body, with only the #4255 change(s) marked by the diff in this file's PR.
CREATE OR REPLACE FUNCTION public.admin_team_my_access()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role  text;
  v_email text;
  v_inv   text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  v_role := public.admin_team_role();
  IF v_role IS NOT NULL THEN
    SELECT lower(btrim(u.email)) INTO v_email FROM auth.users u WHERE u.id = auth.uid();
    RETURN jsonb_build_object(
      'email', v_email, 'role', v_role, 'status', 'active',
      'areas', to_jsonb(public.admin_team_role_areas(v_role)));
  END IF;

  v_email := public.admin_team_caller_email();
  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT CASE WHEN au.role = 'partner' THEN 'partner' ELSE 'admin' END INTO v_inv
  FROM public.admin_users au
  WHERE lower(btrim(au.email)) = v_email AND au.status = 'invited'
  LIMIT 1;
  IF v_inv IS NULL THEN
    SELECT m.role INTO v_inv
    FROM public.admin_team_members m
    WHERE m.email = v_email AND m.status = 'invited';
  END IF;
  IF v_inv IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object('email', v_email, 'role', v_inv, 'status', 'invited', 'areas', '[]'::jsonb);
END;
$function$;

-- admin_team_list: the live body, with only the #4255 change(s) marked by the diff in this file's PR.
CREATE OR REPLACE FUNCTION public.admin_team_list()
 RETURNS TABLE(email text, role text, status text, invited_by text, created_at timestamp with time zone, accepted_at timestamp with time zone, is_self boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT COALESCE(public.admin_team_can('team_manage'), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH me AS (
    SELECT lower(btrim(u.email)) AS e FROM auth.users u WHERE u.id = auth.uid()
  ),
  allrows AS (
    SELECT lower(btrim(au.email)) AS e,
           CASE au.role WHEN 'owner' THEN 'owner' WHEN 'partner' THEN 'partner' ELSE 'admin' END AS r,
           au.status AS s, au.invited_by AS ib, au.created_at AS ca, au.accepted_at AS aa
    FROM public.admin_users au
    UNION ALL
    SELECT m.email, m.role, m.status, m.invited_by, m.created_at, m.accepted_at
    FROM public.admin_team_members m
  ),
  ranked AS (
    SELECT a.*, row_number() OVER (
             PARTITION BY a.e
             ORDER BY (a.s <> 'revoked') DESC, a.aa DESC NULLS LAST, a.ca DESC) AS rn
    FROM allrows a
  )
  SELECT r.e, r.r, r.s, r.ib, r.ca, r.aa, (r.e = (SELECT me.e FROM me))
  FROM ranked r
  WHERE r.rn = 1
  ORDER BY (r.r = 'owner') DESC, (r.s = 'revoked'), r.e;
END;
$function$;

-- admin_team_directory: the live body, with only the #4255 change(s) marked by the diff in this file's PR.
CREATE OR REPLACE FUNCTION public.admin_team_directory()
 RETURNS TABLE(email text, role text, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH allrows AS (
    SELECT lower(btrim(au.email)) AS e,
           CASE au.role WHEN 'owner' THEN 'owner' WHEN 'partner' THEN 'partner' ELSE 'admin' END AS r,
           au.status AS s, au.accepted_at AS aa, au.created_at AS ca
    FROM public.admin_users au
    WHERE au.status <> 'revoked'
    UNION ALL
    SELECT m.email, m.role, m.status, m.accepted_at, m.created_at
    FROM public.admin_team_members m
    WHERE m.status <> 'revoked'
  ),
  ranked AS (
    SELECT a.e, a.r, a.s,
           row_number() OVER (PARTITION BY a.e
                              ORDER BY (a.s = 'active') DESC, a.aa DESC NULLS LAST, a.ca DESC) AS rn
    FROM allrows a
    WHERE a.e IS NOT NULL AND a.e <> ''
  )
  SELECT k.e, k.r, k.s
  FROM ranked k
  WHERE k.rn = 1
  ORDER BY (k.r = 'owner') DESC, k.e
$function$;

-- admin_team_invite_states: the live body, with only the #4255 change(s) marked by the diff in this file's PR.
CREATE OR REPLACE FUNCTION public.admin_team_invite_states()
 RETURNS TABLE(email text, state text, expires_at timestamp with time zone, issued_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT COALESCE(public.admin_team_can('team_manage'), false) THEN
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
$function$;

-- admin_team_issue_invite: the live body, with only the #4255 change(s) marked by the diff in this file's PR.
CREATE OR REPLACE FUNCTION public.admin_team_issue_invite(p_email text, p_role text, p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_res   jsonb;
  v_email text;
  v_actor text;
  v_exp   timestamptz := now() + interval '7 days';
BEGIN
  IF NOT COALESCE(public.admin_team_can('team_manage'), false) THEN
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

  -- An address whose account signs in another way cannot take team access.
  IF public.admin_team_invite_address_verdict(v_email) = 'conflict' THEN
    RAISE EXCEPTION 'address_in_use' USING ERRCODE = '22023';   -- rolls the writer's change back
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
$function$;

-- admin_team_last_active: the live body, with only the #4255 change(s) marked by the diff in this file's PR.
CREATE OR REPLACE FUNCTION public.admin_team_last_active()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF NOT COALESCE(public.admin_team_can('team_manage'), false) THEN RAISE EXCEPTION 'owner_only'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('email', t.email, 'last_active_at', t.last_active_at))
      FROM (
        SELECT team.email,
               GREATEST(
                 (SELECT max(u.last_sign_in_at) FROM auth.users u WHERE lower(btrim(u.email)) = team.email),
                 (SELECT max(a.created_at) FROM public.admin_audit_log a WHERE lower(btrim(a.admin_email)) = team.email)
               ) AS last_active_at
          FROM (
            SELECT lower(btrim(au.email)) AS email FROM public.admin_users au
            UNION
            SELECT lower(btrim(m.email)) FROM public.admin_team_members m
          ) team
      ) t
  ), '[]'::jsonb);
END;
$function$;

-- admin_team_activate_self: the live body, with only the #4255 change(s) marked by the diff in this file's PR.
CREATE OR REPLACE FUNCTION public.admin_team_activate_self()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  IF v_role IN ('admin', 'partner') THEN
    UPDATE public.admin_users
       SET status = 'active', accepted_at = now()
     WHERE lower(btrim(email)) = v_email AND status = 'invited' AND role = v_role;
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
$function$;

-- activate_invited_admin: the live body, with only the #4255 change(s) marked by the diff in this file's PR.
CREATE OR REPLACE FUNCTION public.activate_invited_admin()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
                WHERE i.email = v_email AND i.role IN ('admin', 'partner')
                  AND i.redeemed_user_id = auth.uid()
                  AND i.redeemed_at > now() - interval '24 hours');
  IF FOUND THEN
    DELETE FROM public.admin_team_invites i WHERE i.email = v_email;
  END IF;
END;
$function$;

-- issue_3988_capabilities: the live body, with only the #4255 change(s) marked by the diff in this file's PR.
CREATE OR REPLACE FUNCTION public.issue_3988_capabilities()
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_caps text[] := ARRAY[]::text[];
  v_admin boolean;
  v_support boolean;
BEGIN
  -- Same team predicate as the guards (is_support_staff / community_role go
  -- through issue_3720_active_team_member), so areas can never disagree with
  -- the RPCs they open.
  IF v_uid IS NULL OR NOT public.issue_3720_active_team_member(v_uid) THEN
    RETURN v_caps;
  END IF;
  v_admin := public.is_admin_user();
  v_support := public.is_support_staff(v_uid) OR v_admin;

  IF public.community_can('moderate', v_uid) THEN
    v_caps := array_append(v_caps, 'community.moderate');
  END IF;
  IF public.community_can('publish_announcement', v_uid) THEN
    v_caps := array_append(v_caps, 'community.publish');
  END IF;
  IF v_support THEN
    v_caps := v_caps || ARRAY['support.work', 'support.presence'];
  END IF;
  IF v_admin THEN
    v_caps := array_append(v_caps, 'team.permissions');
  END IF;
  IF COALESCE(public.admin_team_can('team_manage'), false) THEN
    v_caps := array_append(v_caps, 'team.invite');
  END IF;
  RETURN v_caps;
END;
$function$;

-- issue_3720_team_my_permissions: the live body, with only the #4255 change(s) marked by the diff in this file's PR.
CREATE OR REPLACE FUNCTION public.issue_3720_team_my_permissions()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_access jsonb;
  v_role text;
  v_areas text[];
BEGIN
  v_access := public.admin_team_my_access();
  IF v_access IS NULL OR v_access->>'status' <> 'active' THEN RETURN NULL; END IF;
  v_role := v_access->>'role';
  v_areas := COALESCE(public.admin_team_my_operational_areas(), ARRAY[]::text[]);
  RETURN v_access || jsonb_build_object(
    'operational_areas', to_jsonb(v_areas),
    'permissions', jsonb_build_object(
      'support_read_reply_assign', true,
      'support_money_or_account_changes', false,
      'mentions', true,
      'data_room', v_role IN ('owner', 'admin', 'partner'),
      'data_room_audit', v_role IN ('owner', 'admin', 'partner'),
      'team_roles', v_role IN ('owner', 'admin', 'partner')
    )
  );
END;
$function$;

-- issue_3720_list_data_room_access: the live body, with only the #4255 change(s) marked by the diff in this file's PR.
CREATE OR REPLACE FUNCTION public.issue_3720_list_data_room_access(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF COALESCE(public.admin_team_role(), '') NOT IN ('owner', 'admin', 'partner') THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_limit' USING ERRCODE = '22023'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', page.id,
      'actor_email', page.actor_email,
      'role', page.role_snapshot,
      'action', page.action,
      'document_key', page.document_key,
      'succeeded', page.succeeded,
      'created_at', page.created_at
    ) ORDER BY page.created_at DESC, page.id DESC)
    FROM (
      SELECT * FROM public.team_data_room_access_log
      ORDER BY created_at DESC, id DESC LIMIT p_limit
    ) page
  ), '[]'::jsonb);
END;
$function$;

-- issue_3988_admin_people: the live body, with only the #4255 change(s) marked by the diff in this file's PR.
CREATE OR REPLACE FUNCTION public.issue_3988_admin_people()
 RETURNS TABLE(user_id uuid, email text, display_name text, team_role text, team_status text, has_signed_in boolean, role text, available boolean, effective boolean, last_active timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH team AS (
    SELECT d.email AS key_email, d.role AS t_role, d.status AS t_status,
      (SELECT u.id FROM auth.users u
        WHERE lower(btrim(u.email)) = d.email
        ORDER BY u.created_at LIMIT 1) AS uid
    FROM public.admin_team_directory() d
    WHERE d.status IN ('active', 'invited')
  ),
  leftover AS (
    -- Enabled staff rows on people who are not on the team.
    SELECT u.id AS uid, lower(btrim(u.email)) AS key_email,
      NULL::text AS t_role, 'none'::text AS t_status
    FROM auth.users u
    WHERE (
        EXISTS (SELECT 1 FROM public.support_staff ss WHERE ss.user_id = u.id AND ss.enabled)
        OR EXISTS (SELECT 1 FROM public.community_staff cs WHERE cs.user_id = u.id AND cs.enabled)
      )
      -- Anyone already listed under the team (current or invited) appears once.
      AND NOT EXISTS (
        SELECT 1 FROM team t
        WHERE t.uid = u.id OR t.key_email = lower(btrim(u.email))
      )
  ),
  everyone AS (
    SELECT t.uid, t.key_email, t.t_role, t.t_status FROM team t
    UNION ALL
    SELECT l.uid, l.key_email, l.t_role, l.t_status FROM leftover l
  )
  SELECT
    e.uid,
    e.key_email,
    COALESCE(
      NULLIF(btrim(p.display_name), ''),
      NULLIF(btrim(ss.display_name), ''),
      split_part(e.key_email, '@', 1)
    ),
    e.t_role,
    e.t_status,
    (e.uid IS NOT NULL AND e.t_status = 'active'),
    CASE
      WHEN e.t_status = 'active' AND e.t_role IN ('owner', 'admin', 'partner') THEN
        CASE WHEN ss.enabled IS TRUE THEN 'included_rota' ELSE 'included' END
      WHEN e.uid IS NOT NULL AND public.is_support_staff(e.uid) THEN
        CASE WHEN ss.role = 'lead' THEN 'lead' ELSE 'teammate' END
      ELSE 'off'
    END,
    COALESCE(ss.enabled AND ss.available AND public.is_support_staff(e.uid), false),
    NOT (
      e.t_status <> 'active'
      AND (COALESCE(ss.enabled, false) OR COALESCE(cs.enabled, false))
    ),
    -- Sign-in activity only: a role change is not the person being active.
    u.last_sign_in_at
  FROM everyone e
  LEFT JOIN auth.users u ON u.id = e.uid
  LEFT JOIN public.profiles p ON p.id = e.uid
  LEFT JOIN public.support_staff ss ON ss.user_id = e.uid
  LEFT JOIN public.community_staff cs ON cs.user_id = e.uid
  ORDER BY
    CASE WHEN e.t_status = 'active' THEN 0 WHEN e.t_status = 'invited' THEN 1 ELSE 2 END,
    CASE e.t_role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'partner' THEN 1 ELSE 2 END,
    lower(COALESCE(NULLIF(btrim(p.display_name), ''), e.key_email));
END;
$function$;

-- attest_ad_app_readiness_dimension: the live body, with only the #4255 change(s) marked by the diff in this file's PR.
CREATE OR REPLACE FUNCTION public.attest_ad_app_readiness_dimension(p_app_key text, p_os text, p_provider text, p_dimension text, p_safe_id text, p_attested_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_now timestamptz := clock_timestamp(); v_count integer;
BEGIN
  IF p_app_key NOT IN ('explorer','business') OR p_os NOT IN ('ios','android')
     OR p_provider NOT IN ('meta','tiktok','snapchat','google','reddit')
     OR p_dimension NOT IN ('native_binding','measurement')
     OR p_safe_id IS NULL OR p_safe_id !~ '^[A-Za-z0-9._:@/-]{1,160}$'
     OR p_attested_by IS NULL OR NOT EXISTS (
       SELECT 1
       FROM auth.users u
       JOIN public.admin_users au ON lower(au.email)=lower(u.email)
       WHERE u.id=p_attested_by
         AND au.status='active'
         AND au.role IN ('owner','admin','partner')
     ) THEN
    RAISE EXCEPTION 'invalid_readiness_attestation';
  END IF;
  IF p_dimension='native_binding' THEN
    UPDATE public.ad_app_provider_bindings SET
      native_binding_attested_at=v_now,
      native_binding_attestation_expires_at=v_now+interval '15 minutes',
      native_binding_attestation_safe_id=p_safe_id,
      native_binding_attestation_provenance='provider_dashboard',
      native_binding_attested_by=p_attested_by
    WHERE app_key=p_app_key AND os=p_os AND provider=p_provider AND active=true
      AND provider_app_id=p_safe_id;
  ELSE
    UPDATE public.ad_app_provider_bindings SET
      measurement_attested_at=v_now,
      measurement_attestation_expires_at=v_now+interval '15 minutes',
      measurement_attestation_safe_id=p_safe_id,
      measurement_attestation_provenance='appsflyer_dashboard',
      measurement_attested_by=p_attested_by
    WHERE app_key=p_app_key AND os=p_os AND provider=p_provider AND active=true
      AND provider_measurement_id=p_safe_id;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count<>1 THEN RAISE EXCEPTION 'readiness_attestation_target_mismatch'; END IF;
END;
$function$;

-- set_ad_app_safe_binding: the live body, with only the #4255 change(s) marked by the diff in this file's PR.
CREATE OR REPLACE FUNCTION public.set_ad_app_safe_binding(p_change jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_app text := p_change->>'app_key'; v_os text := p_change->>'os'; v_provider text := p_change->>'provider';
  v_contract text := p_change->>'provider_contract_kind'; v_app_id text := p_change->>'provider_app_id';
  v_measurement_id text := p_change->>'provider_measurement_id'; v_actor uuid := (p_change->>'actor')::uuid;
  v_reason text := btrim(p_change->>'reason'); v_expected bigint := (p_change->>'expected_current_version')::bigint;
  v_key uuid := (p_change->>'idempotency_key')::uuid; v_row public.ad_app_provider_bindings%ROWTYPE;
  v_prior jsonb; v_existing jsonb; v_expected_contract text; v_fingerprint text;
  v_existing_audit public.ad_app_binding_audit%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_change)<>'object'
     OR (p_change - ARRAY['app_key','os','provider','provider_contract_kind','provider_app_id','provider_measurement_id','actor','reason','expected_current_version','idempotency_key']) <> '{}'::jsonb
     OR v_app NOT IN ('explorer','business') OR v_os NOT IN ('ios','android')
     OR v_provider NOT IN ('meta','tiktok','snapchat','google','reddit')
     OR length(v_reason) NOT BETWEEN 8 AND 240
     OR NOT EXISTS (SELECT 1 FROM auth.users u JOIN public.admin_users a ON lower(a.email)=lower(u.email)
                    WHERE u.id=v_actor AND a.status='active' AND a.role IN ('owner','admin','partner')) THEN
    RAISE EXCEPTION 'invalid_safe_binding_change';
  END IF;
  SELECT * INTO v_row FROM public.ad_app_provider_bindings
  WHERE app_key=v_app AND os=v_os AND provider=v_provider AND active=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'binding_target_mismatch'; END IF;
  v_fingerprint := md5(jsonb_build_object(
    'provider_contract_kind',v_contract,
    'provider_app_id',v_app_id,
    'provider_measurement_id',v_measurement_id,
    'reason',v_reason
  )::text);
  SELECT * INTO v_existing_audit FROM public.ad_app_binding_audit WHERE idempotency_key=v_key;
  IF FOUND THEN
    IF v_existing_audit.actor=v_actor
       AND v_existing_audit.app_key=v_app
       AND v_existing_audit.os=v_os
       AND v_existing_audit.provider=v_provider
       AND v_existing_audit.expected_binding_version=v_expected
       AND v_existing_audit.request_fingerprint=v_fingerprint THEN
      RETURN v_existing_audit.new_safe_values || jsonb_build_object('idempotent_replay',true);
    END IF;
    RAISE EXCEPTION 'idempotency_key_conflict';
  END IF;
  IF v_row.binding_version<>v_expected THEN RAISE EXCEPTION 'binding_version_conflict'; END IF;
  v_expected_contract := CASE v_provider WHEN 'google' THEN 'app_link' WHEN 'reddit' THEN 'campaign_store_binding' ELSE 'mobile_asset' END;
  IF v_contract<>v_expected_contract THEN RAISE EXCEPTION 'provider_contract_mismatch'; END IF;
  IF v_app_id IS NOT NULL AND (v_app_id<>btrim(v_app_id) OR v_app_id !~ '^[A-Za-z0-9._:@/-]{1,160}$') THEN RAISE EXCEPTION 'invalid_provider_app_id'; END IF;
  IF v_measurement_id IS NOT NULL AND (v_measurement_id<>btrim(v_measurement_id) OR v_measurement_id !~ '^[A-Za-z0-9._:@/-]{1,160}$') THEN RAISE EXCEPTION 'invalid_provider_measurement_id'; END IF;
  IF v_provider IN ('meta','tiktok') AND ((v_app_id IS NOT NULL AND v_app_id !~ '^[0-9]{6,32}$') OR (v_measurement_id IS NOT NULL AND v_measurement_id !~ '^[0-9]{6,32}$')) THEN RAISE EXCEPTION 'invalid_numeric_provider_id'; END IF;
  IF v_provider='snapchat' AND v_app_id IS NOT NULL AND v_app_id !~ '^[A-Za-z0-9_-]{6,80}$' THEN RAISE EXCEPTION 'invalid_snap_app_id'; END IF;
  IF v_provider='google' AND v_measurement_id IS NOT NULL AND v_measurement_id !~ '^[A-Fa-f0-9]{32}$' THEN RAISE EXCEPTION 'invalid_google_link_id'; END IF;
  IF v_provider IN ('meta','snapchat') AND v_app_id IS DISTINCT FROM v_measurement_id THEN RAISE EXCEPTION 'provider_measurement_identity_mismatch'; END IF;
  IF v_provider IN ('google','reddit') AND v_app_id IS NOT NULL AND v_app_id<>(SELECT store_identifier FROM public.ad_app_targets WHERE app_key=v_app AND os=v_os) THEN RAISE EXCEPTION 'store_identifier_mismatch'; END IF;
  IF v_provider IN ('meta','snapchat') AND EXISTS (
    SELECT 1 FROM public.ad_app_provider_bindings b WHERE b.app_key=v_app AND b.os<>v_os AND b.provider=v_provider
      AND b.provider_app_id IS NOT NULL AND b.provider_app_id<>v_app_id
  ) THEN RAISE EXCEPTION 'product_app_id_mismatch'; END IF;

  v_prior := jsonb_build_object('provider_contract_kind',v_row.provider_contract_kind,'provider_app_id',v_row.provider_app_id,'provider_measurement_id',v_row.provider_measurement_id,'binding_version',v_row.binding_version);
  v_existing := jsonb_build_object('app_key',v_app,'os',v_os,'provider',v_provider,'provider_contract_kind',v_contract,
    'provider_app_id',v_app_id,'provider_measurement_id',v_measurement_id,'binding_version',v_row.binding_version+1);
  BEGIN
    INSERT INTO public.ad_app_binding_audit(
      app_key,os,provider,action,actor,reason,idempotency_key,
      expected_binding_version,request_fingerprint,previous_safe_values,new_safe_values
    ) VALUES(
      v_app,v_os,v_provider,'safe_binding_replaced',v_actor,v_reason,v_key,
      v_expected,v_fingerprint,v_prior,v_existing
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing_audit FROM public.ad_app_binding_audit WHERE idempotency_key=v_key;
    IF FOUND
       AND v_existing_audit.actor=v_actor
       AND v_existing_audit.app_key=v_app
       AND v_existing_audit.os=v_os
       AND v_existing_audit.provider=v_provider
       AND v_existing_audit.expected_binding_version=v_expected
       AND v_existing_audit.request_fingerprint=v_fingerprint THEN
      RETURN v_existing_audit.new_safe_values || jsonb_build_object('idempotent_replay',true);
    END IF;
    RAISE EXCEPTION 'idempotency_key_conflict';
  END;
  UPDATE public.ad_app_provider_bindings SET provider_contract_kind=v_contract, provider_app_id=v_app_id,
    provider_measurement_id=v_measurement_id, binding_version=binding_version+1, readiness_invalidated_at=clock_timestamp(),
    native_binding_attested_at=NULL,native_binding_attestation_expires_at=NULL,native_binding_attestation_safe_id=NULL,
    native_binding_attestation_provenance=NULL,native_binding_attested_by=NULL,measurement_attested_at=NULL,
    measurement_attestation_expires_at=NULL,measurement_attestation_safe_id=NULL,measurement_attestation_provenance=NULL,
    measurement_attested_by=NULL
  WHERE app_key=v_app AND os=v_os AND provider=v_provider;
  UPDATE public.ad_app_measurement_configurations SET status='action_required',partner_active=false,
    install_mapping_enabled=false,privacy_status='action_required',safe_measurement_id=NULL,evidence_provenance=NULL,
    evidence_summary=NULL,checked_at=NULL,expires_at=NULL,checked_by=NULL,configuration_version=configuration_version+1
  WHERE app_key=v_app AND os=v_os AND provider=v_provider;
  UPDATE public.ad_app_acquisition_canaries SET status='not_started',founder_approval_reference=NULL,
    approved_spend_ceiling_cents=NULL,approved_currency=NULL,started_at=NULL,completed_at=NULL,
    safe_provider_campaign_id=NULL,safe_evidence=NULL,evidence_expires_at=NULL,canary_version=canary_version+1
  WHERE app_key=v_app AND os=v_os AND provider=v_provider;
  RETURN v_existing || jsonb_build_object('idempotent_replay',false);
END;
$function$;

-- set_ad_app_snap_icon: the live body, with only the #4255 change(s) marked by the diff in this file's PR.
CREATE OR REPLACE FUNCTION public.set_ad_app_snap_icon(p_change jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_app text := p_change->>'app_key';
  v_os text := p_change->>'os';
  v_provider text := p_change->>'provider';
  v_icon text := btrim(p_change->>'provider_app_icon_media_id');
  v_actor uuid := (p_change->>'actor')::uuid;
  v_reason text := btrim(p_change->>'reason');
  v_expected bigint := (p_change->>'expected_current_version')::bigint;
  v_key uuid := (p_change->>'idempotency_key')::uuid;
  v_fingerprint text;
  v_row public.ad_app_provider_bindings%ROWTYPE;
  v_existing_audit public.ad_app_binding_audit%ROWTYPE;
  v_prior jsonb;
  v_next jsonb;
BEGIN
  IF jsonb_typeof(p_change) <> 'object'
     OR (p_change - ARRAY[
       'app_key','os','provider','provider_app_icon_media_id','actor','reason',
       'expected_current_version','idempotency_key'
     ]) <> '{}'::jsonb
     OR v_app NOT IN ('explorer','business')
     OR v_os NOT IN ('ios','android')
     OR v_provider <> 'snapchat'
     OR v_icon IS NULL
     OR v_icon !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR length(v_reason) NOT BETWEEN 8 AND 240
     OR NOT EXISTS (
       SELECT 1 FROM auth.users u
       JOIN public.admin_users a ON lower(a.email)=lower(u.email)
       WHERE u.id=v_actor AND a.status='active' AND a.role IN ('owner','admin','partner')
     ) THEN
    RAISE EXCEPTION 'invalid_safe_app_icon_change';
  END IF;

  SELECT * INTO v_row
  FROM public.ad_app_provider_bindings
  WHERE app_key=v_app AND os=v_os AND provider='snapchat'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'app_binding_not_found'; END IF;

  v_fingerprint := substr(encode(extensions.digest(convert_to(
    jsonb_build_object(
      'app_key',v_app,'os',v_os,'provider','snapchat',
      'provider_app_icon_media_id',v_icon,'actor',v_actor,'reason',v_reason,
      'expected_current_version',v_expected
    )::text,'UTF8'),'sha256'),'hex'),1,32);
  SELECT * INTO v_existing_audit
  FROM public.ad_app_binding_audit
  WHERE idempotency_key=v_key;
  IF FOUND THEN
    IF v_existing_audit.actor=v_actor
       AND v_existing_audit.app_key=v_app
       AND v_existing_audit.os=v_os
       AND v_existing_audit.provider='snapchat'
       AND v_existing_audit.expected_binding_version=v_expected
       AND v_existing_audit.request_fingerprint=v_fingerprint THEN
      RETURN v_existing_audit.new_safe_values ||
        jsonb_build_object('idempotent_replay',true);
    END IF;
    RAISE EXCEPTION 'idempotency_key_conflict';
  END IF;
  IF v_row.binding_version <> v_expected THEN
    RAISE EXCEPTION 'app_binding_version_conflict';
  END IF;

  v_prior := jsonb_build_object(
    'provider_app_icon_media_id',v_row.provider_app_icon_media_id,
    'binding_version',v_row.binding_version
  );
  v_next := jsonb_build_object(
    'app_key',v_app,'os',v_os,'provider','snapchat',
    'provider_app_icon_media_id',v_icon,
    'binding_version',v_row.binding_version+1
  );

  BEGIN
    INSERT INTO public.ad_app_binding_audit(
      app_key,os,provider,action,actor,reason,idempotency_key,
      expected_binding_version,request_fingerprint,previous_safe_values,new_safe_values
    ) VALUES(
      v_app,v_os,'snapchat','safe_app_icon_replaced',v_actor,v_reason,v_key,
      v_expected,v_fingerprint,v_prior,v_next
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing_audit
    FROM public.ad_app_binding_audit WHERE idempotency_key=v_key;
    IF FOUND
       AND v_existing_audit.actor=v_actor
       AND v_existing_audit.app_key=v_app
       AND v_existing_audit.os=v_os
       AND v_existing_audit.provider='snapchat'
       AND v_existing_audit.expected_binding_version=v_expected
       AND v_existing_audit.request_fingerprint=v_fingerprint THEN
      RETURN v_existing_audit.new_safe_values ||
        jsonb_build_object('idempotent_replay',true);
    END IF;
    RAISE EXCEPTION 'idempotency_key_conflict';
  END;

  UPDATE public.ad_app_provider_bindings
  SET provider_app_icon_media_id=v_icon,
      binding_version=binding_version+1,
      readiness_invalidated_at=clock_timestamp(),
      native_binding_attested_at=NULL,
      native_binding_attestation_expires_at=NULL,
      native_binding_attestation_safe_id=NULL,
      native_binding_attestation_provenance=NULL,
      native_binding_attested_by=NULL
  WHERE app_key=v_app AND os=v_os AND provider='snapchat';

  UPDATE public.ad_app_acquisition_canaries
  SET status='not_started', founder_approval_reference=NULL,
      approved_spend_ceiling_cents=NULL, approved_currency=NULL,
      started_at=NULL, completed_at=NULL, safe_provider_campaign_id=NULL,
      safe_evidence=NULL, evidence_expires_at=NULL,
      canary_version=canary_version+1
  WHERE app_key=v_app AND os=v_os AND provider='snapchat';

  RETURN v_next || jsonb_build_object('idempotent_replay',false);
END;
$function$;

-- transition_ad_app_canary: the live body, with only the #4255 change(s) marked by the diff in this file's PR.
CREATE OR REPLACE FUNCTION public.transition_ad_app_canary(p_change jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_action text := p_change->>'action';
  v_app text := p_change->>'app_key';
  v_os text := p_change->>'os';
  v_provider text := p_change->>'provider';
  v_actor uuid := (p_change->>'actor')::uuid;
  v_reason text := btrim(p_change->>'reason');
  v_expected bigint := (p_change->>'expected_canary_version')::bigint;
  v_key uuid := (p_change->>'idempotency_key')::uuid;
  v_fingerprint text;
  v_existing public.ad_app_canary_audit%ROWTYPE;
  v_row public.ad_app_acquisition_canaries%ROWTYPE;
  v_previous jsonb;
  v_next jsonb;
  v_version public.ad_plan_versions%ROWTYPE;
  v_plan public.ad_plans%ROWTYPE;
  v_allocation public.ad_plan_provider_allocations%ROWTYPE;
  v_phrase text;
  v_reference text;
  v_campaign_id text;
  v_local_campaign uuid;
  v_effective text;
  v_spend bigint;
  v_evidence jsonb;
  v_target public.ad_app_targets%ROWTYPE;
  v_settlement public.ad_campaign_settlements%ROWTYPE;
  v_media_source text;
BEGIN
  IF jsonb_typeof(p_change)<>'object'
     OR (p_change - ARRAY[
       'action','app_key','os','provider','actor','reason',
       'expected_canary_version','idempotency_key','plan_version_id','plan_hash',
       'approval_reference','confirm_phrase','external_campaign_id',
       'local_campaign_id','provider_effective_status','actual_spend_cents',
       'safe_evidence'
     ])<>'{}'::jsonb
     OR v_action NOT IN (
       'request_approval','approve','provider_prepared','provider_started',
       'provider_stopped','spend_exceeded','evidence_passed',
       'evidence_failed','expire'
     )
     OR v_app NOT IN ('explorer','business')
     OR v_os NOT IN ('ios','android')
     OR v_provider NOT IN ('meta','tiktok','snapchat','google','reddit')
     OR length(v_reason) NOT BETWEEN 8 AND 240
     OR NOT EXISTS (
       SELECT 1 FROM auth.users u
       JOIN public.admin_users a ON lower(a.email)=lower(u.email)
       WHERE u.id=v_actor AND a.status='active' AND a.role IN ('owner','admin','partner')
     ) THEN
    RAISE EXCEPTION 'invalid_app_canary_transition';
  END IF;

  SELECT * INTO v_row FROM public.ad_app_acquisition_canaries
  WHERE app_key=v_app AND os=v_os AND provider=v_provider FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'app_canary_not_found'; END IF;

  v_fingerprint := encode(extensions.digest(convert_to(
    (p_change-'idempotency_key')::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO v_existing FROM public.ad_app_canary_audit
  WHERE idempotency_key=v_key;
  IF FOUND THEN
    IF v_existing.actor=v_actor
       AND v_existing.app_key=v_app
       AND v_existing.os=v_os
       AND v_existing.provider=v_provider
       AND v_existing.expected_canary_version=v_expected
       AND v_existing.request_fingerprint=v_fingerprint THEN
      RETURN v_existing.new_state || jsonb_build_object('idempotent_replay',true);
    END IF;
    RAISE EXCEPTION 'idempotency_key_conflict';
  END IF;
  IF v_row.canary_version<>v_expected THEN
    RAISE EXCEPTION 'canary_version_conflict';
  END IF;
  v_previous := to_jsonb(v_row);

  IF v_action='request_approval' THEN
    SELECT * INTO v_version FROM public.ad_plan_versions
    WHERE id=(p_change->>'plan_version_id')::uuid
      AND plan_hash=lower(p_change->>'plan_hash');
    IF NOT FOUND THEN RAISE EXCEPTION 'canary_plan_version_mismatch'; END IF;
    SELECT * INTO v_plan FROM public.ad_plans WHERE id=v_version.plan_id;
    SELECT * INTO v_allocation FROM public.ad_plan_provider_allocations
    WHERE plan_version_id=v_version.id AND platform=v_provider;
    IF v_row.status NOT IN ('not_started','approval_required','expired','failed')
       OR v_plan.current_version_id<>v_version.id
       OR v_plan.owner_kind<>'mingla' OR v_plan.brand_id IS NOT NULL
       OR v_version.canonical_plan->>'certification_mode'<>'true'
       OR jsonb_array_length(v_version.canonical_plan->'platforms')<>1
       OR v_version.canonical_plan->'platforms'->>0<>v_provider
       OR v_version.destination_snapshot->>'app_key'<>v_app
       OR v_version.destination_snapshot->>'os'<>v_os
       OR v_allocation.id IS NULL
       OR NOT public.can_prepare_native_app_canary(v_app,v_os,v_provider)
       OR NOT EXISTS (
         SELECT 1 FROM public.ad_plan_funding_holds h
         WHERE h.plan_version_id=v_version.id
           AND h.plan_hash=v_version.plan_hash AND h.state='held'
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.ad_plan_confirmations c
         WHERE c.plan_version_id=v_version.id AND c.plan_hash=v_version.plan_hash
           AND c.required_phrase=c.provided_phrase
       )
       OR EXISTS (
         SELECT 1 FROM public.ad_plan_targeting_snapshots target
         WHERE target.plan_version_id=v_version.id AND (
           target.verdict IN ('unavailable','check_required')
           OR (target.verdict='broader' AND target.broader_accepted IS NOT TRUE)
         )
       ) THEN
      RAISE EXCEPTION 'canary_plan_not_approvable';
    END IF;
    v_phrase := 'APPROVE '||upper(v_provider)||' '||upper(v_app)||' '
      ||upper(v_os)||' '||v_allocation.host_currency||' '
      ||v_allocation.host_budget_cents::text;
    UPDATE public.ad_app_acquisition_canaries SET
      status='approval_required', plan_version_id=v_version.id,
      plan_hash=v_version.plan_hash,
      approval_scope_hash=encode(extensions.digest(convert_to(
        jsonb_build_object(
          'app_key',v_app,'os',v_os,'provider',v_provider,
          'plan_version_id',v_version.id,'plan_hash',v_version.plan_hash,
          'currency',v_allocation.host_currency,
          'spend_ceiling_cents',v_allocation.host_budget_cents
        )::text,'UTF8'),'sha256'),'hex'),
      approval_requested_by=v_actor, approval_requested_at=clock_timestamp(),
      founder_approval_reference=NULL,
      approved_spend_ceiling_cents=v_allocation.host_budget_cents,
      approved_currency=v_allocation.host_currency,
      approved_by=NULL, approved_at=NULL, approval_expires_at=NULL,
      local_campaign_id=NULL, provider_objects_created_at=NULL,
      started_at=NULL, completed_at=NULL, provider_stop_confirmed_at=NULL,
      provider_effective_status=NULL, actual_spend_cents=NULL,
      safe_provider_campaign_id=NULL, safe_evidence=NULL,
      evidence_expires_at=NULL, canary_version=canary_version+1
    WHERE app_key=v_app AND os=v_os AND provider=v_provider
    RETURNING * INTO v_row;
    v_next := to_jsonb(v_row)||jsonb_build_object('required_phrase',v_phrase);
  ELSIF v_action='approve' THEN
    IF v_row.status<>'approval_required'
       OR NOT EXISTS (
         SELECT 1 FROM auth.users u
         JOIN public.admin_users a ON lower(a.email)=lower(u.email)
         WHERE u.id=v_actor AND a.status='active' AND a.role='owner'
       ) THEN
      RAISE EXCEPTION 'canary_owner_approval_required';
    END IF;
    v_reference := btrim(p_change->>'approval_reference');
    v_phrase := 'APPROVE '||upper(v_provider)||' '||upper(v_app)||' '
      ||upper(v_os)||' '||v_row.approved_currency||' '
      ||v_row.approved_spend_ceiling_cents::text;
    IF length(v_reference) NOT BETWEEN 8 AND 240
       OR p_change->>'confirm_phrase'<>v_phrase
       OR NOT public.can_prepare_native_app_canary(v_app,v_os,v_provider) THEN
      RAISE EXCEPTION 'canary_approval_invalid';
    END IF;
    UPDATE public.ad_app_acquisition_canaries SET
      status='approved_to_prepare', founder_approval_reference=v_reference,
      approved_by=v_actor, approved_at=clock_timestamp(),
      approval_expires_at=clock_timestamp()+interval '24 hours',
      canary_version=canary_version+1
    WHERE app_key=v_app AND os=v_os AND provider=v_provider
    RETURNING * INTO v_row;
    v_next := to_jsonb(v_row)||jsonb_build_object('required_phrase',v_phrase);
  ELSIF v_action='provider_prepared' THEN
    v_campaign_id := btrim(p_change->>'external_campaign_id');
    v_local_campaign := (p_change->>'local_campaign_id')::uuid;
    v_effective := btrim(coalesce(p_change->>'provider_effective_status','PAUSED'));
    IF v_row.status<>'approved_to_prepare'
       OR v_row.approval_expires_at<=clock_timestamp()
       OR v_campaign_id !~ '^[A-Za-z0-9._:@/-]{1,160}$'
       OR length(v_effective) NOT BETWEEN 1 AND 80
       OR NOT EXISTS (
         SELECT 1 FROM public.ad_campaigns c
         WHERE c.id=v_local_campaign AND c.plan_version_id=v_row.plan_version_id
           AND c.plan_hash=v_row.plan_hash AND c.platform=v_provider
           AND c.external_campaign_id=v_campaign_id AND c.status='PAUSED'
       ) THEN
      RAISE EXCEPTION 'canary_provider_prepare_invalid';
    END IF;
    UPDATE public.ad_app_acquisition_canaries SET
      status='paused_ready', local_campaign_id=v_local_campaign,
      safe_provider_campaign_id=v_campaign_id,
      provider_objects_created_at=clock_timestamp(),
      provider_effective_status=v_effective,
      canary_version=canary_version+1
    WHERE app_key=v_app AND os=v_os AND provider=v_provider
    RETURNING * INTO v_row;
    v_next := to_jsonb(v_row);
  ELSIF v_action='provider_started' THEN
    v_effective := btrim(p_change->>'provider_effective_status');
    IF v_row.status<>'paused_ready'
       OR v_row.approval_expires_at<=clock_timestamp()
       OR length(v_effective) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'canary_provider_start_invalid';
    END IF;
    UPDATE public.ad_app_acquisition_canaries SET
      status='running', started_at=clock_timestamp(),
      provider_effective_status=v_effective,
      canary_version=canary_version+1
    WHERE app_key=v_app AND os=v_os AND provider=v_provider
    RETURNING * INTO v_row;
    v_next := to_jsonb(v_row);
  ELSIF v_action='provider_stopped' THEN
    v_effective := btrim(p_change->>'provider_effective_status');
    v_spend := (p_change->>'actual_spend_cents')::bigint;
    IF v_row.status<>'running'
       OR length(v_effective) NOT BETWEEN 1 AND 80
       OR v_spend<0
       OR NOT EXISTS (
         SELECT 1 FROM public.ad_campaign_settlements settlement
         WHERE settlement.campaign_id=v_row.local_campaign_id
           AND settlement.state IN (
             'stop_requested','provider_stopped','awaiting_final_spend',
             'ready_to_settle','settled','attention_required'
           )
       ) THEN
      RAISE EXCEPTION 'canary_provider_stop_invalid';
    END IF;
    UPDATE public.ad_app_acquisition_canaries SET
      status=CASE WHEN v_spend<=approved_spend_ceiling_cents
        THEN 'paused_pending_evidence' ELSE 'failed' END,
      completed_at=clock_timestamp(),
      provider_stop_confirmed_at=clock_timestamp(),
      provider_effective_status=v_effective, actual_spend_cents=v_spend,
      canary_version=canary_version+1
    WHERE app_key=v_app AND os=v_os AND provider=v_provider
    RETURNING * INTO v_row;
    v_next := to_jsonb(v_row);
  ELSIF v_action='spend_exceeded' THEN
    SELECT * INTO v_settlement FROM public.ad_campaign_settlements
    WHERE campaign_id=v_row.local_campaign_id;
    SELECT * INTO v_allocation FROM public.ad_plan_provider_allocations
    WHERE plan_version_id=v_row.plan_version_id AND platform=v_provider;
    IF v_row.status<>'paused_pending_evidence'
       OR v_settlement.state<>'attention_required'
       OR v_settlement.final_provider_spend_cents IS NULL
       OR v_allocation.id IS NULL THEN
      RAISE EXCEPTION 'canary_spend_failure_invalid';
    END IF;
    v_spend := CASE
      WHEN v_allocation.host_currency=v_allocation.provider_currency
        THEN v_settlement.final_provider_spend_cents
      ELSE public.ad_fx_convert_frozen_minor(
        v_settlement.final_provider_spend_cents,
        v_allocation.provider_currency,
        v_allocation.host_currency,
        v_allocation.fx_snapshot_id
      )
    END;
    IF v_spend<=v_row.approved_spend_ceiling_cents THEN
      RAISE EXCEPTION 'canary_spend_failure_invalid';
    END IF;
    UPDATE public.ad_app_acquisition_canaries SET
      status='failed', actual_spend_cents=v_spend,
      canary_version=canary_version+1
    WHERE app_key=v_app AND os=v_os AND provider=v_provider
    RETURNING * INTO v_row;
    v_next := to_jsonb(v_row);
  ELSIF v_action IN ('evidence_passed','evidence_failed') THEN
    v_evidence := p_change->'safe_evidence';
    SELECT * INTO v_target FROM public.ad_app_targets
    WHERE app_key=v_app AND os=v_os AND active=true;
    SELECT * INTO v_settlement FROM public.ad_campaign_settlements
    WHERE campaign_id=v_row.local_campaign_id;
    v_media_source := CASE v_provider
      WHEN 'meta' THEN 'facebook_int'
      WHEN 'tiktok' THEN 'tiktokglobal_int'
      WHEN 'snapchat' THEN 'snapchat_int'
      WHEN 'google' THEN 'googleadwords_int'
      WHEN 'reddit' THEN 'reddit_int'
    END;
    IF v_row.status<>'paused_pending_evidence'
       OR NOT public.is_safe_ad_app_canary_evidence(v_evidence)
       OR (v_evidence->>'result')<>(CASE v_action
         WHEN 'evidence_passed' THEN 'passed' ELSE 'failed' END)
       OR v_evidence->>'store_identifier'<>v_target.store_identifier
       OR v_evidence->>'device_os'<>v_os
       OR v_evidence->>'media_source'<>v_media_source
       OR v_evidence->>'campaign_id'<>v_row.safe_provider_campaign_id
       OR v_settlement.state<>'settled'
       OR v_settlement.final_host_spend_cents IS NULL
       OR v_settlement.final_host_spend_cents>v_row.approved_spend_ceiling_cents
       OR (v_evidence->>'install_timestamp')::timestamptz<v_row.started_at
       OR (v_evidence->>'install_timestamp')::timestamptz>v_row.completed_at THEN
      RAISE EXCEPTION 'canary_evidence_invalid';
    END IF;
    UPDATE public.ad_app_acquisition_canaries SET
      status=CASE v_action WHEN 'evidence_passed' THEN 'passed' ELSE 'failed' END,
      safe_evidence=v_evidence,
      actual_spend_cents=v_settlement.final_host_spend_cents,
      evidence_expires_at=clock_timestamp()+interval '30 days',
      canary_version=canary_version+1
    WHERE app_key=v_app AND os=v_os AND provider=v_provider
    RETURNING * INTO v_row;
    v_next := to_jsonb(v_row);
  ELSE
    IF v_row.status IN ('running','passed') THEN
      RAISE EXCEPTION 'canary_expire_invalid';
    END IF;
    UPDATE public.ad_app_acquisition_canaries SET
      status='expired', canary_version=canary_version+1
    WHERE app_key=v_app AND os=v_os AND provider=v_provider
    RETURNING * INTO v_row;
    v_next := to_jsonb(v_row);
  END IF;

  INSERT INTO public.ad_app_canary_audit(
    app_key,os,provider,action,actor,reason,idempotency_key,
    expected_canary_version,request_fingerprint,previous_state,new_state
  ) VALUES(
    v_app,v_os,v_provider,CASE v_action
      WHEN 'request_approval' THEN 'approval_requested'
      WHEN 'approve' THEN 'approved'
      WHEN 'expire' THEN 'expired'
      ELSE v_action END,
    v_actor,v_reason,v_key,v_expected,v_fingerprint,v_previous,v_next
  );
  RETURN v_next||jsonb_build_object('idempotent_replay',false);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4b. Operational areas: the Blog tab area.
-- ---------------------------------------------------------------------------
-- admin_team_my_operational_areas: the body from 20271120003988 plus the #4255 blog area.
CREATE OR REPLACE FUNCTION public.admin_team_my_operational_areas()
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role text;
  v_caps text[];
  v_areas text[] := ARRAY[]::text[];
BEGIN
  IF auth.uid() IS NULL THEN RETURN v_areas; END IF;
  v_role := public.admin_team_role();

  -- Community & Support areas are derived ONLY from the capability set (the
  -- guards' own team predicate), never from a staff row or the team role.
  v_caps := public.issue_3988_capabilities();

  IF cardinality(v_caps) > 0 THEN
    v_areas := array_append(v_areas, 'community_support');
  END IF;
  IF 'support.work' = ANY(v_caps) THEN
    v_areas := array_append(v_areas, 'community_support_support');
  END IF;
  -- Every current role sees its own team notifications.
  IF v_role IS NOT NULL THEN
    v_areas := array_append(v_areas, 'team_notifications');
  END IF;
  IF 'community.moderate' = ANY(v_caps) THEN
    v_areas := array_append(v_areas, 'community_support_community');
  END IF;
  IF v_role IN ('owner', 'admin', 'partner') THEN
    v_areas := array_append(v_areas, 'data_room');
  END IF;
  -- #4255: the Blog tab, from the same predicate every blog RPC and policy uses.
  IF public.issue_4137_blog_can_write(auth.uid()) THEN
    v_areas := array_append(v_areas, 'blog');
  END IF;

  RETURN v_areas;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. "Is the caller an active teammate?" for policies. The shared predicate
--    (issue_3720_active_team_member) is not callable by clients on purpose;
--    this wrapper answers only for the caller.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4255_is_active_teammate()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND COALESCE(public.issue_3720_active_team_member(auth.uid()), false)
$$;
REVOKE EXECUTE ON FUNCTION public.issue_4255_is_active_teammate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4255_is_active_teammate() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Blog: any active teammate writes. Publishing is unchanged
--    (issue_4137_blog_can_publish: an admin/partner seat or a Support lead).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4137_blog_can_write(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT NULL AND COALESCE(public.issue_3720_active_team_member(p_user_id), false);
$function$;
COMMENT ON FUNCTION public.issue_4137_blog_can_write(uuid) IS
  '#4137, #4255: blog writer = any active teammate (admin_users or admin_team_members, active). It is also the Blog tab area (admin_team_my_operational_areas), so the tab and its RPCs agree.';

-- ---------------------------------------------------------------------------
-- 7. Shared email drafts.
-- ---------------------------------------------------------------------------
CREATE TABLE public.admin_email_drafts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject           text NOT NULL DEFAULT '',
  document          jsonb NOT NULL DEFAULT '[]'::jsonb,
  audience          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'draft',
  author_id         uuid NOT NULL,
  author_email      text NOT NULL,
  last_editor_email text,
  revision          integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_email_drafts_status_check CHECK (status IN ('draft', 'ready_for_review')),
  CONSTRAINT admin_email_drafts_subject_len CHECK (char_length(subject) <= 300),
  CONSTRAINT admin_email_drafts_document_array CHECK (jsonb_typeof(document) = 'array'),
  CONSTRAINT admin_email_drafts_document_size CHECK (pg_column_size(document) <= 524288),
  CONSTRAINT admin_email_drafts_audience_object CHECK (jsonb_typeof(audience) = 'object'),
  CONSTRAINT admin_email_drafts_revision_positive CHECK (revision > 0)
);
CREATE INDEX admin_email_drafts_updated_idx ON public.admin_email_drafts (updated_at DESC);
COMMENT ON TABLE public.admin_email_drafts IS
  'Issue #4255. Email drafts shared by the whole team. Every active teammate reads and creates; the author or an admin/partner updates or deletes (I-4255-EMAIL-DRAFTS-TEAM-SHARED). audience is restored through the client''s restoreDraftAudience, which never pre-selects an Explorer-reaching audience.';

-- Author fields are set by the server and never change; every write bumps the
-- revision and stamps who edited last.
CREATE FUNCTION public.admin_email_drafts_stamp() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_email text;
BEGIN
  SELECT lower(btrim(u.email)) INTO v_email FROM auth.users u WHERE u.id = auth.uid();
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.author_id := auth.uid();
      NEW.author_email := COALESCE(v_email, NEW.author_email);
    END IF;
    NEW.last_editor_email := NEW.author_email;
    NEW.revision := 1;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  NEW.id := OLD.id;
  NEW.author_id := OLD.author_id;
  NEW.author_email := OLD.author_email;
  NEW.created_at := OLD.created_at;
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := now();
  NEW.last_editor_email := COALESCE(v_email, OLD.last_editor_email);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_email_drafts_stamp() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER admin_email_drafts_stamp
  BEFORE INSERT OR UPDATE ON public.admin_email_drafts
  FOR EACH ROW EXECUTE FUNCTION public.admin_email_drafts_stamp();

ALTER TABLE public.admin_email_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_email_drafts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_email_drafts TO authenticated;
GRANT ALL ON public.admin_email_drafts TO service_role;

CREATE POLICY admin_email_drafts_team_read ON public.admin_email_drafts
  FOR SELECT TO authenticated
  USING (public.issue_4255_is_active_teammate());
CREATE POLICY admin_email_drafts_team_insert ON public.admin_email_drafts
  FOR INSERT TO authenticated
  WITH CHECK (public.issue_4255_is_active_teammate() AND author_id = auth.uid());
CREATE POLICY admin_email_drafts_author_or_admin_update ON public.admin_email_drafts
  FOR UPDATE TO authenticated
  USING (public.issue_4255_is_active_teammate()
         AND (author_id = auth.uid() OR public.is_admin_user()))
  WITH CHECK (public.issue_4255_is_active_teammate());
CREATE POLICY admin_email_drafts_author_or_admin_delete ON public.admin_email_drafts
  FOR DELETE TO authenticated
  USING (public.issue_4255_is_active_teammate()
         AND (author_id = auth.uid() OR public.is_admin_user()));

-- Save one draft. p_id NULL creates; otherwise p_revision must match the
-- stored revision, or the save is refused with PT409 (someone saved first).
CREATE FUNCTION public.admin_email_draft_save(
  p_id uuid, p_subject text, p_document jsonb, p_audience jsonb, p_status text, p_revision integer)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.admin_email_drafts%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.issue_3720_active_team_member(v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_status, 'draft') NOT IN ('draft', 'ready_for_review') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  IF p_document IS NOT NULL AND jsonb_typeof(p_document) <> 'array' THEN
    RAISE EXCEPTION 'invalid_document' USING ERRCODE = '22023';
  END IF;
  IF p_audience IS NOT NULL AND jsonb_typeof(p_audience) <> 'object' THEN
    RAISE EXCEPTION 'invalid_audience' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(p_subject, '')) > 300 THEN
    RAISE EXCEPTION 'subject_too_long' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.admin_email_drafts (subject, document, audience, status, author_id, author_email)
    VALUES (COALESCE(p_subject, ''), COALESCE(p_document, '[]'::jsonb), COALESCE(p_audience, '{}'::jsonb),
            COALESCE(p_status, 'draft'), v_uid, '')
    RETURNING * INTO v_row;
    RETURN to_jsonb(v_row);
  END IF;

  SELECT * INTO v_row FROM public.admin_email_drafts d WHERE d.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.author_id <> v_uid AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_revision IS DISTINCT FROM v_row.revision THEN
    RAISE EXCEPTION 'draft_changed' USING ERRCODE = 'PT409';
  END IF;

  UPDATE public.admin_email_drafts d
     SET subject = COALESCE(p_subject, ''),
         document = COALESCE(p_document, '[]'::jsonb),
         audience = COALESCE(p_audience, '{}'::jsonb),
         status = COALESCE(p_status, 'draft')
   WHERE d.id = p_id
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_email_draft_save(uuid, text, jsonb, jsonb, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_email_draft_save(uuid, text, jsonb, jsonb, text, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_email_draft_save(uuid, text, jsonb, jsonb, text, integer) IS
  'Issue #4255. Creates (p_id NULL) or saves a shared email draft. Any active teammate creates; the author or an admin/partner saves. A stale p_revision raises draft_changed (PT409).';

CREATE FUNCTION public.admin_email_draft_delete(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_author uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.issue_3720_active_team_member(v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT d.author_id INTO v_author FROM public.admin_email_drafts d WHERE d.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('id', p_id, 'deleted', false);
  END IF;
  IF v_author <> v_uid AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.admin_email_drafts d WHERE d.id = p_id;
  RETURN jsonb_build_object('id', p_id, 'deleted', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_email_draft_delete(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_email_draft_delete(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Templates are readable by the whole team (writes stay with admins:
--    "Admins manage templates"). Teammates may upload email images into
--    their own folder.
-- ---------------------------------------------------------------------------
CREATE POLICY "Team reads templates" ON public.email_templates
  FOR SELECT TO authenticated
  USING (public.issue_4255_is_active_teammate());

CREATE POLICY admin_email_assets_team_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'admin-email-assets'
              AND public.issue_4255_is_active_teammate()
              AND (storage.foldername(name))[1] = auth.uid()::text);

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 9. Self-check. Aborts the apply unless the shape above holds.
-- ---------------------------------------------------------------------------
DO $check$
DECLARE v_fn text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.admin_team_members m WHERE m.role = 'partner' AND m.status <> 'revoked') THEN
    RAISE EXCEPTION 'issue 4255 self-check: a live partner row remains in admin_team_members';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                 WHERE t.tgrelid = 'public.admin_users'::regclass
                   AND t.tgname = 'admin_users_protect_owner' AND t.tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                 WHERE t.tgrelid = 'public.admin_users'::regclass
                   AND t.tgname = 'admin_users_protect_owner_truncate' AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION 'issue 4255 self-check: owner protection trigger missing or disabled';
  END IF;
  -- admin_console only for roles that live in admin_users.
  IF 'admin_console' = ANY (public.admin_team_role_areas('growth'))
     OR 'team_manage' = ANY (public.admin_team_role_areas('growth')) THEN
    RAISE EXCEPTION 'issue 4255 self-check: growth was given an admin area';
  END IF;
  IF NOT ('admin_console' = ANY (public.admin_team_role_areas('partner'))
          AND 'team_manage' = ANY (public.admin_team_role_areas('admin'))) THEN
    RAISE EXCEPTION 'issue 4255 self-check: partner/admin areas incomplete';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.admin_email_drafts'::regclass) THEN
    RAISE EXCEPTION 'issue 4255 self-check: admin_email_drafts has no RLS';
  END IF;
  IF has_table_privilege('anon', 'public.admin_email_drafts', 'SELECT')
     OR has_table_privilege('anon', 'public.admin_email_drafts', 'INSERT') THEN
    RAISE EXCEPTION 'issue 4255 self-check: anon can touch admin_email_drafts';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_users_protect_owner()',
    'public.admin_users_protect_owner_truncate()',
    'public.admin_email_drafts_stamp()',
    'public.admin_email_draft_save(uuid,text,jsonb,jsonb,text,integer)',
    'public.admin_email_draft_delete(uuid)',
    'public.issue_4255_is_active_teammate()',
    'public.admin_team_set_member(text,text,text)',
    'public.admin_team_issue_invite(text,text,text)'
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 4255 self-check: anon can execute %', v_fn;
    END IF;
  END LOOP;
END;
$check$;

COMMIT;
