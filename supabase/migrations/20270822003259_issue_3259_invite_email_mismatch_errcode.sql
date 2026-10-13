-- Issue #3259 — a rightful invitee on the wrong account is told the truth.
--
-- WHAT WAS BROKEN. A host invited as brand owner opened a valid, pending,
-- unexpired invitation while signed in with a different email and was shown
-- "Invitation not found — this invitation link isn't valid". The accept RPC
-- refused correctly with `invite_email_mismatch`, but raised it with ERRCODE
-- P0001. The accept contract (and `mapRpcError` in the accept-brand-invitation
-- edge function) reads P0001 as `invite_not_found` (404) and P0004 as
-- `invite_email_mismatch` (403), so the wrong-account recovery screen never
-- rendered. Every definition up to 20270801003645 used P0004; the wrong code
-- arrived in 20270803003660 and was carried into 20270804003660.
--
-- WHAT THIS DOES. One thing: the email-mismatch refusal raises P0004 again.
--
-- WHERE THE BODY CAME FROM. Re-emitted verbatim from its latest definition,
--   supabase/migrations/20270804003660_issue_3660_snapshot_cleanup_and_cron_alarm.sql
-- with only the marked `issue #3259` line changed. That definition matched
-- production byte for byte (md5 of prosrc) when this was written.

BEGIN;

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
  v_disposition text;
