-- Issue #3645 bundle 4 follow-up — two review fixes that missed #4369's merge.
--
-- 1. A carryover placed on a release that was then closed before any claim
--    (issue_3645_release_closed_unpaid) still blocks account deletion until
--    the next claim moves it on. The release arm of
--    private.host_account_deletion_blockers leaves cancelled releases out, and
--    the carryover arm only counted value not placed yet, so the money owed
--    to the host was invisible to deletion in between.
-- 2. issue_3645_flag_oversized_paystack_plans also scans in_flight releases
--    whose claim expired (a worker died after claiming). The Paystack claim
--    leaves an oversized plan out in that state too, so without this the
--    release stayed stuck with no ops alert.
--
-- Both functions are re-emitted from 20280602003645 with only those hunks:
-- __tests__/issue_3645_ledger_followup_round3_reemit_hunks.ts. Owners, grants
-- and attributes are kept by CREATE OR REPLACE.
-- Proofs: __tests__/issue_3645_payout_ledger_followups.pg17.test.sql (B12, B16).

BEGIN;

-- §1. Flag expired in_flight claims with an oversized plan as well.
CREATE OR REPLACE FUNCTION public.issue_3645_flag_oversized_paystack_plans(
  p_now timestamptz
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_rel record;
  v_flagged integer := 0;
BEGIN
  FOR v_rel IN
    SELECT r.id, r.brand_id,
      public.issue_3645_paystack_plan_cents(r.id) AS plan_cents,
      public.issue_3645_release_due_cents(r.id) AS due_cents
    FROM public.brand_payout_releases r
    WHERE r.provider = 'paystack'
      AND r.paystack_transfer_code IS NULL
      AND (
        r.status IN (
          'pending', 'blocked_balance', 'blocked_otp', 'blocked_over_cap',
          'fee_unreconciled'
        )
        -- A claim that expired (the worker died): the claim would take it
        -- again, so it is left out and must be flagged the same way.
        OR (
          r.status = 'in_flight'
          AND r.paystack_execution_claimed_at < p_now - interval '10 minutes'
        )
      )
      AND EXISTS (
        SELECT 1 FROM public.payout_transfer_legs leg
        WHERE leg.release_id = r.id AND leg.kind = 'organiser'
          AND leg.status NOT IN ('failed', 'reversed')
      )
      AND public.issue_3645_paystack_plan_cents(r.id)
        > public.issue_3645_release_due_cents(r.id)
    ORDER BY r.id
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    INSERT INTO public.payout_release_alert_outbox (
      release_id, alert_kind, idempotency_key, brand_id, error_message,
      created_at, updated_at
    ) VALUES (
      v_rel.id, 'paystack_plan_exceeds_due',
      'paystack_plan_exceeds_due:' || v_rel.id::text, v_rel.brand_id,
      left(format('plan %s > due %s', v_rel.plan_cents, v_rel.due_cents), 1000),
      p_now, p_now
    ) ON CONFLICT (release_id, alert_kind) DO NOTHING;
    UPDATE public.brand_payout_releases
    SET error_message = 'paystack_plan_exceeds_due', updated_at = p_now
    WHERE id = v_rel.id
      AND error_message IS DISTINCT FROM 'paystack_plan_exceeds_due';
    v_flagged := v_flagged + 1;
  END LOOP;
  RETURN v_flagged;
END;
$fn$;


-- §2. Carried value placed on a carrier closed before any claim still blocks
-- account deletion until it is moved on.
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
    -- Money Mingla is holding for the organiser and has not released yet:
    -- every source the payout sweep would ledger, with no `released` item.
    -- ONE definition, one arm per sweep arm: see
    -- private.host_account_unreleased_held_money above.
    + (SELECT count(*)
       FROM private.host_account_unreleased_held_money(v_brand_ids, v_event_ids))
    -- #3645 bundle 4: matured value carried to a later payout and not placed
    -- yet is still owed to the host (placed value rides on a pending
    -- release, which the first arm counts, unless that release was closed).
    + (SELECT count(*) FROM public.payout_maturity_carryovers c
        WHERE c.brand_id = ANY (v_brand_ids)
          AND (c.carried_at IS NULL
               -- placed on a carrier closed before any claim, and not
               -- moved on yet: the next claim re-homes it, still owed.
               OR (c.rehomed_at IS NULL
                   AND public.issue_3645_release_closed_unpaid(c.carried_release_id))))
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


-- §3. Self-assert above COMMIT.
DO $$
BEGIN
  IF position('rehomed_at IS NULL' in pg_get_functiondef(
       'private.host_account_deletion_blockers(uuid,uuid[])'::regprocedure)) = 0
     OR position('issue_3645_release_closed_unpaid' in pg_get_functiondef(
       'private.host_account_deletion_blockers(uuid,uuid[])'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '#3645 bundle 4 follow-up self-assert: carried value on a closed carrier does not block deletion';
  END IF;
  IF position('r.paystack_execution_claimed_at < p_now - interval ''10 minutes''' in
       pg_get_functiondef('public.issue_3645_flag_oversized_paystack_plans(timestamptz)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '#3645 bundle 4 follow-up self-assert: expired in_flight claims are not flagged';
  END IF;
END$$;

COMMIT;
