-- ORCH-1081 critical hotfix migration.
--
-- The agent who built ORCH-1081 (and ORCH-1050 before it) never E2E-tested the
-- ownership transfer flow against the live DB. Two pre-existing schema-level
-- bugs were caught at runtime on 2026-06-09 while driving the partner
-- workflow end-to-end on a Samsung device:
--
--   1. trg_brands_immutable_account_id raises EXCEPTION 'brands.account_id is
--      immutable' on ANY update — including the legitimate UPDATE inside
--      accept_invite_and_transfer_brand_ownership. Pre-dates ORCH-1050.
--
--   2. The RPC referenced brand_invitations.accepted_by (does not exist;
--      column is accepted_by_account_id), and inserted into public.audit_log
--      using a column set (account_id, detail) that doesn't match the real
--      schema (user_id, before, after).
--
-- This migration:
--   - Adds a session-local bypass to the immutability trigger so ONLY the
--     RPC can repoint brands.account_id. Manual UPDATEs continue to fail-close.
--   - Re-creates accept_invite_and_transfer_brand_ownership with correct
--     column names + the bypass flag set right before the UPDATE.
--
-- Idempotent. Live-applied via Supabase Management API before this commit.

-- =============================================================
-- 1. Trigger function — allow bypass when session flag is set.
-- =============================================================
CREATE OR REPLACE FUNCTION public.biz_prevent_brand_account_id_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    -- ORCH-1081: legitimate ownership transfer sets this flag in-transaction.
    IF current_setting('app.allow_brand_owner_transfer', true) = 'on' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'brands.account_id is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

-- =============================================================
-- 2. RPC — correct column names + set transfer flag before UPDATE.
-- =============================================================
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

  SELECT * INTO v_invitation FROM public.brand_invitations
    WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_invitation.status = 'accepted' THEN RAISE EXCEPTION 'invite_already_used' USING ERRCODE = 'P0002'; END IF;
  IF v_invitation.status = 'revoked' THEN RAISE EXCEPTION 'invite_revoked' USING ERRCODE = 'P0005'; END IF;
  IF v_invitation.expires_at <= now() THEN RAISE EXCEPTION 'invite_expired' USING ERRCODE = 'P0003'; END IF;
  IF v_acceptor_email IS NULL OR lower(v_acceptor_email) <> lower(v_invitation.email) THEN
    RAISE EXCEPTION 'invite_email_mismatch' USING ERRCODE = 'P0004';
  END IF;

  IF v_invitation.role = 'brand_owner' THEN
    SELECT * INTO v_brand_record FROM public.brands WHERE id = v_invitation.brand_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0001'; END IF;
    v_prior_owner_account_id := v_brand_record.account_id;
    UPDATE public.brand_team_members SET role = 'brand_admin'
      WHERE brand_id = v_invitation.brand_id AND role = 'brand_owner' AND removed_at IS NULL;
    -- ORCH-1081 hotfix: set the bypass flag for this transaction only so the
    -- trg_brands_immutable_account_id trigger lets the ownership repointing
    -- succeed. Without it the transfer always fails.
    PERFORM set_config('app.allow_brand_owner_transfer', 'on', true);
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

  -- ORCH-1081 hotfix: the column is accepted_by_account_id, not accepted_by.
  UPDATE public.brand_invitations
    SET status = 'accepted', accepted_at = now(), accepted_by_account_id = v_acceptor_user_id
    WHERE id = v_invitation.id;

  UPDATE public.partner_brand_links SET accepted_at = now()
    WHERE brand_id = v_invitation.brand_id
      AND lower(invited_owner_email) = lower(v_invitation.email)
      AND cancelled_at IS NULL AND accepted_at IS NULL;

  BEGIN
    -- ORCH-1081 hotfix: audit_log uses user_id + before/after, not account_id + detail.
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
