-- Issue #3660 — Host account deletion completes or changes nothing.
--
-- Before this migration a Host account deletion was three separate table writes
-- issued from the `delete-user` edge function (brands, brand_team_members,
-- creator_accounts), none of them checked. One could land alone: the brand
-- soft-delete was refused by `issue_2063_guard_brand_soft_delete` while the
-- account stamp still landed, which left an account marked deleted that still
-- owned a live brand.
--
-- This migration adds ONE service-role function that runs the preflight and
-- every write in a single transaction. A refusal returns before any write; any
-- exception rolls the whole call back. There is no EXCEPTION block anywhere in
-- these functions, on purpose.
--
-- It creates three functions for the deletion, plus one narrowly scoped guard
-- trigger on public.brands (section 4: a signed-in, non-admin user may not
-- clear brands.deleted_at, so "deletion is final" is enforced by the database).
-- No table, column, index, policy, constraint or foreign key changes, and it
-- writes no rows.
-- `issue_2063_guard_brand_soft_delete` and `tg_brand_team_members_removal_guard`
-- are NOT replaced, dropped or bypassed (no GUC, no session_replication_role).

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

-- ---------------------------------------------------------------------------
-- 1. Preflight: every reason a Host account deletion must be refused.
--    Returns a JSON array, empty when nothing blocks. Every code that applies
--    is returned, not only the first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.host_account_deletion_blockers(
  p_user_id uuid,
  p_brand_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand_ids uuid[] := COALESCE(p_brand_ids, ARRAY[]::uuid[]);
  v_event_ids uuid[];
  v_blockers jsonb := '[]'::jsonb;
  v_ids uuid[];
  v_count integer;
BEGIN
  -- Live or upcoming: copied from issue_2063_guard_brand_soft_delete so the set
  -- the deletion takes down is always a superset of the set that guard counts.
  SELECT COALESCE(array_agg(e.id), ARRAY[]::uuid[])
  INTO v_event_ids
  FROM public.events e
  WHERE e.brand_id = ANY (v_brand_ids)
    AND e.deleted_at IS NULL
    AND e.status IN ('scheduled', 'live')
    AND EXISTS (
      SELECT 1 FROM public.event_dates d
      WHERE d.event_id = e.id
        AND d.end_at > statement_timestamp()
    );

  -- tickets_sold -------------------------------------------------------------
  SELECT COALESCE(array_agg(e.id ORDER BY e.id), ARRAY[]::uuid[])
  INTO v_ids
  FROM public.events e
  WHERE e.id = ANY (v_event_ids)
    AND (
      EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.event_id = e.id
          AND o.payment_status IN ('paid', 'partial_refund', 'pending')
      )
      OR EXISTS (
        SELECT 1 FROM public.tickets t
        WHERE t.event_id = e.id
          AND t.status IN ('valid', 'used', 'transferred', 'refund_pending')
      )
      OR EXISTS (
        SELECT 1 FROM public.event_rsvps r
        WHERE r.event_id = e.id
          AND r.rsvp_status IN ('going', 'waitlisted')
          AND r.approval_status IN ('approved', 'pending')
      )
      OR EXISTS (
        SELECT 1 FROM public.event_rsvp_contributions c
        WHERE c.event_id = e.id
          AND c.status IN ('paid', 'partially_refunded')
      )
    );
  IF cardinality(v_ids) > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'tickets_sold',
      'count', cardinality(v_ids),
      'items', (
        SELECT COALESCE(jsonb_agg(x.item ORDER BY x.id), '[]'::jsonb)
        FROM (
          SELECT e.id, jsonb_build_object('id', e.id, 'title', e.title) AS item
          FROM public.events e
          WHERE e.id = ANY (v_ids)
          ORDER BY e.id
          LIMIT 5
        ) x
      )
    ));
  END IF;

  -- checkout_in_progress -----------------------------------------------------
  SELECT COALESCE(array_agg(e.id ORDER BY e.id), ARRAY[]::uuid[])
  INTO v_ids
  FROM public.events e
  WHERE e.id = ANY (v_event_ids)
    AND EXISTS (
      SELECT 1 FROM public.ticket_checkout_sessions s
      WHERE s.event_id = e.id
        AND (
          (
            s.status IN (
              'pending_free', 'requires_payment',
              'awaiting_web_redirect', 'processing_payment'
            )
            AND s.expires_at > now()
          )
          -- A payment the provider is processing right now still finalises
          -- into a paid order after the session's expiry time has passed
          -- (the finalize path does not look at expires_at). It counts for as
          -- long as it is unresolved. The other open statuses do NOT count
          -- once expired: nothing ever flips an abandoned cart to `expired`,
          -- so counting them would refuse a Host for weeks over a cart nobody
          -- is paying for, and a late payment on one of those after the
          -- deletion is refused and reversed by biz_ticket_checkout_finalize.
          OR (
            s.status = 'processing_payment'
            AND s.revoked_at IS NULL
            AND s.order_id IS NULL
          )
        )
    );
  IF cardinality(v_ids) > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'checkout_in_progress',
      'count', cardinality(v_ids),
      'items', (
        SELECT COALESCE(jsonb_agg(x.item ORDER BY x.id), '[]'::jsonb)
        FROM (
          SELECT e.id, jsonb_build_object('id', e.id, 'title', e.title) AS item
          FROM public.events e
          WHERE e.id = ANY (v_ids)
          ORDER BY e.id
          LIMIT 5
        ) x
      )
    ));
  END IF;

  -- upcoming_reservations ----------------------------------------------------
  SELECT count(*)::integer INTO v_count
  FROM public.reservations r
  WHERE r.brand_id = ANY (v_brand_ids)
    AND r.reserved_for > now()
    AND r.status IN ('requested', 'confirmed', 'waitlisted');
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'upcoming_reservations', 'count', v_count));
  END IF;

  -- upcoming_stays (deliberately fail-closed: no end-date column to test) ----
  SELECT count(*)::integer INTO v_count
  FROM public.stay_reservation_groups g
  WHERE g.brand_id = ANY (v_brand_ids)
    AND g.state NOT IN ('declined', 'request_expired', 'cancelled');
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'upcoming_stays', 'count', v_count));
  END IF;

  -- open_menu_orders ---------------------------------------------------------
  SELECT count(*)::integer INTO v_count
  FROM public.venue_orders vo
  WHERE vo.brand_id = ANY (v_brand_ids)
    AND vo.payment_status IN ('pending', 'paid')
    AND vo.fulfillment_status IN ('placed', 'acknowledged', 'in_progress', 'ready')
    AND vo.created_at > now() - interval '24 hours';
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'open_menu_orders', 'count', v_count));
  END IF;

  -- money_in_motion ----------------------------------------------------------
  SELECT (
    (SELECT count(*) FROM public.brand_payout_releases pr
      WHERE pr.brand_id = ANY (v_brand_ids)
        AND pr.status NOT IN ('released', 'cancelled_event', 'reanchored'))
    + (SELECT count(*) FROM public.organiser_payout_debts od
        WHERE od.brand_id = ANY (v_brand_ids)
          AND od.status = 'open')
    + (SELECT count(*) FROM public.tickets t
        JOIN public.events e ON e.id = t.event_id
        WHERE e.brand_id = ANY (v_brand_ids)
          AND t.status = 'refund_pending')
    -- A paid, non-zero, not fully refunded order whose money has not been
    -- released to the organiser. The release row is created by a sweep that
    -- runs after the payment, so "no release row yet" is NOT evidence that
    -- nothing is owed: only an item under a `released` release is. Orders on
    -- a live or upcoming event are already reported as tickets_sold above, so
    -- this arm counts the rest (ended, cancelled, draft, taken-down events):
    -- together the two arms refuse on every such order on ANY event of an
    -- owned brand. A free order (total 0) and a fully refunded order
    -- (payment_status refunded) never count.
    + (SELECT count(*) FROM public.orders o
        JOIN public.events e ON e.id = o.event_id
        WHERE e.brand_id = ANY (v_brand_ids)
          AND NOT (e.id = ANY (v_event_ids))
          AND o.payment_status IN ('paid', 'partial_refund')
          AND o.total_cents > 0
          AND NOT EXISTS (
            SELECT 1
            FROM public.payout_release_items i
            JOIN public.brand_payout_releases pr ON pr.id = i.release_id
            WHERE i.source_type = 'order'
              AND i.source_id = o.id
              AND pr.status = 'released'
          ))
  )::integer INTO v_count;
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'money_in_motion', 'count', v_count));
  END IF;

  -- partner_payment_in_progress ----------------------------------------------
  -- The user's partner links are ended by the deletion itself. The one thing
  -- that refuses is a partner share that has not reached a terminal state:
  -- everything except transferred / reversed / cancelled_refund still has
  -- money owed in one direction or the other.
  SELECT count(*)::integer INTO v_count
  FROM public.partner_splits ps
  WHERE ps.partner_account_id = p_user_id
    AND ps.status NOT IN ('transferred', 'reversed', 'cancelled_refund');
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'partner_payment_in_progress', 'count', v_count));
  END IF;

  RETURN v_blockers;
