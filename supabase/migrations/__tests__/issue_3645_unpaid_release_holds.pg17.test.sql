-- Issue #3645 — refunds and disputes on payouts that have not gone out yet.
--
-- MINGLA-INVARIANT: I-3645-UNPAID-RELEASE-HOLDS-APPEND-ONLY | issue #3645 | A refund or dispute landing on an unpaid payout release never updates payout_release_items; it is recorded in the append-only stay_payout_release_holds (stays) or read live from paystack_disputes (Paystack), and the release totals are projected from them.
-- MINGLA-INVARIANT: I-3645-ONE-RELEASE-PROJECTION | issue #3645 | Every rebuild of a pending release (plan_pending_payout_partner_legs, the Stripe stay projection, the Paystack dispute projection) uses issue_3645_release_projected_totals, so no rebuild can drop a hold or debt already recovered from that release.
-- MINGLA-INVARIANT: I-3645-STAY-DISPUTE-HOLD-FAILS-CLOSED | issue #3645 | A stay payout is not authorised while a dispute held on its release is open; won returns the hold, lost keeps it, and a dispute held before payout is never charged again after payout.

BEGIN;

-- The fixture stays have no quote or offering rows, so the #1388 cross-table
-- scope guards (unrelated to payouts) are off for this rolled-back
-- transaction. Every payout, refund and dispute trigger stays on.
ALTER TABLE public.stay_reservation_groups DISABLE TRIGGER stay_reservation_groups_scope_guard;
ALTER TABLE public.stay_reservation_lines DISABLE TRIGGER stay_reservation_lines_scope_guard;
ALTER TABLE public.stay_reservation_events DISABLE TRIGGER stay_reservation_events_scope_guard;
-- Postgres re-checks foreign keys on rows inserted earlier in the same
-- transaction, so the quote, offering and cancel-preview references the
-- fixture does not build are dropped for this transaction too.
ALTER TABLE public.stay_reservation_groups DROP CONSTRAINT stay_reservation_groups_quote_id_fkey;
ALTER TABLE public.stay_reservation_lines DROP CONSTRAINT stay_reservation_lines_quote_line_id_fkey;
ALTER TABLE public.stay_reservation_lines DROP CONSTRAINT stay_reservation_lines_offering_id_fkey;
ALTER TABLE public.stay_refunds DROP CONSTRAINT stay_refunds_cancel_preview_id_fkey;

CREATE TEMP TABLE fx(k text PRIMARY KEY, v uuid NOT NULL);

DO $seed$
DECLARE
  v_owner constant uuid := '36450a00-0000-4000-8000-000000000001';
  v_brand constant uuid := '36450a00-0000-4000-8000-000000000002';
  v_stay_venue constant uuid := '36450a00-0000-4000-8000-000000000006';
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'issue-3645-unpaid-holds@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 Unpaid Holds', 'issue-3645-unpaid-holds',
    'stripe', 'US', 'USD', 'USD', timestamptz '2020-01-01 00:00:00+00'
  );
  INSERT INTO public.venue_listings(
    id, brand_id, slug, name, lat, lng, venue_category, claim_status
  ) VALUES (
    v_stay_venue, v_brand, 'issue3645holds', 'Issue 3645 Holds Stay', 40.8,
    -74.1, 'stay', 'verified'
  );
  INSERT INTO public.stay_settings(
    venue_id, brand_id, property_kind, timezone, default_booking_mode, booking_state
  ) VALUES (v_stay_venue, v_brand, 'hotel', 'UTC', 'instant', 'active');
  INSERT INTO fx VALUES ('owner', v_owner), ('brand', v_brand), ('venue', v_stay_venue);
END
$seed$;

