-- #3660 Phase 2 — brand-scoped team member removal (Host Team UI).
-- Caller must hold brand_admin+ on the member's brand. Cannot remove the
-- brands.account_id owner. Cannot remove a brand_owner row unless the caller
-- is also brand_owner (admins remove non-owner roles only). Active Mingla
-- Partner memberships must use partner_disconnect_link (atomic dual-stamp).
--
-- A BEFORE UPDATE/DELETE trigger mirrors the same invariants so RLS-direct
-- writers (including Ari revoke_brand_member before it was routed here) cannot
-- bypass the RPC. The transfer GUC (`app.allow_brand_owner_transfer`) bypasses
-- the guard for admin_reassign_brand_owner / accept_invite_and_transfer paths
-- that already arm it. Soft-deleted brands may CASCADE-delete owner rows when
-- auth.users is purged (delete-user).

-- Drop the single-arg overload if a prior tip shipped it; brand+member is the
-- only signature (binds Ari revoke to the confirmed brand_id).
DROP FUNCTION IF EXISTS public.biz_remove_brand_team_member(uuid);

CREATE OR REPLACE FUNCTION public.biz_remove_brand_team_member(
  p_brand_id uuid,
  p_member_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_member public.brand_team_members%ROWTYPE;
  v_caller uuid := auth.uid();
  v_caller_rank integer;
  v_after jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_member
  FROM public.brand_team_members
  WHERE id = p_member_id
    AND brand_id = p_brand_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_member.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_removed' USING ERRCODE = 'P0003';
  END IF;

  v_caller_rank := public.biz_brand_effective_rank(v_member.brand_id, v_caller);
  IF v_caller_rank < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0004';
  END IF;

  -- Never remove the brand's account owner via this path.
  IF v_member.user_id = (
    SELECT b.account_id FROM public.brands b WHERE b.id = v_member.brand_id
  ) THEN
    RAISE EXCEPTION 'cannot_remove_brand_account' USING ERRCODE = 'P0005';
  END IF;

  -- Admins may not remove brand_owner rows; only an owner can.
  IF v_member.role = 'brand_owner'
     AND v_caller_rank < public.biz_role_rank('brand_owner') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0004';
  END IF;

  -- Active partner links must use partner_disconnect_link (stamps link +
  -- membership atomically for split eligibility).
  IF EXISTS (
    SELECT 1
    FROM public.partner_brand_links pl
    WHERE pl.brand_id = v_member.brand_id
      AND pl.partner_account_id = v_member.user_id
      AND pl.accepted_at IS NOT NULL
      AND pl.cancelled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'active_partner_use_disconnect' USING ERRCODE = 'P0006';
  END IF;

  -- Accepted rows soft-close; never-accepted rows DELETE (CHECK constraint).
  IF v_member.accepted_at IS NOT NULL THEN
    UPDATE public.brand_team_members
    SET removed_at = now()
    WHERE id = p_member_id
      AND brand_id = p_brand_id
    RETURNING to_jsonb(brand_team_members) INTO v_after;
  ELSE
    DELETE FROM public.brand_team_members
    WHERE id = p_member_id
      AND brand_id = p_brand_id;
    v_after := jsonb_build_object('deleted', true, 'id', p_member_id);
  END IF;

  BEGIN
    INSERT INTO public.audit_log
      (user_id, brand_id, action, target_type, target_id, after)
    VALUES (
      v_caller,
      v_member.brand_id,
      'brand_team_member_removed',
      'brand_team_member',
      p_member_id::text,
      jsonb_build_object(
        'removed_user_id', v_member.user_id,
        'removed_role', v_member.role,
        'by_rank', v_caller_rank
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_after;
END;
$$;

ALTER FUNCTION public.biz_remove_brand_team_member(uuid, uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.biz_remove_brand_team_member(uuid, uuid) IS
  '#3660: brand_admin+ removes a team member on a bound brand_id; refuse brand account owner, admin-removing-owner, and active partner links; soft-close accepted rows.';

REVOKE ALL ON FUNCTION public.biz_remove_brand_team_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_remove_brand_team_member(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Table-level enforcement: same removal rules for every writer (RLS UPDATE,
-- Ari tools, RPCs). partner_disconnect_link / admin_reassign arm
-- app.allow_brand_owner_transfer so legitimate owner handovers still pass.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_brand_team_members_removal_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_rank integer;
  v_account uuid;
  v_brand_deleted_at timestamptz;
  v_is_soft_remove boolean := false;
  v_transfer_armed boolean :=
    current_setting('app.allow_brand_owner_transfer', true) = 'on';
BEGIN
  -- Trusted owner-transfer / reassignment paths (ORCH-1081 / #3622) arm this
  -- GUC for the transaction; do not fight them.
  IF v_transfer_armed THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT b.account_id, b.deleted_at
      INTO v_account, v_brand_deleted_at
    FROM public.brands b WHERE b.id = OLD.brand_id;

    -- Accepted rows must soft-close (removed_at), not hard-DELETE — closes the
    -- RLS "Brand admin plus delete brand_team_members" bypass of soft-close +
    -- audit. Exception: brand already soft-deleted (delete-user → CASCADE from
    -- auth.users) may purge the account-owner membership row.
    IF OLD.accepted_at IS NOT NULL THEN
      IF OLD.user_id = v_account AND v_brand_deleted_at IS NOT NULL THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0004';
    END IF;

    -- Never-accepted: still refuse deleting the live brand account owner row
    -- (or an active partner membership) outside the transfer GUC.
    IF OLD.user_id = v_account AND v_brand_deleted_at IS NULL THEN
      RAISE EXCEPTION 'cannot_remove_brand_account' USING ERRCODE = 'P0005';
    END IF;

    IF v_caller IS NOT NULL THEN
      v_caller_rank := public.biz_brand_effective_rank(OLD.brand_id, v_caller);
      IF OLD.role = 'brand_owner'
         AND v_caller_rank < public.biz_role_rank('brand_owner') THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0004';
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.partner_brand_links pl
      WHERE pl.brand_id = OLD.brand_id
        AND pl.partner_account_id = OLD.user_id
        AND pl.accepted_at IS NOT NULL
        AND pl.cancelled_at IS NULL
    ) THEN
      RAISE EXCEPTION 'active_partner_use_disconnect' USING ERRCODE = 'P0006';
    END IF;

    RETURN OLD;
  END IF;

  -- UPDATE: demotion away from brand_owner is owner-only (closes demote-then-
  -- remove via the rank-50 UPDATE policy documented on #3622).
  IF OLD.role = 'brand_owner'
     AND NEW.role IS DISTINCT FROM 'brand_owner' THEN
    IF v_caller IS NULL THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0004';
    END IF;
    v_caller_rank := public.biz_brand_effective_rank(NEW.brand_id, v_caller);
    IF v_caller_rank < public.biz_role_rank('brand_owner') THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0004';
    END IF;
  END IF;

  -- UPDATE: only care when removed_at is newly stamped.
  IF NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL THEN
    v_is_soft_remove := true;
  END IF;
  IF NOT v_is_soft_remove THEN
    RETURN NEW;
  END IF;

  SELECT b.account_id INTO v_account
  FROM public.brands b WHERE b.id = NEW.brand_id;
  IF NEW.user_id = v_account THEN
    RAISE EXCEPTION 'cannot_remove_brand_account' USING ERRCODE = 'P0005';
  END IF;

  IF v_caller IS NOT NULL THEN
    v_caller_rank := public.biz_brand_effective_rank(NEW.brand_id, v_caller);
    IF NEW.role = 'brand_owner'
       AND v_caller_rank < public.biz_role_rank('brand_owner') THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0004';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.partner_brand_links pl
    WHERE pl.brand_id = NEW.brand_id
      AND pl.partner_account_id = NEW.user_id
      AND pl.accepted_at IS NOT NULL
      AND pl.cancelled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'active_partner_use_disconnect' USING ERRCODE = 'P0006';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.tg_brand_team_members_removal_guard() OWNER TO postgres;

DROP TRIGGER IF EXISTS brand_team_members_removal_guard ON public.brand_team_members;
CREATE TRIGGER brand_team_members_removal_guard
  BEFORE UPDATE OR DELETE ON public.brand_team_members
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_brand_team_members_removal_guard();

COMMENT ON FUNCTION public.tg_brand_team_members_removal_guard() IS
  '#3660: refuse soft-remove/delete/demotion of brand_owner outside owner rank or app.allow_brand_owner_transfer; refuse DELETE of accepted rows except soft-deleted brand CASCADE; refuse active partner membership outside partner_disconnect_link.';
