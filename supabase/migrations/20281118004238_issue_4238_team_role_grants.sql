-- Issue #4238 — who can grant brand team roles and extra permissions.
--
-- APPLIED MANUALLY BY SETH (reviewed migration gate). Never applied from a chat.
-- Idempotent: every object is CREATE OR REPLACE / DROP ... IF EXISTS, the
-- privilege statements are absolute, and the one data step only touches rows
-- that still match its predicate.
--
-- Rules (approved by Seth on #4238, 18 Nov 2026):
--   1. Only the brand owner (brands.account_id) may grant `finance_manager` or
--      `brand_owner`, by invitation or any role change.
--   2. Nobody changes their own role or their own permissions_override.
--      Removing yourself / leaving is unchanged.
--   3. A brand admin may still invite roles up to and including brand_admin,
--      except finance_manager. There is no client path that writes
--      permissions_override; after this migration only service-role edge
--      functions and SECURITY DEFINER RPCs can, so payout and withdraw powers
--      stay owner-only.
--   4. The `authenticated` and `anon` roles can no longer write `role`,
--      `permissions_override`, `user_id`, `brand_id`, `id` or `invited_at` on
--      public.brand_team_members, and cannot INSERT rows at all. Every product
--      write already goes through SECURITY DEFINER RPCs (accept invite,
--      remove member, owner hand-over, admin console) or service-role edge
--      functions (ToS acceptance), which keep working.
--
-- What this adds:
--   A. Column privileges on brand_team_members (rule 4).
--   B. brand_team_members_grant_guard: a BEFORE INSERT/UPDATE trigger that
--      refuses the same writes from client roles even if a broad grant is
--      re-added later (rule 4, defence in depth).
--   C. brand_invitations_grant_guard: a BEFORE INSERT/UPDATE trigger on
--      brand_invitations (rules 1 and 2). An invitation is what becomes a role
--      on accept, so the invitation is where the grant is checked. It applies
--      to client roles and to the service-role invite-brand-member edge
--      function.
--   D. Pending finance_manager / brand_owner invitations whose inviter is not
--      the current brand owner are revoked, so accepting one cannot grant an
--      owner-only role (rule 1).
--
-- The trigger functions are SECURITY INVOKER on purpose: `current_user` must be
-- the caller's role (authenticated / anon for direct client writes; service_role
-- for edge functions; the definer's owner inside SECURITY DEFINER RPCs). Lookups
-- that client roles cannot read go through issue_4238_team_grant_refusal, which
-- is SECURITY DEFINER and, for client sessions, only answers about the caller's
-- own invitations.

-- ── Shared rule check (SECURITY DEFINER, internal) ─────────────────────────
-- Returns NULL when an invitation grant is allowed, else a refusal reason.
-- Invariant I-4238-TEAM-GRANTS (machine-readable, enforced here and by
-- supabase/migrations/__tests__/issue_4238_team_role_grants.implementor.pg17.test.sql):
--   {"id":"I-4238-TEAM-GRANTS",
--    "owner_only_roles":["finance_manager","brand_owner"],
--    "no_self_grant":true,
--    "client_locked_columns":{"brand_team_members":["id","brand_id","user_id","role","permissions_override","invited_at"],
--                             "brand_invitations":["brand_id","email","role","invited_by","token_hash","outgoing_disposition"]},
--    "client_insert_brand_team_members":false,
--    "gates":["brand_team_members_grant_guard","brand_invitations_grant_guard","invite-brand-member inviteRoleDecision"]}
CREATE OR REPLACE FUNCTION public.issue_4238_team_grant_refusal(
  p_brand_id uuid,
  p_inviter uuid,
  p_role text,
  p_invitee_email text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_owner uuid;
  v_inviter_email text;
BEGIN
  -- Client sessions may only ask about invitations they send themselves, so
  -- this function answers nothing about other accounts.
  IF coalesce(current_setting('role', true), '') IN ('authenticated', 'anon')
     AND p_inviter IS DISTINCT FROM auth.uid() THEN
    RETURN 'not_inviter';
  END IF;

  SELECT b.account_id INTO v_owner FROM public.brands b WHERE b.id = p_brand_id;

  -- Rule 2: an invitation addressed to the inviter would change their own role
  -- on accept.
  IF p_inviter IS NOT NULL AND p_invitee_email IS NOT NULL THEN
    SELECT u.email INTO v_inviter_email FROM auth.users u WHERE u.id = p_inviter;
    IF v_inviter_email IS NULL THEN
      SELECT a.email INTO v_inviter_email
        FROM public.creator_accounts a WHERE a.id = p_inviter;
    END IF;
    IF v_inviter_email IS NOT NULL
       AND lower(btrim(v_inviter_email)) = lower(btrim(p_invitee_email)) THEN
      RETURN 'self_role_change';
    END IF;
  END IF;

  -- Rule 1: owner-only roles.
  IF p_role IN ('finance_manager', 'brand_owner') THEN
    IF p_inviter IS NOT NULL AND p_inviter = v_owner THEN
      RETURN NULL;
    END IF;
    -- A partner who set the brand up re-issues the pending owner invitation
    -- through partner_reissue_brand_invitation (ORCH-1384); keep that path.
    IF p_role = 'brand_owner' AND p_inviter IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.partner_brand_links pl
       WHERE pl.brand_id = p_brand_id
         AND pl.partner_account_id = p_inviter
         AND pl.accepted_at IS NULL
         AND pl.cancelled_at IS NULL
    ) THEN
      RETURN NULL;
    END IF;
    RETURN 'owner_only_role';
  END IF;

  RETURN NULL;
END;
$function$;

ALTER FUNCTION public.issue_4238_team_grant_refusal(uuid, uuid, text, text) OWNER TO postgres;
-- authenticated needs EXECUTE because the invoker trigger below calls this
-- function during a client's own INSERT/UPDATE; the not_inviter branch keeps
-- it to the caller's own invitations.
REVOKE ALL ON FUNCTION public.issue_4238_team_grant_refusal(uuid, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4238_team_grant_refusal(uuid, uuid, text, text)
  TO authenticated, service_role;
COMMENT ON FUNCTION public.issue_4238_team_grant_refusal(uuid, uuid, text, text) IS
  'Issue #4238 I-4238-TEAM-GRANTS: NULL when an invitation grant is allowed; else owner_only_role (finance_manager / brand_owner need the brand owner), self_role_change (an invitation to the inviter) or not_inviter (a client session asking about an invitation it does not send).';

-- ── C. brand_invitations guard ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4238_brand_invitations_grant_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_client boolean := current_user IN ('authenticated', 'anon');
  v_reason text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Clients revoke invitations (status / revoked_at); they never rewrite
    -- who is invited, to what, or by whom.
    IF v_client AND (
         NEW.brand_id IS DISTINCT FROM OLD.brand_id
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.role IS DISTINCT FROM OLD.role
      OR NEW.invited_by IS DISTINCT FROM OLD.invited_by
      OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
      OR NEW.outgoing_disposition IS DISTINCT FROM OLD.outgoing_disposition
    ) THEN
      RAISE EXCEPTION 'permission denied: brand invitation details cannot be changed'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.role IS NOT DISTINCT FROM OLD.role
       AND NEW.email IS NOT DISTINCT FROM OLD.email
       AND NEW.invited_by IS NOT DISTINCT FROM OLD.invited_by
       AND NEW.brand_id IS NOT DISTINCT FROM OLD.brand_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Grants are checked for client roles and for service-role edge functions
  -- (invite-brand-member). SECURITY DEFINER RPCs owned by postgres (partner
  -- re-issue, accept) and migrations carry their own checks.
  IF current_user NOT IN ('authenticated', 'anon', 'service_role') THEN
    RETURN NEW;
  END IF;

  v_reason := public.issue_4238_team_grant_refusal(
    NEW.brand_id, NEW.invited_by, NEW.role, NEW.email
  );
  IF v_reason = 'not_inviter' THEN
    RAISE EXCEPTION 'permission denied: an invitation is sent by the signed-in user (not_inviter)'
      USING ERRCODE = '42501';
  ELSIF v_reason = 'owner_only_role' THEN
    RAISE EXCEPTION 'permission denied: only the brand owner can invite a % (owner_only_role)', NEW.role
      USING ERRCODE = '42501';
  ELSIF v_reason = 'self_role_change' THEN
    RAISE EXCEPTION 'permission denied: you cannot invite yourself (self_role_change)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.issue_4238_brand_invitations_grant_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_4238_brand_invitations_grant_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS brand_invitations_grant_guard ON public.brand_invitations;
CREATE TRIGGER brand_invitations_grant_guard
  BEFORE INSERT OR UPDATE ON public.brand_invitations
  FOR EACH ROW EXECUTE FUNCTION public.issue_4238_brand_invitations_grant_guard();

-- ── B. brand_team_members guard ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4238_brand_team_members_grant_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Service role, SECURITY DEFINER RPCs (owned by postgres) and migrations
  -- are the sanctioned writers; they carry their own authorisation checks.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'permission denied: brand team members are added by accepting an invitation'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.brand_id IS DISTINCT FROM OLD.brand_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.permissions_override IS DISTINCT FROM OLD.permissions_override
     OR NEW.invited_at IS DISTINCT FROM OLD.invited_at THEN
    RAISE EXCEPTION 'permission denied: team roles and permissions change only through an invitation'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.issue_4238_brand_team_members_grant_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_4238_brand_team_members_grant_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS brand_team_members_grant_guard ON public.brand_team_members;
CREATE TRIGGER brand_team_members_grant_guard
  BEFORE INSERT OR UPDATE ON public.brand_team_members
  FOR EACH ROW EXECUTE FUNCTION public.issue_4238_brand_team_members_grant_guard();

-- ── A. Column privileges on brand_team_members (rule 4) ────────────────────
-- Table-level INSERT/UPDATE covered every column; replace them with the
-- columns clients may still touch under the existing RLS policies.
REVOKE INSERT, UPDATE ON public.brand_team_members FROM anon, authenticated;
GRANT UPDATE (accepted_at, removed_at, mingla_tos_accepted_at, mingla_tos_version_accepted)
  ON public.brand_team_members TO authenticated;

-- ── D. Pending owner-only invitations not sent by the current owner ────────
-- Read-only probe for Seth before apply (counts the rows this step revokes):
--   SELECT count(*) FROM public.brand_invitations i JOIN public.brands b ON b.id = i.brand_id
--    WHERE i.status = 'pending' AND i.role IN ('finance_manager','brand_owner')
--      AND public.issue_4238_team_grant_refusal(i.brand_id, i.invited_by, i.role, NULL) IS NOT NULL;
UPDATE public.brand_invitations i
   SET status = 'revoked',
       revoked_at = coalesce(i.revoked_at, now())
 WHERE i.status = 'pending'
   AND i.role IN ('finance_manager', 'brand_owner')
   AND public.issue_4238_team_grant_refusal(i.brand_id, i.invited_by, i.role, NULL) IS NOT NULL;

-- ── Self-checks ────────────────────────────────────────────────────────────
DO $check$
BEGIN
  IF has_column_privilege('authenticated', 'public.brand_team_members', 'role', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.brand_team_members', 'permissions_override', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.brand_team_members', 'user_id', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.brand_team_members', 'INSERT')
     OR has_table_privilege('anon', 'public.brand_team_members', 'INSERT')
     OR has_column_privilege('anon', 'public.brand_team_members', 'role', 'UPDATE') THEN
    RAISE EXCEPTION 'ISSUE-4238: client roles can still write brand team roles';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.brand_team_members', 'removed_at', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.brand_team_members', 'mingla_tos_accepted_at', 'UPDATE') THEN
    RAISE EXCEPTION 'ISSUE-4238: authenticated lost UPDATE on removed_at / ToS columns';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.brand_team_members', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.brand_team_members', 'DELETE') THEN
    RAISE EXCEPTION 'ISSUE-4238: authenticated lost SELECT/DELETE on brand_team_members';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'brand_team_members_grant_guard'
                   AND tgrelid = 'public.brand_team_members'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'brand_invitations_grant_guard'
                   AND tgrelid = 'public.brand_invitations'::regclass) THEN
    RAISE EXCEPTION 'ISSUE-4238: grant guard triggers missing';
  END IF;
END
$check$;