CREATE FUNCTION pg_temp.fx(p_key text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM fx WHERE k = p_key $$;

-- One confirmed, paid stay line (10450 charged, 450 Mingla fee, 300 Stripe
-- fee), attached by the real dark sweep: a pending release with net 10000.
CREATE FUNCTION pg_temp.stay(p_n integer) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_now constant timestamptz := timestamptz '2026-10-21 12:00:00+00';
  v_group uuid := ('36450a00-0000-4000-8001-' || lpad(p_n::text, 12, '0'))::uuid;
  v_line uuid := ('36450a00-0000-4000-8002-' || lpad(p_n::text, 12, '0'))::uuid;
  v_attempt uuid := ('36450a00-0000-4000-8003-' || lpad(p_n::text, 12, '0'))::uuid;
  v_release uuid;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.stay_reservation_groups(
    id, public_reference, quote_id, actor_key_hash, venue_id, brand_id,
    currency_code, mode, state, guest_snapshot, source_subtotal_minor,
    fee_total_minor, tax_total_minor, total_minor, idempotency_key, request_hash
  ) VALUES (
    v_group, 'ST-36450' || lpad(p_n::text, 15, '0'), gen_random_uuid(),
    repeat('a', 64), pg_temp.fx('venue'), pg_temp.fx('brand'), 'USD',
    'instant', 'confirmed', '{}'::jsonb, 10000, 450, 0, 10450,
    'issue-3645-holds-group-' || p_n, repeat('b', 64)
  );
  INSERT INTO public.stay_reservation_lines(
    id, group_id, quote_line_id, offering_id, kind, state, room_check_in,
    room_check_out, room_quantity, adults, children, base_minor, fee_minor,
    tax_minor, total_minor, offering_snapshot, price_snapshot, policy_snapshot
  ) VALUES (
    v_line, v_group, gen_random_uuid(), gen_random_uuid(), 'room', 'confirmed',
    (v_now + interval '8 days')::date, (v_now + interval '10 days')::date,
    1, 2, 0, 10000, 450, 0, 10450, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  );
  INSERT INTO public.stay_payment_attempts(
    id, group_id, provider, attempt_ordinal, amount_minor, currency_code,
    application_fee_minor, provider_fee_minor, state, provider_payment_ref,
    idempotency_key, request_hash, succeeded_at
  ) VALUES (
    v_attempt, v_group, 'stripe', 1, 10450, 'USD', 450, 300, 'succeeded',
    'pi_3645_hold_' || p_n, 'issue-3645-holds-attempt-' || p_n,
    repeat('c', 64), v_now - interval '25 hours'
  );
  INSERT INTO public.stay_payout_line_snapshots(
    reservation_line_id, payment_attempt_id, platform_fee_minor, provider_fee_minor
  ) VALUES (v_line, v_attempt, 450, 300);
  SET LOCAL session_replication_role = origin;

  PERFORM public.run_stay_payout_release_dark_sweep(v_now);
  SELECT item.release_id INTO v_release
  FROM public.payout_release_items item
  WHERE item.source_type = 'stay_reservation' AND item.source_id = v_line;
  IF v_release IS NULL THEN
    RAISE EXCEPTION 'fixture: stay % did not attach', p_n;
  END IF;
  RETURN v_release;
END
$$;

CREATE FUNCTION pg_temp.line(p_n integer) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT ('36450a00-0000-4000-8002-' || lpad(p_n::text, 12, '0'))::uuid
$$;

CREATE FUNCTION pg_temp.dispute(
  p_n integer, p_event text, p_ref text, p_amount integer, p_status text
) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.issue_1389_record_stay_dispute(
    p_event, 'charge.dispute.updated', 'pi_3645_hold_' || p_n, p_ref,
    p_amount, 'USD', p_status
  )
$$;

CREATE FUNCTION pg_temp.rel(p_release uuid)
RETURNS public.brand_payout_releases
LANGUAGE sql STABLE AS $$
  SELECT * FROM public.brand_payout_releases WHERE id = p_release
$$;

CREATE FUNCTION pg_temp.item_json(p_n integer) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT row_to_json(item)::text FROM public.payout_release_items item
  WHERE item.source_type = 'stay_reservation' AND item.source_id = pg_temp.line(p_n)
$$;

SELECT set_config('request.jwt.claim.role', 'service_role', true);

-- T1-T5: a dispute on an unpaid stay release: hold, replay, planner, refusal, won.
DO $t1$
DECLARE
  v_release uuid := pg_temp.stay(1);
  v_item_before text := pg_temp.item_json(1);
  v_r public.brand_payout_releases;
  v_result jsonb;
  v_claim uuid := gen_random_uuid();
BEGIN
  IF (pg_temp.rel(v_release)).net_release_cents <> 10000 THEN
    RAISE EXCEPTION 'T1 fixture net %', (pg_temp.rel(v_release)).net_release_cents;
  END IF;

  -- T1: the old body raised payout_ledger_append_only here.
  v_result := pg_temp.dispute(1, 'evt_3645_h1_open', 'dp_3645_h1', 2000, 'needs_response');
  IF (v_result->>'matched')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T1 dispute not matched: %', v_result;
  END IF;
  IF pg_temp.item_json(1) IS DISTINCT FROM v_item_before THEN
    RAISE EXCEPTION 'T1 item row changed: % -> %', v_item_before, pg_temp.item_json(1);
  END IF;
  v_r := pg_temp.rel(v_release);
  IF v_r.disputed_cents <> 2000 OR v_r.net_release_cents <> 8000
     OR v_r.error_message IS DISTINCT FROM 'stay_dispute_open' THEN
    RAISE EXCEPTION 'T1 projection wrong: %', row_to_json(v_r);
  END IF;
  IF (SELECT count(*) FROM public.stay_payout_release_holds
      WHERE release_id = v_release AND kind = 'dispute_opened'
        AND disputed_cents = 2000 AND net_hold_cents = 2000) <> 1 THEN
    RAISE EXCEPTION 'T1 expected one opened hold of 2000';
  END IF;
  IF (SELECT state FROM public.stay_reservation_lines WHERE id = pg_temp.line(1))
     <> 'reconciliation_required' THEN
    RAISE EXCEPTION 'T1 line state not moved to reconciliation_required';
  END IF;

  -- T2: the same provider event is a replay; a new non-final event adds nothing.
  v_result := pg_temp.dispute(1, 'evt_3645_h1_open', 'dp_3645_h1', 2000, 'needs_response');
  IF (v_result->>'replayed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T2 replay not detected: %', v_result;
  END IF;
  PERFORM pg_temp.dispute(1, 'evt_3645_h1_review', 'dp_3645_h1', 2500, 'under_review');
  IF (SELECT count(*) FROM public.stay_payout_release_holds WHERE release_id = v_release) <> 1
     OR (pg_temp.rel(v_release)).net_release_cents <> 8000 THEN
    RAISE EXCEPTION 'T2 a later event changed the hold';
  END IF;

  -- T3: the planner rebuild keeps the hold (the old planner restored 10000).
  PERFORM public.plan_pending_payout_partner_legs(500);
  v_r := pg_temp.rel(v_release);
  IF v_r.net_release_cents <> 8000 OR v_r.disputed_cents <> 2000 THEN
    RAISE EXCEPTION 'T3 planner dropped the hold: %', row_to_json(v_r);
  END IF;

  -- T4: a claimed payout is refused while the dispute is open.
  UPDATE public.brand_payout_releases
  SET status = 'in_flight', stripe_execution_claim_id = v_claim,
      stripe_execution_claimed_at = now()
  WHERE id = v_release;
  IF public.authorize_stripe_payout_execution(v_release, v_claim, 8000) THEN
    RAISE EXCEPTION 'T4 payout authorised while a held dispute is open';
  END IF;
  v_r := pg_temp.rel(v_release);
  IF v_r.status <> 'pending' OR v_r.stripe_execution_claim_id IS NOT NULL
     OR v_r.error_message <> 'stay_dispute_open' THEN
    RAISE EXCEPTION 'T4 refusal did not release the claim: %', row_to_json(v_r);
  END IF;

  -- T5: won returns the hold, once.
  PERFORM pg_temp.dispute(1, 'evt_3645_h1_won', 'dp_3645_h1', 2000, 'won');
  PERFORM pg_temp.dispute(1, 'evt_3645_h1_won2', 'dp_3645_h1', 2000, 'won');
  v_r := pg_temp.rel(v_release);
  IF v_r.net_release_cents <> 10000 OR v_r.disputed_cents <> 0
     OR v_r.error_message IS NOT NULL THEN
    RAISE EXCEPTION 'T5 won did not return the hold: %', row_to_json(v_r);
  END IF;
  IF (SELECT count(*) FROM public.stay_payout_release_holds
      WHERE release_id = v_release AND kind = 'dispute_won'
        AND disputed_cents = -2000) <> 1 THEN
    RAISE EXCEPTION 'T5 expected exactly one won row of -2000';
  END IF;
  IF public.issue_3645_stay_release_has_open_dispute(v_release) THEN
    RAISE EXCEPTION 'T5 dispute still open after won';
  END IF;
  IF pg_temp.item_json(1) IS DISTINCT FROM v_item_before THEN
    RAISE EXCEPTION 'T5 item row changed';
  END IF;
END
$t1$;

-- T6: lost keeps the hold and lets the rest pay out; a won with no opened
-- hold writes nothing.
DO $t6$
DECLARE
  v_release uuid := pg_temp.stay(2);
  v_claim uuid := gen_random_uuid();
BEGIN
  PERFORM pg_temp.dispute(2, 'evt_3645_h2_won_first', 'dp_3645_h2_orphan', 900, 'won');
  IF EXISTS (SELECT 1 FROM public.stay_payout_release_holds WHERE release_id = v_release)
     OR (pg_temp.rel(v_release)).net_release_cents <> 10000 THEN
    RAISE EXCEPTION 'T6 a won with no opened hold changed the release';
  END IF;

  PERFORM pg_temp.dispute(2, 'evt_3645_h2_open', 'dp_3645_h2', 1500, 'needs_response');
  PERFORM pg_temp.dispute(2, 'evt_3645_h2_lost', 'dp_3645_h2', 1500, 'lost');
  IF (pg_temp.rel(v_release)).net_release_cents <> 8500
     OR (pg_temp.rel(v_release)).error_message IS NOT NULL
     OR public.issue_3645_stay_release_has_open_dispute(v_release) THEN
    RAISE EXCEPTION 'T6 lost must keep the hold and unblock: %', row_to_json(pg_temp.rel(v_release));
  END IF;
  -- A later won after lost writes nothing either.
  PERFORM pg_temp.dispute(2, 'evt_3645_h2_won_late', 'dp_3645_h2', 1500, 'won');
  IF (pg_temp.rel(v_release)).net_release_cents <> 8500 THEN
    RAISE EXCEPTION 'T6 won after lost released the hold';
  END IF;
  UPDATE public.brand_payout_releases
  SET status = 'in_flight', stripe_execution_claim_id = v_claim,
      stripe_execution_claimed_at = now()
  WHERE id = v_release;
  IF NOT public.authorize_stripe_payout_execution(v_release, v_claim, 8500) THEN
    RAISE EXCEPTION 'T6 a closed dispute must not block payout: %', row_to_json(pg_temp.rel(v_release));
  END IF;
END
$t6$;

-- T7: a dispute held before payout is not charged again after payout; a
-- dispute on a release paid with no hold still takes the existing path.
DO $t7$
DECLARE
  v_held uuid := pg_temp.stay(3);
  v_bare uuid := pg_temp.stay(4);
BEGIN
  PERFORM pg_temp.dispute(3, 'evt_3645_h3_open', 'dp_3645_h3', 1000, 'needs_response');
  PERFORM pg_temp.dispute(3, 'evt_3645_h3_lost', 'dp_3645_h3', 1000, 'lost');

  SET LOCAL session_replication_role = replica;
  UPDATE public.brand_payout_releases
  SET status = 'released', organiser_cash_delivered_cents = net_release_cents
  WHERE id IN (v_held, v_bare);
  SET LOCAL session_replication_role = origin;

  PERFORM pg_temp.dispute(3, 'evt_3645_h3_after', 'dp_3645_h3', 1000, 'needs_response');
  IF EXISTS (SELECT 1 FROM public.payout_ledger_adjustments WHERE release_id = v_held)
     OR EXISTS (SELECT 1 FROM public.organiser_payout_debts WHERE origin_release_id = v_held) THEN
    RAISE EXCEPTION 'T7 held dispute charged again after payout';
  END IF;

  PERFORM pg_temp.dispute(4, 'evt_3645_h4_after', 'dp_3645_h4', 700, 'needs_response');
  IF NOT EXISTS (
    SELECT 1 FROM public.payout_ledger_adjustments
    WHERE release_id = v_bare AND kind = 'post_release_dispute' AND amount_cents = 700
  ) THEN
    RAISE EXCEPTION 'T7 unheld dispute after payout must still open the adjustment';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stay_payout_release_holds WHERE release_id = v_bare) THEN
    RAISE EXCEPTION 'T7 a released release must not take a hold';
  END IF;
END
$t7$;

-- T8: a stay refund processed while the payout is unpaid. The old trigger
-- raised payout_ledger_append_only and rolled the refund update back.
CREATE FUNCTION pg_temp.refund(
  p_n integer, p_amount integer, p_organizer integer
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_group uuid := ('36450a00-0000-4000-8001-' || lpad(p_n::text, 12, '0'))::uuid;
  v_attempt uuid := ('36450a00-0000-4000-8003-' || lpad(p_n::text, 12, '0'))::uuid;
  v_alloc uuid := ('36450a00-0000-4000-8004-' || lpad(p_n::text, 12, '0'))::uuid;
  v_refund uuid := gen_random_uuid();
  v_source uuid := gen_random_uuid();
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.stay_payment_allocations(
    id, payment_attempt_id, reservation_line_id, component, component_ref,
    charged_minor, refund_treatment
  ) VALUES (
    v_alloc, v_attempt, pg_temp.line(p_n), 'base', 'room', 10450, 'refundable'
  ) ON CONFLICT DO NOTHING;
  INSERT INTO public.source_refunds(
    id, source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
    requested_by_type, reason, provider, currency, original_charge_cents,
    buyer_refund_requested_cents, buyer_state, original_application_fee_cents,
    fee_reversal_required_cents, fee_state, fee_leg_kind, financial_state,
    organizer_refund_liability_cents, platform_fee_absorption_cents,
    provider_payment_reference, idempotency_key
  ) VALUES (
    v_source, 'stay_reservation', v_group, v_group, pg_temp.fx('brand'),
    pg_temp.fx('venue'), 'stay_cancellation', 'guest', 'issue 3645 hold refund', 'stripe', 'USD',
    10450, p_amount, 'provider_pending', 450, p_amount - p_organizer,
    CASE WHEN p_amount = p_organizer THEN 'not_required' ELSE 'provider_pending' END,
    CASE WHEN p_amount = p_organizer THEN 'not_required'
      ELSE 'stripe_application_fee_refund' END,
    'pending', p_organizer, p_amount - p_organizer,
    'pi_3645_hold_' || p_n, 'issue-3645-hold-refund-' || v_source
  );
  INSERT INTO public.stay_refunds(
    id, group_id, payment_attempt_id, cancel_preview_id, requested_by_type,
    reason, state, amount_minor, application_fee_reversal_minor,
    currency_code, provider, source_refund_id, idempotency_key
  ) VALUES (
    v_refund, v_group, v_attempt, gen_random_uuid(), 'guest',
    'issue 3645 hold refund', 'submitted', p_amount, p_amount - p_organizer,
    'USD', 'stripe', v_source, 'issue-3645-hold-refund-' || v_refund
  );
  INSERT INTO public.stay_refund_allocations(
    refund_id, payment_allocation_id, reservation_line_id, amount_minor,
    organizer_liability_minor, platform_fee_reversal_minor, state
  ) VALUES (
    v_refund, v_alloc, pg_temp.line(p_n), p_amount, p_organizer,
    p_amount - p_organizer, 'submitted'
  );
  SET LOCAL session_replication_role = origin;
  RETURN v_source;
END
$$;

DO $t8$
DECLARE
  v_release uuid := pg_temp.stay(5);
  v_item_before text := pg_temp.item_json(5);
  v_source uuid;
  v_r public.brand_payout_releases;
BEGIN
  -- 5225 refunded: 5000 is the host's share, 225 is Mingla's returned fee.
  v_source := pg_temp.refund(5, 5225, 5000);
  UPDATE public.source_refunds
  SET buyer_state = 'processed', buyer_refund_processed_cents = 5225
  WHERE id = v_source;

  IF pg_temp.item_json(5) IS DISTINCT FROM v_item_before THEN
    RAISE EXCEPTION 'T8 item row changed';
  END IF;
  v_r := pg_temp.rel(v_release);
  -- T7's unheld post-payout dispute opened a 700 debt for this brand, which
  -- this release recovered at attach. The refund hold and the recovered debt
  -- both stay deducted: 10000 − 5000 (host share) − 700.
  IF v_r.permanent_debt_withheld_cents <> 700 THEN
    RAISE EXCEPTION 'T8 fixture: expected the 700 debt recovered here: %', row_to_json(v_r);
  END IF;
  IF v_r.refunded_cents <> 5225 OR v_r.net_release_cents <> 4300 THEN
    RAISE EXCEPTION 'T8 refund projection wrong (host bears only its share): %', row_to_json(v_r);
  END IF;
  -- buyer_state 'processed' alone leaves stay_refunds.state as it was (it
  -- turns 'succeeded' only once financial_state is reconciled).
  IF (SELECT state FROM public.stay_refunds WHERE source_refund_id = v_source) <> 'submitted'
     OR (SELECT allocation.state FROM public.stay_refund_allocations allocation
         JOIN public.stay_refunds refund ON refund.id = allocation.refund_id
         WHERE refund.source_refund_id = v_source) <> 'succeeded'
     OR (SELECT refunded_minor FROM public.stay_payment_allocations
         WHERE reservation_line_id = pg_temp.line(5)) <> 5225 THEN
    RAISE EXCEPTION 'T8 the refund itself was not recorded';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stay_money_ledger
    WHERE line_id = pg_temp.line(5) AND entry_type = 'refund_succeeded'
      AND amount_minor = 5225
  ) THEN
    RAISE EXCEPTION 'T8 refund_succeeded ledger row missing';
  END IF;

  -- Re-updating a processed refund changes nothing.
  UPDATE public.source_refunds SET buyer_state = 'processed' WHERE id = v_source;
  IF (SELECT count(*) FROM public.stay_payout_release_holds WHERE release_id = v_release) <> 1
     OR (pg_temp.rel(v_release)).net_release_cents <> 4300 THEN
    RAISE EXCEPTION 'T8 a repeat update double counted';
  END IF;

  -- The planner keeps the refund hold too.
  PERFORM public.plan_pending_payout_partner_legs(500);
  IF (pg_temp.rel(v_release)).net_release_cents <> 4300
     OR (pg_temp.rel(v_release)).refunded_cents <> 5225 THEN
    RAISE EXCEPTION 'T8 planner dropped the refund hold: %', row_to_json(pg_temp.rel(v_release));
  END IF;
END
$t8$;

-- T9: refund plus dispute larger than the net clamps at 0, never negative.
DO $t9$
DECLARE
  v_release uuid := pg_temp.stay(6);
  v_source uuid;
BEGIN
  v_source := pg_temp.refund(6, 6000, 6000);
  UPDATE public.source_refunds
  SET buyer_state = 'processed', buyer_refund_processed_cents = 6000
  WHERE id = v_source;
  PERFORM pg_temp.dispute(6, 'evt_3645_h6_open', 'dp_3645_h6', 6000, 'needs_response');
  IF (pg_temp.rel(v_release)).net_release_cents <> 0 THEN
    RAISE EXCEPTION 'T9 net must clamp at 0: %', row_to_json(pg_temp.rel(v_release));
  END IF;
  PERFORM public.plan_pending_payout_partner_legs(500);
  IF (pg_temp.rel(v_release)).net_release_cents <> 0 THEN
    RAISE EXCEPTION 'T9 planner clamp wrong';
  END IF;
END
$t9$;

-- T10: a Paystack dispute on a release that already recovered a debt keeps
-- the debt deducted (the old projection paid it out again).
DO $t10$
DECLARE
  v_brand constant uuid := '36450a00-0000-4000-8000-000000000102';
  v_event constant uuid := '36450a00-0000-4000-8000-000000000103';
  v_order constant uuid := '36450a00-0000-4000-8000-000000000104';
  v_release constant uuid := '36450a00-0000-4000-8000-000000000105';
  v_origin constant uuid := '36450a00-0000-4000-8000-000000000106';
  v_now constant timestamptz := timestamptz '2026-10-22 16:00:00+00';
  v_r public.brand_payout_releases;
BEGIN
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency
  ) VALUES (
    v_brand, pg_temp.fx('owner'), 'Issue 3645 Debt Keep', 'issue-3645-debt-keep',
    'paystack', 'NG', 'NGN', 'NGN'
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'Debt Keep Event', 'issue-3645-debt-keep-event', 'live', 'NGN');
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, source
  ) VALUES (
    v_order, v_event, 10000, 'NGN', 'paid', 'psk_3645_debt_keep', 'legacy'
  );
  INSERT INTO public.brand_payout_releases(
    id, brand_id, event_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_release_cents, status
  ) VALUES
    (v_release, v_brand, v_event, 'debt-keep', 'order', 'paystack', 'ngn',
     v_now - interval '26 hours', v_now - interval '2 hours',
     10000, 450, 0, 300, 9550, 'pending'),
    (v_origin, v_brand, v_event, 'debt-keep-origin', 'order', 'paystack', 'ngn',
     v_now - interval '60 days', v_now - interval '59 days',
     0, 0, 0, 0, 0, 'pending');
  INSERT INTO public.payout_release_items(
    release_id, source_type, source_id, gross_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_cents, source_finalized_at
  ) VALUES (
    v_release, 'order', v_order, 10000, 450, 0, 300, 9550, v_now - interval '26 hours'
  );
  INSERT INTO public.organiser_payout_debts(
    brand_id, currency, origin_release_id, kind, principal_cents, idempotency_key
  ) VALUES (v_brand, 'ngn', v_origin, 'post_release_refund', 1000, 'issue-3645-debt-keep');

  PERFORM public.apply_open_payout_debts(v_release, v_now);
  IF (pg_temp.rel(v_release)).net_release_cents <> 8550 THEN
    RAISE EXCEPTION 'T10 fixture: debt not applied: %', row_to_json(pg_temp.rel(v_release));
  END IF;

  PERFORM public.record_paystack_dispute_outcome(
    'dsp_3645_debt_keep', 'psk_3645_debt_keep', 'charge.dispute.create',
    'pending', NULL, 2000, 'ngn', 'chargeback', NULL, '{}'::jsonb, v_now
  );
  v_r := pg_temp.rel(v_release);
  IF v_r.net_release_cents <> 6550 OR v_r.disputed_cents <> 2000 THEN
    RAISE EXCEPTION 'T10 projection paid the recovered debt again: %', row_to_json(v_r);
  END IF;
  PERFORM public.plan_pending_payout_partner_legs(500);
  IF (pg_temp.rel(v_release)).net_release_cents <> 6550 THEN
    RAISE EXCEPTION 'T10 planner dropped the Paystack hold: %', row_to_json(pg_temp.rel(v_release));
  END IF;
  PERFORM public.record_paystack_dispute_outcome(
    'dsp_3645_debt_keep', 'psk_3645_debt_keep', 'charge.dispute.resolve',
    'resolved', 'declined', 2000, 'ngn', 'chargeback', NULL, '{}'::jsonb,
    v_now + interval '1 hour'
  );
  v_r := pg_temp.rel(v_release);
  IF v_r.net_release_cents <> 8550 OR v_r.disputed_cents <> 0 THEN
    RAISE EXCEPTION 'T10 resolve must return the hold but keep the debt: %', row_to_json(v_r);
  END IF;
  IF (SELECT recovered_cents FROM public.organiser_payout_debts
      WHERE idempotency_key = 'issue-3645-debt-keep') <> 1000
     OR (SELECT count(*) FROM public.payout_debt_applications WHERE release_id = v_release) <> 1 THEN
    RAISE EXCEPTION 'T10 debt bookkeeping changed';
  END IF;
