-- Issue #3645 PR2 — cancel-review hold (PostgreSQL 17 implementor happy path).
-- Run after all migrations against a disposable database. Every write rolls back;
-- any missing invariant raises and psql ON_ERROR_STOP fails.
--
-- Proves, for a cancelled paid offering:
--   * prepare freezes online, non-hidden, non-deleted ticket sales (sale_end_at,
--     is_disabled) and closes bookings (bookings_closed + bookings_closed_at); hidden,
--     offline and deleted ticket types are untouched; an already-closed event keeps
--     its original bookings_closed_at
--   * the run opens `awaiting_review` (paid orders) and claim leases NOTHING
--   * an RSVP-contribution-only cancel is held too (no order rows)
--   * admin_release_event_cancel_refund_batch (real admin via authenticated role +
--     JWT sub) moves awaiting_review -> pending, writes the audit row, and claim then
--     leases the batch; mark refunded completes the run
--   * a completed run is never demoted by a re-prepare
BEGIN;

DO $test$
DECLARE
  v_owner     constant uuid := '36450000-0000-4000-8000-000000000001';
  v_admin     constant uuid := '36450000-0000-4000-8000-0000000000ad';
  v_brand     constant uuid := '36450000-0000-4000-8000-000000000010';
  v_event     constant uuid := '36450000-0000-4000-8000-000000000020';
  v_event_rsvp   constant uuid := '36450000-0000-4000-8000-000000000021';
  v_event_closed constant uuid := '36450000-0000-4000-8000-000000000022';
  v_tt_open    constant uuid := '36450000-0000-4000-8000-000000000040';
  v_tt_hidden  constant uuid := '36450000-0000-4000-8000-000000000041';
  v_tt_offline constant uuid := '36450000-0000-4000-8000-000000000042';
  v_tt_deleted constant uuid := '36450000-0000-4000-8000-000000000043';
  v_order      constant uuid := '36450000-0000-4000-8000-000000000030';
  v_line       constant uuid := '36450000-0000-4000-8000-000000000050';
  v_contrib    constant uuid := '36450000-0000-4000-8000-000000000060';
  v_old_close  constant timestamptz := '2026-01-01 00:00:00+00';
  v_prep   jsonb;
  v_rel    jsonb;
  v_status text;
  v_count  integer;
  v_ts     timestamptz;
  v_bool   boolean;
  v_pid    uuid;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-3645r@example.test');
  INSERT INTO auth.users(id, email) VALUES (v_admin, 'admin-3645r@example.test');
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('admin-3645r@example.test', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 Review Brand', 'issue-3645-review-brand',
    'stripe', 'US', 'USD', 'USD'
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES
    (v_event,      v_brand, 'Cancelled Paid Event', 'issue-3645r-paid',  'cancelled', 'USD'),
    (v_event_rsvp, v_brand, 'Cancelled RSVP Event', 'issue-3645r-rsvp',  'cancelled', 'USD');
  INSERT INTO public.events(
    id, brand_id, title, slug, status, currency, bookings_closed, bookings_closed_at
  ) VALUES (
    v_event_closed, v_brand, 'Already Closed Event', 'issue-3645r-closed',
    'cancelled', 'USD', true, v_old_close
  );
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_hidden, available_online)
  VALUES
    (v_tt_open,    v_event, 'GA',      5000, 'USD', false, true),
    (v_tt_hidden,  v_event, 'Hidden',  5000, 'USD', true,  true),
    (v_tt_offline, v_event, 'Door',    5000, 'USD', false, false);
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, deleted_at)
  VALUES (v_tt_deleted, v_event, 'Deleted', 5000, 'USD', now());
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source
  ) VALUES (v_order, v_event, 5000, 'USD', 'paid', 'pi_3645r_a', 'ch_3645r_a', 'legacy');
  INSERT INTO public.order_line_items(
    id, order_id, ticket_type_id, quantity, unit_price_cents, total_cents
  ) VALUES (v_line, v_order, v_tt_open, 1, 5000, 5000);

  -- RSVP-only event: a paid chip-in contribution and NO order.
  INSERT INTO public.event_rsvp_contributions(
    id, event_id, brand_id, provider, currency, amount_cents, buyer_total_cents,
    pricing_breakdown, status, stripe_payment_intent_id, paid_at
  ) VALUES (
    v_contrib, v_event_rsvp, v_brand, 'stripe', 'USD', 2500, 2500,
    '{"tax_basis":"voluntary_contribution","tax_cents":0}'::jsonb, 'paid',
    'pi_3645r_rsvp', now()
  );

  ------------------------------------------------------------------------------
  -- ACT: prepare the paid cancelled event.
  ------------------------------------------------------------------------------
  v_prep := public.cancel_event_refund_prepare(v_event);
  IF v_prep->>'run_status' <> 'awaiting_review' THEN
    RAISE EXCEPTION 'prepare_expected_awaiting_review_got_%', v_prep->>'run_status';
  END IF;
  IF (v_prep->>'total_objects')::int <> 1 THEN
    RAISE EXCEPTION 'prepare_total_objects_expected_1_got_%', v_prep->>'total_objects';
  END IF;
  SELECT status INTO v_status FROM public.event_cancel_refund_runs WHERE event_id = v_event;
  IF v_status <> 'awaiting_review' THEN
    RAISE EXCEPTION 'run_row_expected_awaiting_review_got_%', v_status;
  END IF;

  -- Sales freeze: open online ticket is ended + disabled.
  IF NOT EXISTS (
    SELECT 1 FROM public.ticket_types
    WHERE id = v_tt_open AND is_disabled AND sale_end_at IS NOT NULL
      AND sale_end_at <= now()
  ) THEN
    RAISE EXCEPTION 'freeze_open_ticket_sale_end_not_set';
  END IF;
  -- Hidden / offline / deleted tickets are NOT touched (same WHERE as end-sales).
  SELECT count(*) INTO v_count FROM public.ticket_types
   WHERE id IN (v_tt_hidden, v_tt_offline, v_tt_deleted)
     AND (is_disabled OR sale_end_at IS NOT NULL);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'freeze_touched_hidden_offline_or_deleted_tickets_%', v_count;
  END IF;
  -- Bookings closed.
  SELECT bookings_closed, bookings_closed_at INTO v_bool, v_ts
  FROM public.events WHERE id = v_event;
  IF v_bool IS NOT TRUE OR v_ts IS NULL THEN
    RAISE EXCEPTION 'freeze_bookings_not_closed';
  END IF;

  -- Already-closed event keeps its original close time.
  PERFORM public.cancel_event_refund_prepare(v_event_closed);
  SELECT bookings_closed_at INTO v_ts FROM public.events WHERE id = v_event_closed;
  IF v_ts IS DISTINCT FROM v_old_close THEN
    RAISE EXCEPTION 'freeze_overwrote_existing_bookings_closed_at_%', v_ts;
  END IF;
  -- ... and with zero refund work it completes as before.
  SELECT status INTO v_status FROM public.event_cancel_refund_runs WHERE event_id = v_event_closed;
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'zero_work_run_expected_completed_got_%', v_status;
  END IF;

  ------------------------------------------------------------------------------
  -- HOLD: claim leases nothing; RSVP-only cancel is held too.
  ------------------------------------------------------------------------------
  SELECT count(*) INTO v_count FROM public.cancel_event_refund_claim(v_event, 25);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'claim_leased_%_while_awaiting_review', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.event_cancel_refund_progress
   WHERE event_id = v_event AND status <> 'pending';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'hold_progress_rows_moved_%', v_count;
  END IF;

  v_prep := public.cancel_event_refund_prepare(v_event_rsvp);
  IF v_prep->>'run_status' <> 'awaiting_review'
     OR (v_prep->>'rsvp_pending_count')::int <> 1
     OR (v_prep->>'total_objects')::int <> 0 THEN
    RAISE EXCEPTION 'rsvp_only_expected_held_got_%', v_prep;
  END IF;

  ------------------------------------------------------------------------------
  -- RELEASE: real admin RPC -> pending + audit; claim then drains.
  ------------------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_rel := public.admin_release_event_cancel_refund_batch(v_event, 'Reviewed cancellation refunds');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF v_rel->>'status' <> 'pending' THEN
    RAISE EXCEPTION 'release_expected_pending_got_%', v_rel->>'status';
  END IF;
  SELECT status INTO v_status FROM public.event_cancel_refund_runs WHERE event_id = v_event;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'run_expected_pending_after_release_got_%', v_status;
  END IF;
  SELECT count(*) INTO v_count FROM public.admin_audit_log
   WHERE action = 'offering.cancel_refund_release'
     AND target_type = 'offering'
     AND target_id = v_event::text
     AND reason = 'Reviewed cancellation refunds'
     AND admin_email = 'admin-3645r@example.test';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'release_audit_row_expected_1_got_%', v_count;
  END IF;

  -- A re-prepare after release does not re-hold the run.
  v_prep := public.cancel_event_refund_prepare(v_event);
  IF v_prep->>'run_status' <> 'pending' THEN
    RAISE EXCEPTION 'reprepare_after_release_changed_status_to_%', v_prep->>'run_status';
  END IF;

  SELECT count(*) INTO v_count FROM public.cancel_event_refund_claim(v_event, 25);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'claim_after_release_expected_1_got_%', v_count;
  END IF;

  SELECT id INTO v_pid FROM public.event_cancel_refund_progress WHERE event_id = v_event;
  PERFORM public.cancel_event_refund_mark(v_pid, 'refunded', NULL, NULL);
  SELECT status INTO v_status FROM public.event_cancel_refund_runs WHERE event_id = v_event;
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'run_expected_completed_got_%', v_status;
  END IF;

  -- Completed runs are never demoted back into review.
  v_prep := public.cancel_event_refund_prepare(v_event);
  IF v_prep->>'run_status' <> 'completed' THEN
    RAISE EXCEPTION 'completed_run_demoted_to_%', v_prep->>'run_status';
  END IF;

  RAISE NOTICE 'issue_3645_cancel_review_happy_pass sales freeze + awaiting_review hold + admin release + claim + completed-not-demoted';
END;
$test$;

ROLLBACK;
