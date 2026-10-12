-- Issue #3802 (Wave 0) — team roles for Mingla Admin, enforced in the database.
--
-- Four roles exist on the server: owner, admin, growth (Sales and marketing)
-- and partner (Founding partner).
--
--   * public.admin_users keeps meaning "full admins" and keeps its
--     ('owner','admin') role CHECK. public.is_admin_user() is NOT modified and
--     stays the only authority for "is a full admin".
--   * Every other team role lives in the new table public.admin_team_members,
--     whose role CHECK admits only 'growth' and 'partner'. One email can be
--     non-revoked in at most one of the two tables.
--   * New functions answer "what is my role" (admin_team_role) and "may I use
--     area X" (admin_team_can). The two new roles get none of the existing
--     admin access: every existing gate reads admin_users only.
--   * Role changes are owner-only and enforced in the database:
--     admin_team_set_member is the one writer, and clients hold no write
--     privilege or write policy on either table.
--
-- One transaction. Additive except section 6 (write policies and write
-- privileges on admin_users are removed; SELECT is kept on purpose).
--
-- NOT modified here: is_admin_user(), get_admin_emails(), is_admin_email(text),
-- check_invited_admin(text), activate_invited_admin(), the policy
-- "Admins can read admin_users", the constraint admin_users_role_check.
--
-- Invariants (docs/INVARIANT_REGISTRY.md):
--   I-PROPOSED-3802-FULL-ADMIN-TABLE-HOLDS-ONLY-OWNER-AND-ADMIN
--   I-PROPOSED-3802-TEAM-ACCESS-HAS-ONE-OWNER-ONLY-WRITER
--
-- ---------------------------------------------------------------------------
-- ROLLBACK (kept here as a comment; there is no down-migration file).
-- Order matters: roll the admin web client back FIRST (it calls the new
-- functions), then the database. People invited as growth/partner lose their
-- rows when the table is dropped; export admin_team_members first.
--
--   BEGIN;
--   DROP TRIGGER IF EXISTS admin_users_guard_exclusive ON public.admin_users;
--   DROP FUNCTION IF EXISTS public.admin_team_set_member(text,text,text);
--   DROP FUNCTION IF EXISTS public.admin_team_list();
--   DROP FUNCTION IF EXISTS public.admin_team_activate_self();
--   DROP FUNCTION IF EXISTS public.admin_team_my_access();
--   DROP FUNCTION IF EXISTS public.admin_team_can(text);
--   DROP FUNCTION IF EXISTS public.admin_team_role();
--   DROP FUNCTION IF EXISTS public.admin_team_role_areas(text);
--   DROP TABLE IF EXISTS public.admin_team_members;          -- drops its trigger
--   DROP FUNCTION IF EXISTS public.admin_team_guard_exclusive();
--   DROP FUNCTION IF EXISTS public.admin_team_caller_email();
--   -- Only if the previous Admin Users page must work again (prefer rolling
--   -- the client forward instead): re-create the seven admin_users write
--   -- policies verbatim from the baseline migration and
--   --   GRANT INSERT, UPDATE, DELETE ON public.admin_users TO authenticated;
--   COMMIT;
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Table: team members who are NOT full admins.
-- ---------------------------------------------------------------------------
CREATE TABLE public.admin_team_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  role        text NOT NULL,
  status      text NOT NULL DEFAULT 'invited',
  invited_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_team_members_email_key UNIQUE (email),
  CONSTRAINT admin_team_members_email_normalised CHECK (email = lower(btrim(email)) AND email <> ''),
  -- 'owner' and 'admin' are excluded on purpose: this table can never confer
  -- full-admin access.
  CONSTRAINT admin_team_members_role_check CHECK (role IN ('growth','partner')),
  CONSTRAINT admin_team_members_status_check CHECK (status IN ('active','invited','revoked'))
);
ALTER TABLE public.admin_team_members ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: every read and write goes through the functions below.
REVOKE ALL ON public.admin_team_members FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_team_members TO service_role;
COMMENT ON TABLE public.admin_team_members IS
  'Issue #3802. Team members who are NOT full admins (growth, partner). Full admins (owner, admin) live in admin_users, the only table is_admin_user() reads. The role CHECK here and admin_users_role_check together make it impossible for a growth/partner person to satisfy any existing admin gate. No client reads or writes: use admin_team_* functions.';