END
$t10$;

-- T11: the holds table is append-only, closed to app roles, and checked.
DO $t11$
DECLARE
  v_release uuid := (
    SELECT item.release_id FROM public.payout_release_items item
    WHERE item.source_id = pg_temp.line(1)
  );
BEGIN
  BEGIN
    UPDATE public.stay_payout_release_holds SET created_at = now()
    WHERE release_id = v_release;
    RAISE EXCEPTION 'T11 update allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%append%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.stay_payout_release_holds WHERE release_id = v_release;
    RAISE EXCEPTION 'T11 delete allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%append%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.stay_payout_release_holds(
      release_id, line_id, kind, refunded_cents, disputed_cents,
      net_hold_cents, provider_ref, idempotency_key
    ) VALUES (v_release, pg_temp.line(1), 'refund', 100, 0, 101, 'bad', 'issue-3645-bad-refund');
    RAISE EXCEPTION 'T11 refund hold above its refund allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.stay_payout_release_holds(
      release_id, line_id, kind, refunded_cents, disputed_cents,
      net_hold_cents, provider_ref, idempotency_key
    ) VALUES (v_release, pg_temp.line(1), 'dispute_opened', 0, -5, -5, 'bad', 'issue-3645-bad-open');
    RAISE EXCEPTION 'T11 negative opened hold allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF has_table_privilege('anon', 'public.stay_payout_release_holds', 'SELECT')
     OR has_table_privilege('authenticated', 'public.stay_payout_release_holds', 'SELECT')
     OR has_table_privilege('authenticated', 'public.stay_payout_release_holds', 'INSERT')
     OR has_table_privilege('service_role', 'public.stay_payout_release_holds', 'INSERT')
     OR has_table_privilege('service_role', 'public.stay_payout_release_holds', 'UPDATE')
     OR has_table_privilege('service_role', 'public.stay_payout_release_holds', 'DELETE')
     OR NOT (SELECT relrowsecurity FROM pg_class
             WHERE oid = 'public.stay_payout_release_holds'::regclass) THEN
    RAISE EXCEPTION 'T11 holds table grants or RLS wrong';
  END IF;
  IF has_function_privilege('anon', 'public.issue_3645_release_projected_totals(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3645_release_projected_totals(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3645_refresh_stay_release_projection(uuid,timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3645_stay_release_has_open_dispute(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T11 app roles can run the projection functions';
  END IF;
END
$t11$;

-- T12: the stay projection refuses what it does not own.
DO $t12$
BEGIN
  BEGIN
    PERFORM public.issue_3645_refresh_stay_release_projection(gen_random_uuid());
    RAISE EXCEPTION 'T12 unknown release accepted';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_3645_refresh_stay_release_projection(
      '36450a00-0000-4000-8000-000000000105'
    );
    RAISE EXCEPTION 'T12 a Paystack event release accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'stay_release_required' THEN RAISE; END IF;
  END;
END
$t12$;

-- T13: an event arriving while the payout is being sent fails retryably and
-- changes nothing; once the payout is recorded the redelivered event takes
-- the post-payout path (no hold, no lost payout record).
DO $t13$
DECLARE
  v_release uuid := pg_temp.stay(8);
  v_claim uuid := gen_random_uuid();
  v_source uuid;
BEGIN
  UPDATE public.brand_payout_releases
  SET status = 'in_flight', stripe_execution_claim_id = v_claim,
      stripe_execution_claimed_at = now()
  WHERE id = v_release;
  IF NOT public.authorize_stripe_payout_execution(v_release, v_claim, 10000) THEN
    RAISE EXCEPTION 'T13 fixture: authorize refused';
  END IF;
  BEGIN
    PERFORM pg_temp.dispute(8, 'evt_3645_h8_open', 'dp_3645_h8', 2000, 'needs_response');
    RAISE EXCEPTION 'T13 dispute accepted while the payout is in flight';
  EXCEPTION WHEN SQLSTATE '55P03' THEN NULL;
  END;
  v_source := pg_temp.refund(8, 3000, 3000);
  BEGIN
    UPDATE public.source_refunds
    SET buyer_state = 'processed', buyer_refund_processed_cents = 3000
    WHERE id = v_source;
    RAISE EXCEPTION 'T13 refund accepted while the payout is in flight';
  EXCEPTION WHEN SQLSTATE '55P03' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.stay_payout_release_holds WHERE release_id = v_release)
     OR (pg_temp.rel(v_release)).status <> 'in_flight'
     OR (pg_temp.rel(v_release)).stripe_execution_claim_id IS DISTINCT FROM v_claim
     OR (pg_temp.rel(v_release)).net_release_cents <> 10000 THEN
    RAISE EXCEPTION 'T13 an in-flight release moved: %', row_to_json(pg_temp.rel(v_release));
  END IF;

  PERFORM public.record_stripe_payout_execution(
    v_release, v_claim, 'accepted', 'po_3645_h8', 10000, NULL, now()
  );
  IF (pg_temp.rel(v_release)).status <> 'released' THEN
    RAISE EXCEPTION 'T13 payout not recorded: %', row_to_json(pg_temp.rel(v_release));
  END IF;
  PERFORM pg_temp.dispute(8, 'evt_3645_h8_open', 'dp_3645_h8', 2000, 'needs_response');
  IF NOT EXISTS (
    SELECT 1 FROM public.payout_ledger_adjustments
    WHERE release_id = v_release AND kind = 'post_release_dispute' AND amount_cents = 2000
  ) THEN
    RAISE EXCEPTION 'T13 redelivered dispute must take the post-payout path';
  END IF;
