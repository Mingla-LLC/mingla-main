-- #3660 Phase 2 — brand-scoped team member removal (Host Team UI).
-- Caller must hold brand_admin+ on the member's brand. Cannot remove the
-- brands.account_id owner. Cannot remove a brand_owner row unless the caller
-- is also brand_owner (admins remove non-owner roles only). Active Mingla
-- Partner memberships must use partner_disconnect_link (atomic dual-stamp).
--
-- A BEFORE UPDATE/DELETE trigger mirrors the same invariants so RLS-direct
-- writers cannot bypass the RPC. The transfer GUC
-- (`app.allow_brand_owner_transfer`) bypasses the guard for admin_reassign /
-- accept_invite_and_transfer. Authenticated callers cannot hard-DELETE
-- accepted rows; JWT-less CASCADE from auth.users / brands (delete-user and
-- test cleanup) is allowed. Membership brand_id/user_id stay immutable on
-- demotion / soft-remove transitions.

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

  -- Authorize on the bound brand BEFORE locking/probing the member row so
  -- unauthorized callers cannot distinguish not_found vs already_removed.
  v_caller_rank := public.biz_brand_effective_rank(p_brand_id, v_caller);
  IF v_caller_rank < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0004';
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
-- Table-level enforcement
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
  v_is_soft_remove boolean := false;
  v_transfer_armed boolean :=
    current_setting('app.allow_brand_owner_transfer', true) = 'on';
BEGIN
  -- Trusted owner-transfer / reassignment paths arm this GUC for the txn.
  IF v_transfer_armed THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT b.account_id INTO v_account
    FROM public.brands b WHERE b.id = OLD.brand_id;

    -- Accepted rows must soft-close for authenticated writers. JWT-less
    -- CASCADE from auth.users / brands (delete-user, test cleanup) may purge.
    IF OLD.accepted_at IS NOT NULL THEN
      IF v_caller IS NULL THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0004';
    END IF;

    -- Never-accepted: still refuse deleting the live brand account owner row
    -- (or an active partner membership) outside the transfer GUC.
    IF OLD.user_id = v_account THEN
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

  -- UPDATE: demotion away from brand_owner is owner-only on the OLD brand.
  -- Refuse relocating brand_id/user_id while demoting (closes cross-brand
  -- demotion via the rank-50 UPDATE policy).
  IF OLD.role = 'brand_owner'
     AND NEW.role IS DISTINCT FROM 'brand_owner' THEN
    IF NEW.brand_id IS DISTINCT FROM OLD.brand_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0004';
    END IF;
    IF v_caller IS NULL THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0004';
    END IF;
    v_caller_rank := public.biz_brand_effective_rank(OLD.brand_id, v_caller);
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

  IF NEW.brand_id IS DISTINCT FROM OLD.brand_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0004';
  END IF;

  SELECT b.account_id INTO v_account
  FROM public.brands b WHERE b.id = OLD.brand_id;
  IF NEW.user_id = v_account THEN
    RAISE EXCEPTION 'cannot_remove_brand_account' USING ERRCODE = 'P0005';
  END IF;

  IF v_caller IS NOT NULL THEN
    v_caller_rank := public.biz_brand_effective_rank(OLD.brand_id, v_caller);
    IF NEW.role = 'brand_owner'
       AND v_caller_rank < public.biz_role_rank('brand_owner') THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0004';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.partner_brand_links pl
    WHERE pl.brand_id = OLD.brand_id
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
  '#3660: refuse soft-remove/delete/demotion of brand_owner outside owner rank or app.allow_brand_owner_transfer; refuse authenticated DELETE of accepted rows (JWT-less CASCADE allowed); refuse active partner membership outside partner_disconnect_link.';

