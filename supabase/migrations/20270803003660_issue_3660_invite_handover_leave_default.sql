-- #3660 Phase 4 — owner invite handover: leave (default) or stay-as-admin.
-- Product: the OUTGOING owner chooses leave|stay when sending a brand_owner
-- invite; acceptance executes the stored decision (invitee cannot override).
-- Leave removes the prior owner (#3622); stay demotes them to brand_admin.
-- Dual audit; single active owner. Tip sorts above 20270802003660.

ALTER TABLE public.brand_invitations
  ADD COLUMN IF NOT EXISTS outgoing_disposition text NOT NULL DEFAULT 'leave';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brand_invitations_outgoing_disposition_check'
  ) THEN
    ALTER TABLE public.brand_invitations
      ADD CONSTRAINT brand_invitations_outgoing_disposition_check
      CHECK (outgoing_disposition IN ('leave', 'stay'));
  END IF;
END $$;

COMMENT ON COLUMN public.brand_invitations.outgoing_disposition IS
  '#3660: set by outgoing owner when inviting brand_owner; leave|stay (default leave). Acceptance reads this; invitee cannot override.';

-- Drop both signatures so 2-arg calls cannot collide with a 3-arg+DEFAULT overload
-- (that ambiguity broke issue_3622 tester: "function … is not unique").
DROP FUNCTION IF EXISTS public.accept_invite_and_transfer_brand_ownership(text, uuid, text);
DROP FUNCTION IF EXISTS public.accept_invite_and_transfer_brand_ownership(text, uuid);

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
    RAISE EXCEPTION 'invite_email_mismatch' USING ERRCODE = 'P0001';
  END IF;

  v_disposition := lower(coalesce(nullif(trim(v_invitation.outgoing_disposition), ''), 'leave'));
  IF v_disposition NOT IN ('leave', 'stay') THEN
    v_disposition := 'leave';
  END IF;

  IF v_invitation.role = 'brand_owner' THEN
    SELECT * INTO v_brand_record FROM public.brands WHERE id = v_invitation.brand_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0001'; END IF;
    v_prior_owner_account_id := v_brand_record.account_id;

    -- Arm BEFORE demotion/removal/account_id write (tg_brand_team_members_removal_guard
    -- + immutable account_id). Service-role accepts have auth.uid() null.
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

    -- Co-owner cleanup: any other active brand_owner except the acceptor.
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
-- SECURITY DEFINER defaults to PUBLIC execute; revoke anon explicitly (ORCH-1392).
REVOKE ALL ON FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid)
  TO service_role;

COMMENT ON FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid) IS
  '#3660 Phase 4: owner invite handover. Disposition from brand_invitations.outgoing_disposition (leave default). Leave removes prior owner; stay demotes to brand_admin. Dual audit on transfer.';