-- ---------------------------------------------------------------------------
-- 2. Caller identity helper (internal).
--
-- Called only from the SECURITY DEFINER functions below. Requires a confirmed
-- mailbox for the NEW roles; the full-admin branch of admin_team_role()
-- deliberately does not use it, so existing admins see zero change.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.admin_team_caller_email() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT lower(btrim(u.email))
  FROM auth.users u
  WHERE u.id = auth.uid()
    AND u.email IS NOT NULL
    AND u.email_confirmed_at IS NOT NULL
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_caller_email() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_caller_email() TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Role, areas, "may I".
-- ---------------------------------------------------------------------------

-- The caller's ACTIVE team role, or NULL.  owner | admin | growth | partner | NULL
CREATE FUNCTION public.admin_team_role() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
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
    RETURN CASE WHEN v_role = 'owner' THEN 'owner' ELSE 'admin' END;
  END IF;

  SELECT m.role INTO v_role
  FROM public.admin_team_members m
  WHERE m.email = public.admin_team_caller_email()
    AND m.status = 'active';
  RETURN v_role;   -- growth | partner | NULL
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_role() TO authenticated, service_role;

-- The ONE place that maps a role to the areas it may use. Later waves add areas here.
--
-- NEVER add 'admin_console' to a non-admin role — see
-- I-PROPOSED-3802-FULL-ADMIN-TABLE-HOLDS-ONLY-OWNER-AND-ADMIN. 'admin_console'
-- means every existing admin page, table and action, and must stay equivalent
-- to is_admin_user() for every caller.
CREATE FUNCTION public.admin_team_role_areas(p_role text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE p_role
    WHEN 'owner'   THEN ARRAY['admin_console','team_manage']
    WHEN 'admin'   THEN ARRAY['admin_console']
    WHEN 'growth'  THEN ARRAY['role_home']
    WHEN 'partner' THEN ARRAY['role_home']
    ELSE ARRAY[]::text[]
  END
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_role_areas(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_role_areas(text) TO authenticated, service_role;

-- "May the caller use area X?"  Used by ALL new work from Wave 1 on.
-- Owner/admin-only objects keep using public.is_admin_user().
CREATE FUNCTION public.admin_team_can(p_area text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT COALESCE(p_area = ANY (public.admin_team_role_areas(public.admin_team_role())), false)
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_can(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_can(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Exclusivity: one non-revoked membership per email across both tables.
--
-- Data-only (reads no JWT). SECURITY INVOKER: every writer (function owner,
-- service_role, postgres) can read both tables.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.admin_team_guard_exclusive() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'revoked' THEN
    RETURN NEW;
  END IF;
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

CREATE TRIGGER admin_users_guard_exclusive
  BEFORE INSERT OR UPDATE OF email, status ON public.admin_users
  FOR EACH ROW EXECUTE FUNCTION public.admin_team_guard_exclusive();
CREATE TRIGGER admin_team_members_guard_exclusive
  BEFORE INSERT OR UPDATE OF email, status ON public.admin_team_members
  FOR EACH ROW EXECUTE FUNCTION public.admin_team_guard_exclusive();

-- ---------------------------------------------------------------------------
-- 5. Client-facing functions. authenticated may call each; each gates inside.
-- ---------------------------------------------------------------------------

-- The single thing the client reads after sign-in.
-- Returns NULL (no access) or
--   { "email", "role": owner|admin|growth|partner, "status": active|invited, "areas": text[] }
-- "areas" is always [] while invited.
CREATE FUNCTION public.admin_team_my_access() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
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

  SELECT 'admin' INTO v_inv
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
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_my_access() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_my_access() TO authenticated, service_role;

-- First sign-in of an invited person. Idempotent: a second call changes
-- nothing and writes no audit row. It only ever flips the caller's OWN invited
-- row; it cannot change a role.
CREATE FUNCTION public.admin_team_activate_self() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_a int := 0;
  v_b int := 0;
BEGIN
  v_email := public.admin_team_caller_email();
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.admin_users
     SET status = 'active', accepted_at = now()
   WHERE lower(btrim(email)) = v_email AND status = 'invited';
  GET DIAGNOSTICS v_a = ROW_COUNT;

  UPDATE public.admin_team_members
     SET status = 'active', accepted_at = now(), updated_at = now()
   WHERE email = v_email AND status = 'invited';
  GET DIAGNOSTICS v_b = ROW_COUNT;

  IF v_a + v_b > 0 THEN
    INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, metadata)
    VALUES (v_email, 'team.activate', 'team_member', v_email, '{}'::jsonb);
  END IF;

  RETURN public.admin_team_my_access();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_activate_self() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_activate_self() TO authenticated, service_role;

-- Owner-only roster. One row per person: the non-revoked row wins; a person
-- revoked in both tables shows their most recent row.
CREATE FUNCTION public.admin_team_list()
RETURNS TABLE (email text, role text, status text, invited_by text,
               created_at timestamptz, accepted_at timestamptz, is_self boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF NOT COALESCE(public.admin_team_role() = 'owner', false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH me AS (
    SELECT lower(btrim(u.email)) AS e FROM auth.users u WHERE u.id = auth.uid()
  ),
  allrows AS (
    SELECT lower(btrim(au.email)) AS e,
           CASE WHEN au.role = 'owner' THEN 'owner' ELSE 'admin' END AS r,
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
$$;
REVOKE EXECUTE ON FUNCTION public.admin_team_list() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_list() TO authenticated, service_role;

-- The ONLY writer of team membership. Owner-only.
--
--   invite            (email, role, 'invited')
--   change role       (email, newRole, currentStatus)   -- row moves table when crossing admin / non-admin
--   remove access     (email, currentRole, 'revoked')   -- rows are revoked, never deleted
--   undo              (email, previous.role, previous.status)
--
-- It can never assign 'owner', change the owner's row, or change the caller.
-- A repeated identical request returns changed:false and writes nothing.
-- Error tokens (the message starts with one): forbidden, invalid_email,
-- invalid_role, invalid_status, cannot_change_self, cannot_change_owner,
-- never_activated, not_found, team_membership_conflict.
CREATE FUNCTION public.admin_team_set_member(p_email text, p_role text, p_status text)
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
-- 6. Team membership is written only through the functions above.
--
-- After this block the only writers of admin_users are admin_team_set_member
-- (owner), admin_team_activate_self and the untouched activate_invited_admin
-- (own invited row only), and trusted roles (postgres, service_role).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can insert admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Admins can update admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Admins can delete admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "admin_insert_admin_users"      ON public.admin_users;
DROP POLICY IF EXISTS "admin_update_admin_users"      ON public.admin_users;
DROP POLICY IF EXISTS "admin_delete_admin_users"      ON public.admin_users;
DROP POLICY IF EXISTS "self_activate_admin_users"     ON public.admin_users;

-- SELECT is kept on purpose: inline policy subqueries on other tables
-- (EXISTS (SELECT 1 FROM admin_users ...)) run as the caller. Revoking SELECT
-- would turn "false" into a permission error across the product, including
-- for anonymous reads. Do not add SELECT to this list, and do not touch the
-- policy "Admins can read admin_users".
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.admin_users FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Self-check. Aborts the apply unless the access shape above really holds.
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  v_role   text;
  v_priv   text;
  v_fn     text;
  v_owners int;
BEGIN
  -- 7.1 clients hold no write privilege on admin_users.
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
      IF has_table_privilege(v_role, 'public.admin_users', v_priv) THEN
        RAISE EXCEPTION 'issue 3802 self-check: % still holds % on admin_users', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- 7.2 SELECT is still there (guards against an over-eager revoke).
  IF NOT has_table_privilege('authenticated', 'public.admin_users', 'SELECT') THEN
    RAISE EXCEPTION 'issue 3802 self-check: authenticated lost SELECT on admin_users';
  END IF;

  -- 7.3 no write policy remains on admin_users.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
             WHERE p.polrelid = 'public.admin_users'::regclass
               AND p.polcmd IN ('a','w','d','*')) THEN
    RAISE EXCEPTION 'issue 3802 self-check: a write policy remains on admin_users';
  END IF;

  -- 7.4 clients hold nothing on admin_team_members.
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF has_table_privilege(v_role, 'public.admin_team_members', v_priv) THEN
        RAISE EXCEPTION 'issue 3802 self-check: % holds % on admin_team_members', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- 7.5 anon can execute none of the new functions.
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_team_set_member(text,text,text)',
    'public.admin_team_list()',
    'public.admin_team_activate_self()',
    'public.admin_team_my_access()',
    'public.admin_team_can(text)',
    'public.admin_team_role()',
    'public.admin_team_role_areas(text)',
    'public.admin_team_caller_email()',
    'public.admin_team_guard_exclusive()'
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 3802 self-check: anon can execute %', v_fn;
    END IF;
  END LOOP;

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