BEGIN
  SELECT a.id INTO v_acceptor_user_id
  FROM public.creator_accounts a
  WHERE a.id = p_accepting_account_id;

  IF v_acceptor_user_id IS NULL THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT u.email INTO v_acceptor_email FROM auth.users u WHERE u.id = v_acceptor_user_id;

  -- ORCH-1111: verified GoTrue identity email when auth.users.email is null.
  -- CI supabase/postgres has no auth.identities — guard with to_regclass (#3524).
  IF v_acceptor_email IS NULL AND to_regclass('auth.identities') IS NOT NULL THEN
    SELECT (i.identity_data->>'email') INTO v_acceptor_email
    FROM auth.identities i
    WHERE i.user_id = v_acceptor_user_id
      AND (i.identity_data->>'email') IS NOT NULL
      AND lower(coalesce(i.identity_data->>'email_verified','')) IN ('true','t')
    ORDER BY i.last_sign_in_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  -- No GoTrue / still null: creator_accounts.email (invite match surface in CI).
  IF v_acceptor_email IS NULL THEN
    SELECT a.email INTO v_acceptor_email
    FROM public.creator_accounts a
    WHERE a.id = v_acceptor_user_id;
  END IF;

  SELECT * INTO v_invitation FROM public.brand_invitations
    WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_invitation.status = 'accepted' THEN RAISE EXCEPTION 'invite_already_used' USING ERRCODE = 'P0002'; END IF;
  IF v_invitation.status = 'revoked' THEN RAISE EXCEPTION 'invite_revoked' USING ERRCODE = 'P0005'; END IF;
  IF v_invitation.status = 'declined' THEN RAISE EXCEPTION 'invite_declined' USING ERRCODE = 'P0007'; END IF;
  IF v_invitation.expires_at <= now() THEN RAISE EXCEPTION 'invite_expired' USING ERRCODE = 'P0003'; END IF;
  IF v_acceptor_email IS NULL OR lower(v_acceptor_email) <> lower(v_invitation.email) THEN
    -- issue #3259: P0004, not P0001 (P0001 is invite_not_found).
    RAISE EXCEPTION 'invite_email_mismatch' USING ERRCODE = 'P0004';
  END IF;

  v_disposition := lower(coalesce(nullif(trim(v_invitation.outgoing_disposition), ''), 'leave'));
  IF v_disposition NOT IN ('leave', 'stay') THEN
    v_disposition := 'leave';
  END IF;

  IF v_invitation.role = 'brand_owner' THEN
    SELECT * INTO v_brand_record FROM public.brands WHERE id = v_invitation.brand_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0001'; END IF;
    v_prior_owner_account_id := v_brand_record.account_id;

    PERFORM set_config('app.allow_brand_owner_transfer', 'on', true);

    IF v_prior_owner_account_id IS DISTINCT FROM p_accepting_account_id THEN
      IF v_disposition = 'stay' THEN
        UPDATE public.brand_team_members
          SET role = 'brand_admin'
          WHERE brand_id = v_invitation.brand_id
            AND user_id = v_prior_owner_account_id
            AND role = 'brand_owner'
            AND removed_at IS NULL;
      ELSE
        UPDATE public.brand_team_members
          SET removed_at = now()
          WHERE brand_id = v_invitation.brand_id
            AND user_id = v_prior_owner_account_id
            AND removed_at IS NULL
            AND accepted_at IS NOT NULL;
        DELETE FROM public.brand_team_members
          WHERE brand_id = v_invitation.brand_id
            AND user_id = v_prior_owner_account_id
            AND removed_at IS NULL
            AND accepted_at IS NULL;
      END IF;
    END IF;

    UPDATE public.brand_team_members
      SET removed_at = now()
      WHERE brand_id = v_invitation.brand_id
        AND role = 'brand_owner'
        AND user_id IS DISTINCT FROM p_accepting_account_id
        AND removed_at IS NULL
        AND accepted_at IS NOT NULL;
    DELETE FROM public.brand_team_members
      WHERE brand_id = v_invitation.brand_id
        AND role = 'brand_owner'
        AND user_id IS DISTINCT FROM p_accepting_account_id
        AND removed_at IS NULL
        AND accepted_at IS NULL;

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
        'invitation_email', v_invitation.email,
        'outgoing_disposition', CASE WHEN v_transferred THEN v_disposition ELSE NULL END
      )
    );
    IF v_transferred AND v_prior_owner_account_id IS DISTINCT FROM p_accepting_account_id THEN
      INSERT INTO public.audit_log (user_id, brand_id, action, target_type, target_id, after)
      VALUES (
        v_acceptor_user_id, v_invitation.brand_id,
        CASE WHEN v_disposition = 'stay'
          THEN 'brand_owner_demoted_on_handover'
          ELSE 'brand_owner_removed_on_handover'
        END,
        'brand_team_member', v_prior_owner_account_id::text,
        jsonb_build_object(
          'previous_owner_account_id', v_prior_owner_account_id,
          'new_owner_account_id', p_accepting_account_id,
          'outgoing_disposition', v_disposition
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'brand_id', v_invitation.brand_id,
    'role', v_invitation.role,
    'transferred', v_transferred,
    'previous_owner_account_id', v_prior_owner_account_id,
    'new_owner_account_id', CASE WHEN v_transferred THEN p_accepting_account_id ELSE NULL END,
    'outgoing_disposition', CASE WHEN v_transferred THEN v_disposition ELSE NULL END,
    'partner_setup', (SELECT b.partner_setup FROM public.brands b WHERE b.id = v_invitation.brand_id)
  );
END;
$function$;

ALTER FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid)
  TO service_role;

COMMENT ON FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid) IS
  '#3259: email mismatch raises P0004 (invite_email_mismatch), never P0001 (invite_not_found). Body otherwise #3660 Phase 5 tip.';

-- Refuse to commit unless the mismatch now carries its own code.
DO $verify$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
  FROM pg_proc p
  WHERE p.oid = 'public.accept_invite_and_transfer_brand_ownership(text, uuid)'::regprocedure;
  IF v_src !~ $re$'invite_email_mismatch' USING ERRCODE = 'P0004'$re$ THEN
    RAISE EXCEPTION 'issue_3259 verify: invite_email_mismatch is not raised as P0004';
  END IF;
  IF v_src ~ $re$'invite_email_mismatch' USING ERRCODE = 'P0001'$re$ THEN
    RAISE EXCEPTION 'issue_3259 verify: invite_email_mismatch is still raised as P0001';
  END IF;
END
$verify$;

COMMIT;