END
$t13$;

-- T14: Stripe does not guarantee order. A won delivered before an older
-- needs_response leaves nothing open; 'prevented' resolves like won.
DO $t14$
DECLARE
  v_late uuid := pg_temp.stay(9);
  v_prevented uuid := pg_temp.stay(10);
  -- Each release's own starting net: earlier cases left brand debt that
  -- these releases recovered at attach.
  v_late_net integer := (pg_temp.rel(v_late)).net_release_cents;
  v_prevented_net integer := (pg_temp.rel(v_prevented)).net_release_cents;
BEGIN
  PERFORM pg_temp.dispute(9, 'evt_3645_h9_won', 'dp_3645_h9', 1200, 'won');
  PERFORM pg_temp.dispute(9, 'evt_3645_h9_old', 'dp_3645_h9', 1200, 'needs_response');
  IF public.issue_3645_stay_release_has_open_dispute(v_late)
     OR (pg_temp.rel(v_late)).net_release_cents <> v_late_net THEN
    RAISE EXCEPTION 'T14 an out-of-order event reopened a won dispute: %', row_to_json(pg_temp.rel(v_late));
  END IF;

  PERFORM pg_temp.dispute(10, 'evt_3645_h10_open', 'dp_3645_h10', 800, 'needs_response');
  PERFORM pg_temp.dispute(10, 'evt_3645_h10_prev', 'dp_3645_h10', 800, 'prevented');
  IF public.issue_3645_stay_release_has_open_dispute(v_prevented)
     OR (pg_temp.rel(v_prevented)).net_release_cents <> v_prevented_net THEN
    RAISE EXCEPTION 'T14 prevented must return the hold: %', row_to_json(pg_temp.rel(v_prevented));
  END IF;