-- ---------------------------------------------------------------------------
-- #3660 — arm transfer GUC BEFORE demoting brand_owner in the live invite
-- handover. Production invokes this with the service-role client (auth.uid()
-- null); demotion must not race the GUC or the removal guard raises forbidden.
-- Body otherwise matches 20260926000000_orch_1111_oauth_null_email_accept.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_invite_and_transfer_brand_ownership(
  p_token_hash text,
  p_accepting_account_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_acceptor_user_id uuid;
  v_acceptor_email text;
  v_invitation record;
  v_prior_owner_account_id uuid;
  v_brand_record record;
  v_transferred boolean := false;
BEGIN
  SELECT a.id INTO v_acceptor_user_id
  FROM public.creator_accounts a
  WHERE a.id = p_accepting_account_id;

  IF v_acceptor_user_id IS NULL THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT u.email INTO v_acceptor_email FROM auth.users u WHERE u.id = v_acceptor_user_id;

  IF v_acceptor_email IS NULL THEN
    SELECT (i.identity_data->>'email') INTO v_acceptor_email
    FROM auth.identities i
    WHERE i.user_id = v_acceptor_user_id
      AND (i.identity_data->>'email') IS NOT NULL
      AND lower(coalesce(i.identity_data->>'email_verified','')) IN ('true','t')
    ORDER BY i.last_sign_in_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  SELECT * INTO v_invitation FROM public.brand_invitations
    WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_invitation.status = 'accepted' THEN RAISE EXCEPTION 'invite_already_used' USING ERRCODE = 'P0002'; END IF;
  IF v_invitation.status = 'revoked' THEN RAISE EXCEPTION 'invite_revoked' USING ERRCODE = 'P0005'; END IF;
  IF v_invitation.status = 'declined' THEN RAISE EXCEPTION 'invite_declined' USING ERRCODE = 'P0007'; END IF;
  IF v_invitation.expires_at <= now() THEN RAISE EXCEPTION 'invite_expired' USING ERRCODE = 'P0003'; END IF;
  IF v_acceptor_email IS NULL OR lower(v_acceptor_email) <> lower(v_invitation.email) THEN
    RAISE EXCEPTION 'invite_email_mismatch' USING ERRCODE = 'P0004';
  END IF;

  IF v_invitation.role = 'brand_owner' THEN
    SELECT * INTO v_brand_record FROM public.brands WHERE id = v_invitation.brand_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0001'; END IF;
    v_prior_owner_account_id := v_brand_record.account_id;
    -- #3660: arm bypass BEFORE demotion so tg_brand_team_members_removal_guard
    -- (and trg_brands_immutable_account_id) allow the handover under service_role.
    PERFORM set_config('app.allow_brand_owner_transfer', 'on', true);
    UPDATE public.brand_team_members SET role = 'brand_admin'
      WHERE brand_id = v_invitation.brand_id AND role = 'brand_owner' AND removed_at IS NULL;
    UPDATE public.brands SET account_id = p_accepting_account_id WHERE id = v_invitation.brand_id;
    INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at, removed_at)
      VALUES (v_invitation.brand_id, v_acceptor_user_id, 'brand_owner', v_invitation.expires_at - interval '7 days', now(), NULL)
      ON CONFLICT DO NOTHING;
    UPDATE public.brand_team_members SET role = 'brand_owner', accepted_at = now(), removed_at = NULL
      WHERE brand_id = v_invitation.brand_id AND user_id = v_acceptor_user_id AND role <> 'brand_owner';
    v_transferred := true;
  ELSE
    IF EXISTS (SELECT 1 FROM public.brand_team_members WHERE brand_id = v_invitation.brand_id AND user_id = v_acceptor_user_id) THEN
      UPDATE public.brand_team_members SET role = v_invitation.role, accepted_at = now(), removed_at = NULL
        WHERE brand_id = v_invitation.brand_id AND user_id = v_acceptor_user_id;
    ELSE
      INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at, removed_at)
        VALUES (v_invitation.brand_id, v_acceptor_user_id, v_invitation.role, v_invitation.expires_at - interval '7 days', now(), NULL);
    END IF;
  END IF;

  UPDATE public.brand_invitations
    SET status = 'accepted', accepted_at = now(), accepted_by_account_id = v_acceptor_user_id
    WHERE id = v_invitation.id;

  UPDATE public.partner_brand_links SET accepted_at = now()
    WHERE brand_id = v_invitation.brand_id
      AND lower(invited_owner_email) = lower(v_invitation.email)
      AND cancelled_at IS NULL AND accepted_at IS NULL;

  BEGIN
    INSERT INTO public.audit_log (user_id, brand_id, action, target_type, target_id, after)
    VALUES (
      v_acceptor_user_id, v_invitation.brand_id,
      CASE WHEN v_transferred THEN 'brand_ownership_transferred' ELSE 'brand_team_invitation_accepted' END,
      'brand_invitation', v_invitation.id::text,
      jsonb_build_object(
        'role', v_invitation.role,
        'transferred', v_transferred,
        'previous_owner_account_id', v_prior_owner_account_id,
        'new_owner_account_id', p_accepting_account_id,
        'invitation_email', v_invitation.email
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'brand_id', v_invitation.brand_id,
    'role', v_invitation.role,
    'transferred', v_transferred,
    'previous_owner_account_id', v_prior_owner_account_id,
    'new_owner_account_id', CASE WHEN v_transferred THEN p_accepting_account_id ELSE NULL END,
    'partner_setup', (SELECT b.partner_setup FROM public.brands b WHERE b.id = v_invitation.brand_id)
  );
END;
$function$;

ALTER FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid) TO service_role;
