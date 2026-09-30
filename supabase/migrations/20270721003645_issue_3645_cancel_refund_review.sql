-- Issue #3645 PR2 — cancel-review hold on the #1179 / #1221 cancellation refund plane.
--
-- When a paid offering is cancelled, Mingla must no longer start refunding the
-- instant the status flips. Instead:
--   1. Sales are frozen at cancel time (online, non-hidden, non-deleted ticket
--      types get sale_end_at = now() + is_disabled = true — the same WHERE clause
--      as business_end_event_ticket_sales — and the event's trip bookings are
--      closed: bookings_closed = true, bookings_closed_at = now() when not already
--      closed).
--   2. The event_cancel_refund_runs row opens in the new `awaiting_review` status
--      whenever there is refund work (paid orders in the progress table OR paid
--      RSVP contributions that still need a cancel refund). Zero refund work
--      completes immediately, exactly as before.
--   3. cancel_event_refund_claim returns NOTHING unless the run is pending,
--      in_progress or failed_partial. The fan-out edge function returns early on a
--      held run (it never calls prepare_event_cancel_rsvp_source_refunds), and the
--      #1179 backstop cron only selects pending/in_progress/failed_partial — so no
--      path refunds while awaiting_review.
--   4. An admin releases the batch with admin_release_event_cancel_refund_batch
--      (awaiting_review -> pending). The fan-out / cron then drain it as before.
--
-- Reuse only: no new table, no new edge function, no new workflow product. Steps
-- 1-3 of cancel_event_refund_prepare (status guard, stop releases, Stripe debt
-- conversion) and the order enumeration INSERT are preserved byte-for-byte from
-- 20270110000009_issue_1179_cancel_refund_fanout.sql.
--
-- Runs already opened by #1179 before this migration keep their status
-- (pending / in_progress / failed_partial / completed): a run that has already been
-- released or finished is never demoted back into review.

-- =============================================================================
-- §1. Allow the `awaiting_review` status on event_cancel_refund_runs.
--     The original CHECK is inline on the column (auto-named); look it up instead
--     of hard-coding the name so the drop is safe on any replay.
-- =============================================================================
DO $$
DECLARE
  v_con record;
BEGIN
  FOR v_con IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.event_cancel_refund_runs'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%failed_partial%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.event_cancel_refund_runs DROP CONSTRAINT %I', v_con.conname
    );
  END LOOP;
END$$;

ALTER TABLE public.event_cancel_refund_runs
  ADD CONSTRAINT event_cancel_refund_runs_status_check
  CHECK (status IN (
    'awaiting_review','pending','in_progress','completed','failed_partial'
  ));

-- =============================================================================
-- §2. cancel_event_refund_prepare — #1179 body + sales freeze + review hold.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_event_refund_prepare(
  p_event_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_status text;
  v_brand_id uuid;
  v_provider text;
  v_release record;
  v_temp public.organiser_payout_debts;
  v_total integer;
  v_rsvp_count integer;
  v_run_status text;
  v_pending_ids uuid[];