END
$t14$;

-- T15: the maturity recredit is paid on top of net by the claims, so no
-- projection folds it into net (the old planner did, paying it twice).
DO $t15$
DECLARE
  v_release uuid := pg_temp.stay(11);
  v_before integer;
BEGIN
  v_before := (pg_temp.rel(v_release)).net_release_cents;
  UPDATE public.brand_payout_releases SET maturity_recredit_cents = 500
  WHERE id = v_release;
  PERFORM pg_temp.dispute(11, 'evt_3645_h11_open', 'dp_3645_h11', 2000, 'needs_response');
  IF (pg_temp.rel(v_release)).net_release_cents <> v_before - 2000 THEN
    RAISE EXCEPTION 'T15 stay projection folded the recredit into net: %', row_to_json(pg_temp.rel(v_release));
  END IF;
  PERFORM public.plan_pending_payout_partner_legs(500);
  IF (pg_temp.rel(v_release)).net_release_cents <> v_before - 2000 THEN
    RAISE EXCEPTION 'T15 planner folded the recredit into net: %', row_to_json(pg_temp.rel(v_release));
  END IF;

  UPDATE public.brand_payout_releases SET maturity_recredit_cents = 500
  WHERE id = '36450a00-0000-4000-8000-000000000105';
  PERFORM public.refresh_paystack_dispute_release_projection(
    '36450a00-0000-4000-8000-000000000105'
  );
  IF (pg_temp.rel('36450a00-0000-4000-8000-000000000105')).net_release_cents <> 8550 THEN
    RAISE EXCEPTION 'T15 Paystack projection folded the recredit into net: %',
      row_to_json(pg_temp.rel('36450a00-0000-4000-8000-000000000105'));
  END IF;
