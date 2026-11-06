-- Issue #4283 — a removed teammate can accept a brand invite again.
--
-- WHAT WAS BROKEN. `brand_team_members` allows ONE active row per (brand, user)
-- (unique partial index idx_brand_team_members_brand_user_active, WHERE
-- removed_at IS NULL) but keeps removed rows as history. The accept RPC did
-- not respect that:
--   * brand_owner invite: INSERT ... ON CONFLICT DO NOTHING created a fresh
--     active owner row (no active row existed), then
--     UPDATE ... SET removed_at = NULL WHERE brand_id AND user_id AND role <> 'brand_owner'
--     revived the old removed row too. Two active rows → 23505 → rollback.
--     Production: a removed brand_admin could never accept an ownership
--     handover (seven 500s, 2026-11-05).
--   * any other role: IF EXISTS(any row) UPDATE ... WHERE brand_id AND user_id
--     revived EVERY historical row, so a user removed twice (or active once
--     and removed once) failed the same way.
--
-- WHAT THIS DOES. In both branches the acceptor ends with at most ONE active
-- row for the brand. One row is chosen, deterministically:
--   1. the active row (removed_at IS NULL) if there is one — the index allows
--      at most one;
--   2. otherwise the most recent removed row, by
--      coalesce(accepted_at, invited_at) DESC, then id DESC as a tie-break;
--   3. no row at all → INSERT, as before.
-- Only that row is updated (role, accepted_at = now(), removed_at = NULL).
-- Older removed rows stay removed, untouched, as history. In the owner branch
-- an already-active brand_owner row is left exactly as it was (the old UPDATE
-- skipped it via role <> 'brand_owner').
--
-- No schema change. role / removed_at / accepted_at keep their meaning.
--
-- WHERE THE BODY CAME FROM. Re-emitted verbatim from its latest definition,
--   supabase/migrations/20270822003259_issue_3259_invite_email_mismatch_errcode.sql
-- with only the lines marked `issue #4283` changed. Email checks, P000x codes,
-- outgoing disposition, prior-owner handling, partner_brand_links, audit_log,
-- the return shape, SECURITY DEFINER, search_path, owner and grants are
-- unchanged.

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
  v_member_row_id uuid; -- issue #4283
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

    -- issue #4283: one row only (see the selection rule in the header).
    SELECT m.id INTO v_member_row_id
      FROM public.brand_team_members m
      WHERE m.brand_id = v_invitation.brand_id
        AND m.user_id = v_acceptor_user_id
      ORDER BY (m.removed_at IS NULL) DESC,
               coalesce(m.accepted_at, m.invited_at) DESC,
               m.id DESC
      LIMIT 1
      FOR UPDATE;
    IF v_member_row_id IS NULL THEN
      INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at, removed_at)
        VALUES (v_invitation.brand_id, v_acceptor_user_id, 'brand_owner', v_invitation.expires_at - interval '7 days', now(), NULL);
    ELSE
      -- An already-active brand_owner row is left as it was (as before #4283).
      UPDATE public.brand_team_members SET role = 'brand_owner', accepted_at = now(), removed_at = NULL
        WHERE id = v_member_row_id
          AND (role <> 'brand_owner' OR removed_at IS NOT NULL);
    END IF;
    v_transferred := true;
  ELSE
    -- issue #4283: update one row, never every historical row.
    SELECT m.id INTO v_member_row_id
      FROM public.brand_team_members m
      WHERE m.brand_id = v_invitation.brand_id
        AND m.user_id = v_acceptor_user_id
      ORDER BY (m.removed_at IS NULL) DESC,
               coalesce(m.accepted_at, m.invited_at) DESC,
               m.id DESC
      LIMIT 1
      FOR UPDATE;
    IF v_member_row_id IS NOT NULL THEN
      UPDATE public.brand_team_members SET role = v_invitation.role, accepted_at = now(), removed_at = NULL
        WHERE id = v_member_row_id;
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
  '#4283: accepting writes at most one active brand_team_members row for the acceptor (active row, else most recent removed row, else insert). Body otherwise #3259 tip.';

-- Refuse to commit unless the one-row rule is in the body and the #3259 code
-- survived the re-emission.
DO $verify$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
  FROM pg_proc p
  WHERE p.oid = 'public.accept_invite_and_transfer_brand_ownership(text, uuid)'::regprocedure;
  IF v_src !~ $re$'invite_email_mismatch' USING ERRCODE = 'P0004'$re$ THEN
    RAISE EXCEPTION 'issue_4283 verify: invite_email_mismatch is not raised as P0004';
  END IF;
  IF v_src ~ 'ON CONFLICT DO NOTHING' THEN
    RAISE EXCEPTION 'issue_4283 verify: the blind owner-row INSERT is still present';
  END IF;
  IF v_src !~ 'WHERE id = v_member_row_id' THEN
    RAISE EXCEPTION 'issue_4283 verify: the single-row update is missing';
  END IF;
END
$verify$;

COMMIT;
