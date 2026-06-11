-- ORCH-1108 loop-back fix [OAuth null-email] — accept RPC trusted-email fallback.
--
-- DEFECT: Google-OAuth users can have `auth.users.email = NULL` while their
-- verified email lives only on the OAuth identity row
-- (`auth.identities.identity_data->>'email'` with `email_verified='true'`).
-- The accept RPC resolved the acceptor email solely from `auth.users.email`
-- (line `SELECT u.email INTO v_acceptor_email FROM auth.users ...`) → NULL for
-- these users → the `invite_email_mismatch` (P0004) guard always fired and the
-- ownership transfer / accept could never complete.
--
-- FIX: CREATE OR REPLACE the function VERBATIM from the latest definition in
-- 20260924000000_orch_1108_brand_invite_declined.sql (keeping the P0007 declined
-- guard, the app.allow_brand_owner_transfer bypass, accepted_by_account_id,
-- audit_log shape, partner_brand_links stamp, partner_setup return — ALL
-- unchanged) and change ONLY the v_acceptor_email resolution: when the
-- auth.users.email is NULL, fall back to a VERIFIED auth.identities OAuth email
-- (most-recent sign-in first). user_metadata is user-writable and is NEVER
-- consulted — only provider-asserted, GoTrue-written identity_data with
-- email_verified IN ('true','t') is trusted.
--
-- Forward-only + idempotent (CREATE OR REPLACE). $function$; precedes the
-- GRANT/REVOKE. Read-only verification probe at the end.

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

  -- ORCH-1108 loop-back fix [OAuth null-email] — Google-OAuth users have a NULL
  -- auth.users.email; their verified email lives only on auth.identities. Fall
  -- back to the most-recent VERIFIED OAuth identity email. identity_data is
  -- provider-asserted + GoTrue-written (trusted); user_metadata is NOT consulted.
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
  -- ORCH-1108 OQ-1 — a declined invite is terminal; refuse it even on the raw
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
-- Verification probe (read-only): assert the function exists and its body
-- carries the OAuth-null-email fallback (auth.identities email_verified guard).
-- =============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'accept_invite_and_transfer_brand_ownership'
      AND pg_get_functiondef(p.oid) LIKE '%auth.identities%'
      AND pg_get_functiondef(p.oid) LIKE '%email_verified%'
  ) THEN
    RAISE EXCEPTION 'ORCH-1108 probe failed: accept RPC missing OAuth null-email identity fallback';
  END IF;
END$$;