END
$t15$;

-- T16: a release held by an open dispute does not take a claim slot; the
-- same brand's clean release is claimed.
DO $t16$
DECLARE
  v_held uuid := pg_temp.stay(12);
  v_clean uuid := pg_temp.stay(13);
BEGIN
  INSERT INTO public.stripe_connect_accounts(
    brand_id, stripe_account_id, country, default_currency, payouts_enabled,
    charges_enabled
  ) VALUES (pg_temp.fx('brand'), 'acct_3645_holds', 'US', 'USD', true, true)
  ON CONFLICT DO NOTHING;
  UPDATE public.stripe_connect_accounts SET payouts_enabled = true, detached_at = NULL
  WHERE brand_id = pg_temp.fx('brand');
  PERFORM pg_temp.dispute(12, 'evt_3645_h12_open', 'dp_3645_h12', 500, 'needs_response');
  PERFORM public.claim_stripe_payout_releases(100, now());
  IF (pg_temp.rel(v_held)).status <> 'pending'
     OR (pg_temp.rel(v_held)).stripe_execution_claim_id IS NOT NULL THEN
    RAISE EXCEPTION 'T16 a disputed release was claimed: %', row_to_json(pg_temp.rel(v_held));
  END IF;
  IF (pg_temp.rel(v_clean)).status <> 'in_flight' THEN
    RAISE EXCEPTION 'T16 the clean release was not claimed: %', row_to_json(pg_temp.rel(v_clean));
  END IF;
END
$t16$;

-- T17: a release with transfer legs under way is not moved either.
DO $t17$
DECLARE
  v_release uuid := pg_temp.stay(14);
  v_source uuid;
BEGIN
  INSERT INTO public.payout_transfer_legs(
    release_id, kind, chunk_index, principal_cents, fee_schedule_version
  ) VALUES (v_release, 'organiser', 0, 10000, 'issue-3645-test');
  v_source := pg_temp.refund(14, 2000, 2000);
  BEGIN
    UPDATE public.source_refunds
    SET buyer_state = 'processed', buyer_refund_processed_cents = 2000
    WHERE id = v_source;
    RAISE EXCEPTION 'T17 refund accepted while legs are planned';
  EXCEPTION WHEN SQLSTATE '55P03' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.stay_payout_release_holds WHERE release_id = v_release) THEN
    RAISE EXCEPTION 'T17 a hold was written behind planned legs';
  END IF;
END
$t17$;

DO $done$ BEGIN RAISE NOTICE 'issue_3645_unpaid_release_holds_pass'; END $done$;

ROLLBACK;
