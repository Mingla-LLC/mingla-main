-- #3660 Phase 5 — snapshot cleanup vs immutable_snapshot + honest cron naming.
--
-- Root cause: cleanup DELETEs expired parents; CASCADE deletes items; the item
-- trigger re-looks up the parent by id for the expiry check, but under CASCADE
-- the parent row is already gone → subquery misses → immutable_snapshot every
-- */5 run. Keep the guard; allow cleanup-GUC item DELETE when the parent is
-- missing (CASCADE) or still present and expired.
--
-- Also: tip repair for accept_invite auth.identities — CI supabase/postgres has
-- no GoTrue `auth.identities`; unguarded SELECT there reds Phase 2/4 happy
-- suites on a clean rebuild (#3524 to_regclass idiom).

CREATE OR REPLACE FUNCTION public.issue_1221_reject_snapshot_item_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.issue_1221_snapshot_cleanup', true) = 'allowed'
  THEN
    -- Parent already removed under CASCADE during cleanup.
    IF NOT EXISTS (
      SELECT 1
      FROM public.admin_source_refund_query_snapshots s
      WHERE s.id = OLD.snapshot_id
    ) THEN
      RETURN OLD;
    END IF;
    -- Parent still present and expired (direct item reclaim under cleanup GUC).
    IF EXISTS (
      SELECT 1
      FROM public.admin_source_refund_query_snapshots s
      WHERE s.id = OLD.snapshot_id
        AND s.expires_at <= statement_timestamp()
    ) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'immutable_snapshot';
END;
$$;

COMMENT ON FUNCTION public.issue_1221_reject_snapshot_item_mutation() IS
  '#3660 Phase 5 / #1221: refuse item mutate unless cleanup GUC + (parent gone via CASCADE or parent expired).';

-- Cleanup: materialize doomed ids, delete items, then parents (ordered).
CREATE OR REPLACE FUNCTION public.cleanup_admin_source_refund_query_snapshots(
  p_limit integer DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_snapshots integer := 0;
  v_items integer := 0;
  v_ids uuid[];
BEGIN
  -- SECURITY DEFINER: current_user is the definer. Allow login roles postgres /
  -- service_role, and PostgREST JWT role service_role (session_user is often
  -- authenticator after SET ROLE).
  IF NOT (
    session_user IN ('postgres', 'service_role')
    OR coalesce(auth.role(), '') = 'service_role'
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  -- NULL must not pass: LIMIT NULL is unbounded in PostgreSQL.
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 2000 THEN
    RAISE EXCEPTION 'invalid_limit';
  END IF;

  PERFORM set_config('app.issue_1221_snapshot_cleanup', 'allowed', true);

  SELECT coalesce(array_agg(id ORDER BY expires_at, id), ARRAY[]::uuid[])
  INTO v_ids
  FROM (
    SELECT id, expires_at
    FROM public.admin_source_refund_query_snapshots
    WHERE expires_at <= statement_timestamp()
    ORDER BY expires_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ) doomed;

  IF coalesce(cardinality(v_ids), 0) = 0 THEN
    RETURN jsonb_build_object('deleted_snapshots', 0, 'deleted_items', 0);
  END IF;

  DELETE FROM public.admin_source_refund_query_snapshot_items
  WHERE snapshot_id = ANY (v_ids);
  GET DIAGNOSTICS v_items = ROW_COUNT;

  DELETE FROM public.admin_source_refund_query_snapshots
  WHERE id = ANY (v_ids);
  GET DIAGNOSTICS v_snapshots = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_snapshots', v_snapshots,
    'deleted_items', v_items
  );
END;
$$;

COMMENT ON FUNCTION public.cleanup_admin_source_refund_query_snapshots(integer) IS
  '#3660 Phase 5 / #1221: reclaim expired admin refund snapshots under cleanup GUC; items then parents (ordered).';

-- ---------------------------------------------------------------------------
-- Tip repair: accept_invite must not hard-depend on GoTrue auth.identities.
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
  '#3660 Phase 5 tip: Phase 4 handover + auth.identities to_regclass guard + creator_accounts.email fallback for CI/no-GoTrue.';
