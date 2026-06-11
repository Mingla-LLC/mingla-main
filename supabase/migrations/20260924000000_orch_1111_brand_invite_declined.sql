-- ORCH-1111 [Surface pending invites in-app] — add invitee-driven 'declined'
-- terminal state to brand_invitations.
--
-- Two parts:
--   1. Widen the status CHECK to include 'declined' + add a declined_at column.
--   2. OQ-1 (IN SCOPE — decline must be terminal END-TO-END): harden the
--      accept_invite_and_transfer_brand_ownership RPC so the web token path
--      also refuses a 'declined' invitation (P0007 invite_declined). Without
--      this, a stale emailed link could resurrect a declined invite.
--
-- Forward-only + idempotent: column add guarded with IF NOT EXISTS; CHECK uses
-- DROP-then-ADD; the RPC uses CREATE OR REPLACE.

-- =============================================================
-- Part 1 — declined_at column + widened status CHECK.
-- =============================================================
ALTER TABLE public.brand_invitations
  ADD COLUMN IF NOT EXISTS declined_at timestamptz;

-- Widen the status CHECK to include 'declined'. DROP-before-ADD so re-running
-- the migration is safe and the widen does not collide with the ORCH-1050 def.
ALTER TABLE public.brand_invitations
  DROP CONSTRAINT IF EXISTS brand_invitations_status_check;
ALTER TABLE public.brand_invitations
  ADD CONSTRAINT brand_invitations_status_check
  CHECK (status IN ('pending', 'accepted', 'revoked', 'expired', 'declined'));

-- =============================================================
-- Part 2 — RPC hardening: refuse a declined invite on the token path too.
--
-- This is a CREATE OR REPLACE of the LATEST function definition (from
-- 20260920000001_orch_1081_unblock_brand_owner_transfer.sql) reproduced
-- VERBATIM with exactly ONE added guard: status='declined' → P0007
-- invite_declined, inserted alongside the existing accepted/revoked checks.
-- Every other line (the immutable-trigger bypass flag, accepted_by_account_id
-- column, partner_brand_links accept stamp, audit_log shape, partner_setup
-- return) is unchanged so the accept/transfer/audit semantics are identical.
-- The new ERRCODE maps in the edge fn to 410 invite_declined.
--
-- Error contracts:
--   P0001  invite_not_found
--   P0002  invite_already_used
--   P0003  invite_expired
--   P0004  invite_email_mismatch
--   P0005  invite_revoked
--   P0007  invite_declined  (ORCH-1111)
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
  -- ORCH-1111 OQ-1 — a declined invite is terminal; refuse it even on the raw
  -- token (web) path so a stale email link cannot resurrect it.
  IF v_invitation.status = 'declined' THEN RAISE EXCEPTION 'invite_declined' USING ERRCODE = 'P0007'; END IF;
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

-- =============================================================
-- Verification probes (read-only).
-- =============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='brand_invitations'
      AND column_name='declined_at'
  ) THEN
    RAISE EXCEPTION 'ORCH-1111 probe failed: brand_invitations.declined_at missing';
  END IF;
END$$;