END;
$function$;

REVOKE ALL ON FUNCTION private.host_account_deletion_blockers(uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.host_account_deletion_blockers(uuid, uuid[]) IS
  'Issue #3660: every reason a Host account deletion is refused, as a JSON array (empty = nothing blocks). Called only by biz_delete_host_account and biz_my_host_account_deletion_blockers.';

-- ---------------------------------------------------------------------------
-- 2. The deletion itself. Service role only. All or nothing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_delete_host_account(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz;
  v_account_deleted_at timestamptz;
  v_brand_ids uuid[];
  v_event_ids uuid[];
  v_link_ids uuid[];
  v_blockers jsonb;
  v_has_foreign_membership boolean;
  v_events_taken_down integer := 0;
  v_memberships_removed integer := 0;
  v_partner_links_ended integer := 0;
  v_invitations_revoked integer := 0;
  v_pending_partner_links_closed integer := 0;
  v_stripe_accounts jsonb := '[]'::jsonb;
  v_paystack_subaccounts jsonb := '[]'::jsonb;
  v_prior_before jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id_required' USING ERRCODE = '22004';
  END IF;

  -- 1. One deletion per user at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 3660));

  -- 2. The account row.
  SELECT ca.deleted_at INTO v_account_deleted_at
  FROM public.creator_accounts ca
  WHERE ca.id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'nothing_to_delete');
  END IF;

  -- 3. Live brands this user owns.
  SELECT COALESCE(array_agg(s.id), ARRAY[]::uuid[])
  INTO v_brand_ids
  FROM (
    SELECT b.id
    FROM public.brands b
    WHERE b.account_id = p_user_id
      AND b.deleted_at IS NULL
    ORDER BY b.id
    FOR UPDATE
  ) s;

  -- 4. Live or upcoming events on those brands. FOR UPDATE conflicts with the
  --    FOR KEY SHARE lock a new order / ticket / RSVP insert takes on its event,
  --    so no sale can slip between the check below and the take-down.
  SELECT COALESCE(array_agg(s.id), ARRAY[]::uuid[])
  INTO v_event_ids
  FROM (
    SELECT e.id
    FROM public.events e
    WHERE e.brand_id = ANY (v_brand_ids)
      AND e.deleted_at IS NULL
      AND e.status IN ('scheduled', 'live')
      AND EXISTS (
        SELECT 1 FROM public.event_dates d
        WHERE d.event_id = e.id
          AND d.end_at > statement_timestamp()
      )
    ORDER BY e.id
    FOR UPDATE OF e
  ) s;

  -- The user's accepted, non-cancelled partner links (locked like
  -- partner_disconnect_link locks the one link it ends).
  SELECT COALESCE(array_agg(s.id), ARRAY[]::uuid[])
  INTO v_link_ids
  FROM (
    SELECT pl.id
    FROM public.partner_brand_links pl
    WHERE pl.partner_account_id = p_user_id
      AND pl.accepted_at IS NOT NULL
      AND pl.cancelled_at IS NULL
    ORDER BY pl.id
    FOR UPDATE
  ) s;

  -- 5. Preflight. A refusal returns here: NO WRITE HAS HAPPENED.
  v_blockers := private.host_account_deletion_blockers(p_user_id, v_brand_ids);
  IF jsonb_array_length(v_blockers) > 0 THEN
    RETURN jsonb_build_object('status', 'blocked', 'blockers', v_blockers);
  END IF;

  -- 6. Idempotent second call.
  SELECT EXISTS (
    SELECT 1
    FROM public.brand_team_members m
    WHERE m.user_id = p_user_id
      AND m.removed_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.brands b
        WHERE b.id = m.brand_id AND b.account_id = p_user_id
      )
  ) INTO v_has_foreign_membership;

  --    Nothing is written, but the provider targets of the deletion that DID
  --    happen are returned again, read from its own audit row. If the first
  --    response was lost after the commit (timeout, crash before the provider
  --    step) the Stripe account and Paystack subaccount were never deactivated
  --    at the provider; the caller re-runs that step from this answer. Both
  --    provider calls are safe to repeat. audit_log is append-only (its
  --    update/delete trigger), so this source cannot be edited away, and the
  --    row is found by target, not by user_id, which a removed login nulls.
  IF v_account_deleted_at IS NOT NULL
     AND cardinality(v_brand_ids) = 0
     AND cardinality(v_link_ids) = 0
     AND NOT v_has_foreign_membership THEN
    SELECT al.before INTO v_prior_before
    FROM public.audit_log al
    WHERE al.action = 'host_account.deleted'
      AND al.target_type = 'creator_account'
      AND al.target_id = p_user_id::text
    ORDER BY al.created_at DESC, al.id DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'status', 'deleted',
      'already_deleted', true,
      'brand_ids', '[]'::jsonb,
      'events_taken_down', 0,
      'memberships_removed', 0,
      'partner_links_ended', 0,
      'stripe_accounts',
        CASE WHEN jsonb_typeof(v_prior_before->'stripe_accounts') = 'array'
             THEN v_prior_before->'stripe_accounts' ELSE '[]'::jsonb END,
      'paystack_subaccounts',
        CASE WHEN jsonb_typeof(v_prior_before->'paystack_subaccounts') = 'array'
             THEN v_prior_before->'paystack_subaccounts' ELSE '[]'::jsonb END
    );
  END IF;

  -- 7. Writes. One timestamp for all of them.
  v_now := now();

  -- 7.1 Take down zero-sale live or upcoming events (the same statement
  --     biz_soft_delete_trip and admin_set_offering_deleted run).
  UPDATE public.events
     SET deleted_at = v_now,
         updated_at = v_now
   WHERE id = ANY (v_event_ids);
  GET DIAGNOSTICS v_events_taken_down = ROW_COUNT;

  -- 7.2 Detach the Stripe rows locally; the provider call happens after commit.
  WITH detached AS (
    UPDATE public.stripe_connect_accounts sca
       SET detached_at = v_now,
           updated_at = v_now
     WHERE sca.brand_id = ANY (v_brand_ids)
       AND sca.detached_at IS NULL
    RETURNING sca.brand_id, sca.stripe_account_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'brand_id', d.brand_id,
        'stripe_account_id', d.stripe_account_id
      )
      ORDER BY d.brand_id
    ),
    '[]'::jsonb
  )
  INTO v_stripe_accounts
  FROM detached d;

  -- 7.3 Deactivate Paystack payout recipients.
  UPDATE public.brand_paystack_recipients r
     SET is_active = false,
         updated_at = v_now
   WHERE r.brand_id = ANY (v_brand_ids)
     AND r.is_active;

  -- 7.4 Soft-delete the brands. issue_2063_guard_brand_soft_delete runs here
  --     and passes because 7.1 emptied the set it counts.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'brand_id', b.id,
        'subaccount_code', b.paystack_subaccount_code
      )
      ORDER BY b.id
    ),
    '[]'::jsonb
  )
  INTO v_paystack_subaccounts
  FROM public.brands b
  WHERE b.id = ANY (v_brand_ids)
    AND b.paystack_subaccount_code IS NOT NULL;

  UPDATE public.brands
     SET deleted_at = v_now,
         paystack_subaccount_code = NULL
   WHERE id = ANY (v_brand_ids);

  -- 7.4a Nobody may accept their way into a deleted brand. Revoke every
  --      pending team invitation on the brands just deleted, with the same
  --      stamp the Host app's own "revoke invitation" writes (status revoked +
  --      revoked_at). For an owner-handover invitation the existing
  --      partner_brand_links_invite_kill_trigger closes the partner link that
  --      was waiting on it.
  UPDATE public.brand_invitations bi
     SET status = 'revoked',
         revoked_at = v_now
   WHERE bi.brand_id = ANY (v_brand_ids)
     AND bi.status = 'pending';
  GET DIAGNOSTICS v_invitations_revoked = ROW_COUNT;

  -- 7.4b Close every partner link on those brands that was invited but never
  --      accepted (whatever the trigger above did not already close). Accepted
  --      links and other members' team rows on the deleted brand are left as
  --      they are, exactly as an ordinary brand deletion leaves them.
  UPDATE public.partner_brand_links pl
     SET cancelled_at = v_now,
         cancelled_reason = 'invitation_revoked'
   WHERE pl.brand_id = ANY (v_brand_ids)
     AND pl.accepted_at IS NULL
     AND pl.cancelled_at IS NULL;
  GET DIAGNOSTICS v_pending_partner_links_closed = ROW_COUNT;

  -- 7.5a End the user's partner links. This is the first half of the atomic
  --      dual-stamp partner_disconnect_link performs (that function cannot be
  --      called here: it requires a non-null auth.uid()). The second half, the
  --      membership stamp, is 7.5b below, in this same transaction. Ending the
  --      link first is what lets tg_brand_team_members_removal_guard pass its
  --      active_partner_use_disconnect check with no bypass.
  UPDATE public.partner_brand_links pl
     SET cancelled_at = v_now,
         cancelled_reason = 'partner_disconnected'
   WHERE pl.id = ANY (v_link_ids);
  GET DIAGNOSTICS v_partner_links_ended = ROW_COUNT;

  INSERT INTO public.audit_log
    (user_id, brand_id, action, target_type, target_id, after)
  SELECT
    p_user_id,
    pl.brand_id,
    'partner_link_disconnected',
    'partner_brand_link',
    pl.id::text,
    jsonb_build_object(
      'reason', 'partner_disconnected',
      'via', 'host_account.deleted'
    )
  FROM public.partner_brand_links pl
  WHERE pl.id = ANY (v_link_ids);

  -- 7.5b Leave every team the user does not own. The user's row on a brand
  --      they own is left in place, exactly as a normal brand deletion leaves
  --      it, so the removal guard's cannot_remove_brand_account rule is never
  --      reached.
  UPDATE public.brand_team_members m
     SET removed_at = v_now
   WHERE m.user_id = p_user_id
     AND m.removed_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.brands b
       WHERE b.id = m.brand_id AND b.account_id = p_user_id
     );
  GET DIAGNOSTICS v_memberships_removed = ROW_COUNT;

  -- 7.6 Mark the account deleted. No other column is written.
  UPDATE public.creator_accounts
     SET deleted_at = v_now
   WHERE id = p_user_id;

  -- 7.7 Audit. Deliberately not wrapped: if this row cannot be written the
  --     deletion does not happen.
  INSERT INTO public.audit_log
    (user_id, action, target_type, target_id, before, after)
  VALUES (
    p_user_id,
    'host_account.deleted',
    'creator_account',
    p_user_id::text,
    -- `before` is also the durable source of the provider targets for a retry
    -- (step 6): keep both lists here, complete.
    jsonb_build_object(
      'paystack_subaccounts', v_paystack_subaccounts,
      'stripe_accounts', v_stripe_accounts
    ),
    jsonb_build_object(
      'brand_ids', to_jsonb(v_brand_ids),
      'event_ids_taken_down', to_jsonb(v_event_ids),
      'events_taken_down', v_events_taken_down,
      'memberships_removed', v_memberships_removed,
      'partner_links_ended', v_partner_links_ended,
      'invitations_revoked', v_invitations_revoked,
      'pending_partner_links_closed', v_pending_partner_links_closed,
      'stripe_accounts_detached', jsonb_array_length(v_stripe_accounts)
    )
  );

  -- 8.
  RETURN jsonb_build_object(
    'status', 'deleted',
    'already_deleted', false,
    'brand_ids', to_jsonb(v_brand_ids),
    'events_taken_down', v_events_taken_down,
    'memberships_removed', v_memberships_removed,
    'partner_links_ended', v_partner_links_ended,
    'invitations_revoked', v_invitations_revoked,
    'pending_partner_links_closed', v_pending_partner_links_closed,
    'stripe_accounts', v_stripe_accounts,
    'paystack_subaccounts', v_paystack_subaccounts
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_delete_host_account(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_delete_host_account(uuid) TO service_role;

COMMENT ON FUNCTION public.biz_delete_host_account(uuid) IS
  'Issue #3660: the only writer of a Host account deletion. Preflight plus every write in one transaction; returns status deleted / blocked / nothing_to_delete. Service role only. No provider call happens here.';

-- ---------------------------------------------------------------------------
-- 3. The same preflight, for the signed-in Host's own account (delete screen).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_my_host_account_deletion_blockers()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_brand_ids uuid[];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(b.id), ARRAY[]::uuid[])
  INTO v_brand_ids
  FROM public.brands b
  WHERE b.account_id = v_caller
    AND b.deleted_at IS NULL;

  RETURN private.host_account_deletion_blockers(v_caller, v_brand_ids);
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_my_host_account_deletion_blockers()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.biz_my_host_account_deletion_blockers()
  TO authenticated;

COMMENT ON FUNCTION public.biz_my_host_account_deletion_blockers() IS
  'Issue #3660: the caller''s own Host account deletion blockers (auth.uid() only). Read-only preview for the delete screen; biz_delete_host_account re-checks under lock.';

-- ---------------------------------------------------------------------------
-- 4. "Deletion is final": a signed-in user may not un-delete a brand.
--
-- The owner's UPDATE policy on public.brands has no deleted_at condition, so
-- after a deletion the kept login could bring its own brand back with one
-- direct table write (and its public page with it). No screen in any Mingla
-- app sends that write; the only shipped restore is the admin console's
-- admin_set_brand_deleted, which requires is_admin_user().
--
-- This guard refuses exactly one transition (deleted_at set -> NULL) for
-- exactly the API roles (authenticated, anon) when the caller is not an admin.
-- The service role, an admin, and a direct database session are unaffected, so
-- support can still restore a brand. Setting deleted_at is not touched here:
-- issue_2063_guard_brand_soft_delete owns that direction and is not edited.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3660_guard_brand_undelete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF OLD.deleted_at IS NOT NULL
     AND NEW.deleted_at IS NULL
     AND COALESCE(auth.role(), '') IN ('authenticated', 'anon')
     AND NOT COALESCE(public.is_admin_user(), false) THEN
    RAISE EXCEPTION 'brand_restore_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_3660_guard_brand_undelete()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.issue_3660_guard_brand_undelete() IS
  'Issue #3660: a signed-in non-admin user may not clear brands.deleted_at. Service role and is_admin_user() still can (support restore).';

DROP TRIGGER IF EXISTS issue_3660_guard_brand_undelete ON public.brands;
CREATE TRIGGER issue_3660_guard_brand_undelete
  BEFORE UPDATE OF deleted_at ON public.brands
  FOR EACH ROW
  EXECUTE FUNCTION public.issue_3660_guard_brand_undelete();

-- ---------------------------------------------------------------------------
-- Self-verify. Looks at objects only, never at data.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_fn regprocedure;
BEGIN
  IF to_regprocedure('private.host_account_deletion_blockers(uuid, uuid[])') IS NULL
     OR to_regprocedure('public.biz_delete_host_account(uuid)') IS NULL
     OR to_regprocedure('public.biz_my_host_account_deletion_blockers()') IS NULL THEN
    RAISE EXCEPTION 'issue_3660 verify: a function is missing';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.biz_delete_host_account(uuid)'::regprocedure,
    'public.biz_my_host_account_deletion_blockers()'::regprocedure
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = v_fn
        AND p.prosecdef
        AND EXISTS (
          SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c
          WHERE c LIKE 'search_path=%'
        )
    ) THEN
      RAISE EXCEPTION 'issue_3660 verify: % is not SECURITY DEFINER with a pinned search_path', v_fn;
    END IF;
  END LOOP;

  IF has_function_privilege('anon', 'private.host_account_deletion_blockers(uuid, uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.biz_delete_host_account(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.biz_my_host_account_deletion_blockers()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3660 verify: anon can execute a host-deletion function';
  END IF;
  IF has_function_privilege('authenticated', 'public.biz_delete_host_account(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3660 verify: authenticated can execute biz_delete_host_account';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.biz_delete_host_account(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3660 verify: service_role cannot execute biz_delete_host_account';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.biz_my_host_account_deletion_blockers()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3660 verify: authenticated cannot execute biz_my_host_account_deletion_blockers';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.brands'::regclass
      AND t.tgname = 'issue_2063_guard_brand_soft_delete'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'issue_3660 verify: issue_2063_guard_brand_soft_delete is missing or disabled';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.brands'::regclass
      AND t.tgname = 'issue_3660_guard_brand_undelete'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'issue_3660 verify: issue_3660_guard_brand_undelete is missing or disabled';
  END IF;
  IF has_function_privilege('anon', 'public.issue_3660_guard_brand_undelete()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3660_guard_brand_undelete()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3660 verify: the un-delete guard function is callable by an API role';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.brand_team_members'::regclass
      AND t.tgname = 'brand_team_members_removal_guard'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'issue_3660 verify: brand_team_members_removal_guard is missing or disabled';
  END IF;
END
$verify$;

COMMIT;