BEGIN
  -- 1. Status-first guard (binding race guard + the SOLE authorization). A live or
  --    racing-not-yet-cancelled event yields zero refunds and writes NOTHING.
  SELECT status, brand_id INTO v_status, v_brand_id
  FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'event_not_cancelled' USING ERRCODE = 'P0002';
  END IF;

  -- Provider is brand-wide (an event belongs to exactly one brand).
  SELECT CASE WHEN b.payment_provider = 'paystack' THEN 'paystack' ELSE 'stripe' END
  INTO v_provider FROM public.brands b WHERE b.id = v_brand_id;
  v_provider := COALESCE(v_provider, 'stripe');

  -- 1b. #3645 PR2 — freeze sales (idempotent). Same WHERE clause as
  --     business_end_event_ticket_sales: online, non-hidden, non-deleted ticket
  --     types that are still open get sale_end_at = now + is_disabled. Trip
  --     bookings are closed unless already closed (bookings_closed_at keeps the
  --     original close time).
  UPDATE public.ticket_types
  SET sale_end_at = p_now,
      is_disabled = true,
      updated_at = p_now
  WHERE event_id = p_event_id
    AND deleted_at IS NULL
    AND is_hidden IS NOT TRUE
    AND available_online IS TRUE
    AND (
      sale_end_at IS NULL
      OR sale_end_at > p_now
      OR is_disabled IS NOT TRUE
    );

  UPDATE public.events
  SET bookings_closed = true,
      bookings_closed_at = COALESCE(bookings_closed_at, p_now)
  WHERE id = p_event_id
    AND bookings_closed IS NOT TRUE;

  -- 2. Stop releases (event-scoped; NEVER releases). SKIP LOCKED so a release the
  --    sweep is currently holding is left for the cron re-drive — the sweep's own
  --    pre-execute status re-check (I-1013-CANCELLED-NEVER-RELEASES) prevents it
  --    executing for a cancelled event. Idempotent (already-cancelled rows excluded).
  WITH locked AS (
    SELECT id FROM public.brand_payout_releases
    WHERE event_id = p_event_id
      AND status IN (
        'pending','blocked_kyc','blocked_balance','blocked_otp','blocked_over_cap',
        'fee_unreconciled','blocked_anchor','reanchored'
      )
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.brand_payout_releases r
  SET status = 'cancelled_event', updated_at = p_now
  FROM locked WHERE r.id = locked.id;

  -- 3. Atomic debt conversion BEFORE any refund (dispatch item 4). ONLY Stripe
  --    released occurrences WITH an OPEN temporary postponement debt. Amount = the
  --    temp debt's principal_cents (== organiser_cash_delivered_cents at open time)
  --    so the permanent liability equals the debt it replaces — no growth, no
  --    stacking, no double withhold. Paystack is EXCLUDED (F owns its supersession).
  --    convert_postponement_debt_to_permanent is idempotent per (release, kind).
  FOR v_release IN
    SELECT r.id AS release_id
    FROM public.brand_payout_releases r
    WHERE r.event_id = p_event_id
      AND r.status = 'released'
      AND r.provider = 'stripe'
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    SELECT * INTO v_temp FROM public.organiser_payout_debts
    WHERE origin_release_id = v_release.release_id
      AND kind = 'post_release_postponement'
      AND status = 'open'
    FOR UPDATE;
    IF FOUND AND v_temp.principal_cents > 0 THEN
      PERFORM public.convert_postponement_debt_to_permanent(
        v_release.release_id, 'post_release_cancellation', v_temp.principal_cents, p_now
      );
    END IF;
  END LOOP;

  -- 4. Open / refresh the backstop run. A brand-new run opens in `awaiting_review`
  --    (the safe default) and is resolved below once the refund work is counted.
  --    An existing run NEVER changes status here: completed stays completed,
  --    awaiting_review stays held, and a run an admin already released (or one
  --    opened by #1179 before this change) keeps pending/in_progress/failed_partial.
  INSERT INTO public.event_cancel_refund_runs (event_id, status, last_attempt_at, opened_at)
  VALUES (p_event_id, 'awaiting_review', p_now, p_now)
  ON CONFLICT (event_id) DO UPDATE SET
    last_attempt_at = p_now;

  -- 5. Enumerate + persist per-object progress rows (orders only — tickets AND
  --    trips). Re-runs insert only newly-eligible/missing rows (ON CONFLICT DO
  --    NOTHING on the UNIQUE(source_type, source_id) guard).
  INSERT INTO public.event_cancel_refund_progress (
    event_id, source_type, source_id, provider, amount_cents, status
  )
  SELECT p_event_id, 'order', o.id, v_provider,
         (o.total_cents - COALESCE(o.refunded_amount_cents, 0)), 'pending'
  FROM public.orders o
  WHERE o.event_id = p_event_id
    AND o.payment_status IN ('paid','partial_refund')
    AND (o.total_cents - COALESCE(o.refunded_amount_cents, 0)) > 0
  ON CONFLICT (source_type, source_id) DO NOTHING;

  SELECT count(*)::integer INTO v_total
  FROM public.event_cancel_refund_progress WHERE event_id = p_event_id;

  -- 5b. #3645 PR2 — RSVP chip-in contributions have no order row; count the paid
  --     ones that still need a cancel refund so they hold the run too. (The
  --     source-refund rows themselves are only created by the fan-out after a
  --     release — prepare_event_cancel_rsvp_source_refunds is never reached while
  --     the run is awaiting_review.)
  SELECT count(*)::integer INTO v_rsvp_count
  FROM public.event_rsvp_contributions c
  WHERE c.event_id = p_event_id
    AND c.status IN ('paid','partially_refunded')
    AND c.buyer_total_cents > c.refunded_amount_cents;

  -- 6. Resolve the run status from the refund work.
  --      completed                     -> stays completed (never demoted)
  --      awaiting_review / pending /
  --      in_progress / failed_partial  -> stay as they are when work remains
  --      no refund work at all         -> completed (as before #3645)
  --      new run with refund work      -> awaiting_review (the hold)
  --    The CASE reads the row's pre-UPDATE status throughout.
  UPDATE public.event_cancel_refund_runs
  SET total_objects = v_total,
      status = CASE
        WHEN status = 'completed' THEN status
        WHEN v_total = 0 AND v_rsvp_count = 0 THEN 'completed'
        ELSE status
      END,
      completed_at = CASE
        WHEN status <> 'completed' AND v_total = 0 AND v_rsvp_count = 0
             AND completed_at IS NULL THEN p_now
        ELSE completed_at
      END
  WHERE event_id = p_event_id
  RETURNING status INTO v_run_status;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_pending_ids
  FROM public.event_cancel_refund_progress
  WHERE event_id = p_event_id AND status IN ('pending','failed_retryable');

  RETURN jsonb_build_object(
    'run_status', v_run_status,
    'total_objects', v_total,
    'pending_object_ids', to_jsonb(v_pending_ids),
    'rsvp_pending_count', v_rsvp_count
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.cancel_event_refund_prepare(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_event_refund_prepare(uuid, timestamptz)
  TO service_role;
COMMENT ON FUNCTION public.cancel_event_refund_prepare(uuid, timestamptz) IS
  'Issue #1179 (J) + #3645 PR2: status-first guarded, atomic — freezes ticket sales and closes trip bookings, stops pending releases, converts Stripe temp postponement debt to permanent post_release_cancellation (no double withhold), enumerates order refund progress rows, and opens the run in awaiting_review when refund work exists (zero work completes). service_role only.';

-- =============================================================================
-- §3. cancel_event_refund_claim — never leases work for a held run.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_event_refund_claim(
  p_event_id uuid,
  p_limit integer DEFAULT 25,
  p_now timestamptz DEFAULT now()
) RETURNS SETOF public.event_cancel_refund_progress
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_run_status text;
BEGIN
  -- #3645 PR2: the hold. A missing run or a run that is awaiting_review (or
  -- completed) leases NOTHING — refunds start only after an admin release moves
  -- the run to pending.
  SELECT status INTO v_run_status
  FROM public.event_cancel_refund_runs WHERE event_id = p_event_id;
  IF v_run_status IS NULL
     OR v_run_status NOT IN ('pending','in_progress','failed_partial') THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH claimed AS (
    SELECT id FROM public.event_cancel_refund_progress
    WHERE event_id = p_event_id
      AND (
        status = 'pending'
        OR (status = 'failed_retryable'
            AND attempt_count < 8
            AND (leased_at IS NULL OR leased_at < p_now - interval '10 minutes'))
        OR (status = 'refunding' AND leased_at < p_now - interval '10 minutes')
      )
    ORDER BY created_at, id
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.event_cancel_refund_progress p
  SET status = 'refunding',
      leased_at = p_now,
      attempt_count = p.attempt_count + 1,
      updated_at = p_now
  FROM claimed
  WHERE p.id = claimed.id
  RETURNING p.*;
END;
$fn$;

REVOKE ALL ON FUNCTION public.cancel_event_refund_claim(uuid, integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_event_refund_claim(uuid, integer, timestamptz)
  TO service_role;
COMMENT ON FUNCTION public.cancel_event_refund_claim(uuid, integer, timestamptz) IS
  'Issue #1179 (J) + #3645 PR2: leases a bounded batch of pending/retryable/stale cancellation-refund objects for exactly one runner (FOR UPDATE SKIP LOCKED + stale-lease reclaim), but only while the parent run is pending/in_progress/failed_partial — an awaiting_review (held) run leases nothing. service_role only.';

-- =============================================================================
-- §4. admin_release_event_cancel_refund_batch — the release valve.
--     awaiting_review -> pending. Guard-first (ORCH-1271 golden template): admin
--     gate, reason gate, row lock, audited write.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_release_event_cancel_refund_batch(
  p_event_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_run public.event_cancel_refund_runs;
BEGIN
  IF NOT public.is_admin_user() THEN                      -- guard FIRST
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'run_not_found';
  END IF;

  SELECT * INTO v_run
  FROM public.event_cancel_refund_runs
  WHERE event_id = p_event_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'run_not_found';
  END IF;
  IF v_run.status IS DISTINCT FROM 'awaiting_review' THEN
    RAISE EXCEPTION 'not_awaiting_review';
  END IF;

  v_before := to_jsonb(v_run);

  UPDATE public.event_cancel_refund_runs
  SET status = 'pending',
      last_attempt_at = now()
  WHERE event_id = p_event_id
  RETURNING to_jsonb(event_cancel_refund_runs.*) INTO v_after;

  PERFORM public.admin_write_audit(
    'offering.cancel_refund_release', 'offering', p_event_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after)
  );

  RETURN v_after;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_release_event_cancel_refund_batch(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_release_event_cancel_refund_batch(uuid, text)
  TO authenticated;
COMMENT ON FUNCTION public.admin_release_event_cancel_refund_batch(uuid, text) IS
  'Issue #3645 PR2: admin-only (is_admin_user first, reason required, audited via admin_write_audit) release of a cancelled offering''s held refund batch: event_cancel_refund_runs awaiting_review -> pending so event-cancel-refund-fanout / the #1179 backstop cron can drain it. Raises not_authorized, reason_required, run_not_found, not_awaiting_review.';

-- Privilege self-assert (ORCH-1277 style): apply FAILS unless the lockdown holds.
DO $$
BEGIN
  IF has_function_privilege('anon',
       'public.admin_release_event_cancel_refund_batch(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3645: admin_release_event_cancel_refund_batch EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.admin_release_event_cancel_refund_batch(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3645: authenticated lost EXECUTE on admin_release_event_cancel_refund_batch';
  END IF;
  IF has_function_privilege('anon',
       'public.cancel_event_refund_claim(uuid,integer,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.cancel_event_refund_claim(uuid,integer,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.cancel_event_refund_prepare(uuid,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3645: claim/prepare became callable by anon/authenticated';
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.cancel_event_refund_claim(uuid,integer,timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.cancel_event_refund_prepare(uuid,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3645: service_role lost EXECUTE on claim/prepare';
  END IF;
END$$;

-- The #1179 backstop cron (issue_1179_cancel_refund_fanout_backstop) and the scan
-- index already select only status IN ('pending','in_progress','failed_partial'),
-- so awaiting_review runs are never re-driven. Deliberately NOT recreated here.

NOTIFY pgrst, 'reload schema';
