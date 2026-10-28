-- Issue #3645 — Paystack instalment attempts (PG17, BEGIN…ROLLBACK).
-- MINGLA-INVARIANT: I-3645-PS-1 | issue #3645 | at most one unresolved provider attempt per instalment
-- MINGLA-INVARIANT: I-3645-PS-5 | issue #3645 | a later verified success on a non-open instalment resolves refund_due
-- MINGLA-INVARIANT: I-3645-BOTH-2 | issue #3645 | retry dates anchored to due_at (+3d, +7d, at risk on the third)
--
-- Proves begin (claim + mint) refusals, the one-open-attempt guard, every
-- resolve transition (collect, amount mismatch, refund_due, failed ladder with
-- anchored retry dates, paused/approval, unknown, uncounted failure), the
-- at-risk clear, the pay-link checkpoint, the downgrade and the SQL mirror of
-- the retry table (same cases as installmentRetrySchedule.ts).

BEGIN;

CREATE FUNCTION pg_temp.i3645_plan(p_seed text, p_method text, p_with_auth boolean)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_i1 uuid := gen_random_uuid();
  v_i2 uuid := gen_random_uuid();
  v_i3 uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'att-' || p_seed || '@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, default_currency, pricing_currency)
  VALUES (v_brand, v_owner, 'Att ' || p_seed, 'issue-3645-att-' || p_seed, 'paystack', 'NGN', 'NGN');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_event, v_brand, 'Att trip ' || p_seed, 'issue-3645-att-trip-' || p_seed, 'trip', 'scheduled', 'public', 'UTC', 'NGN');
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status, buyer_email,
    stripe_payment_intent_id, stripe_charge_id, source, installment_plan_root)
  VALUES (v_order, v_event, 250000, 'NGN', 'paid', 'buyer@example.test', 'mingla_att_' || p_seed, '5001', 'legacy', true);
  INSERT INTO public.order_installments(id, order_id, ordinal, amount_cents, currency, due_at, provider,
    collection_method, buyer_total_cents, planned_application_fee_cents, plan_bound_at)
  VALUES
    (v_i1, v_order, 1, 250000, 'NGN', timestamptz '2027-03-01 12:00:00+00', 'paystack', p_method, 270625, 11250, now()),
    (v_i2, v_order, 2, 250000, 'NGN', timestamptz '2027-04-01 12:00:00+00', 'paystack', p_method, 270625, 11250, now()),
    (v_i3, v_order, 3, 250000, 'NGN', timestamptz '2027-05-01 12:00:00+00', 'paystack', p_method, 270625, 11250, now());
  IF p_with_auth THEN
    INSERT INTO private.order_payment_authorizations(order_id, provider, authorization_code, authorization_email,
      reusable, channel, last4, source_reference)
    VALUES (v_order, 'paystack', 'AUTH_att' || p_seed, 'original@example.test', true, 'card', '4081', 'mingla_att_' || p_seed);
  END IF;
  RETURN jsonb_build_object('event', v_event, 'order', v_order, 'i1', v_i1, 'i2', v_i2, 'i3', v_i3);
END $f$;

CREATE FUNCTION pg_temp.must(p_ok boolean, p_label text, p_detail jsonb DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION '% %', p_label, coalesce(p_detail::text, ''); END IF;
END $f$;

-- ---------------------------------------------------------------------------
-- A. Retry table (SQL mirror of installmentRetrySchedule.ts).
-- ---------------------------------------------------------------------------
DO $retry$
DECLARE
  v_due timestamptz := timestamptz '2027-03-01 12:00:00+00';
BEGIN
  PERFORM pg_temp.must(public.issue_3645_next_retry_at(v_due, 1, timestamptz '2027-03-01 13:00:00+00')
    = timestamptz '2027-03-04 12:00:00+00', 'retry_1_due_plus_3d');
  PERFORM pg_temp.must(public.issue_3645_next_retry_at(v_due, 2, timestamptz '2027-03-04 13:00:00+00')
    = timestamptz '2027-03-08 12:00:00+00', 'retry_2_due_plus_7d');
  PERFORM pg_temp.must(public.issue_3645_next_retry_at(v_due, 3, timestamptz '2027-03-08 13:00:00+00') IS NULL,
    'retry_3_at_risk_null');
  PERFORM pg_temp.must(public.issue_3645_next_retry_at(v_due, 1, timestamptz '2027-03-05 00:00:00+00')
    = timestamptz '2027-03-05 06:00:00+00', 'retry_late_first_attempt_now_plus_6h');
  PERFORM pg_temp.must(public.issue_3645_next_retry_at(v_due, 2, timestamptz '2027-03-08 12:00:00+00')
    = timestamptz '2027-03-08 18:00:00+00', 'retry_exactly_due_counts_as_past');
  PERFORM pg_temp.must(public.issue_3645_next_retry_at(v_due, 0, timestamptz '2027-03-01 13:00:00+00') IS NULL,
    'retry_0_null');
END
$retry$;

-- ---------------------------------------------------------------------------
-- B. Auto-card ladder: begin refusals, failures 1-3, at risk, override,
--    success clears at risk.
-- ---------------------------------------------------------------------------
DO $ladder$
DECLARE
  f jsonb := pg_temp.i3645_plan('ladder', 'auto_card', true);
  v_i1 uuid := (f->>'i1')::uuid;
  v_order uuid := (f->>'order')::uuid;
  r jsonb;
  r2 jsonb;
  v_inst public.order_installments;
BEGIN
  -- Fee bounds.
  r := public.issue_3645_begin_installment_attempt(v_i1, 'auto_card', -1);
  PERFORM pg_temp.must(r->>'reason' = 'application_fee_invalid', 'begin_fee_negative', r);
  r := public.issue_3645_begin_installment_attempt(v_i1, 'auto_card', 270626);
  PERFORM pg_temp.must(r->>'reason' = 'application_fee_invalid', 'begin_fee_above_total', r);

  -- Attempt 1: reference shape and amount = locked all-in price.
  r := public.issue_3645_begin_installment_attempt(v_i1, 'auto_card', 11250, false, timestamptz '2027-03-01 12:05:00+00');
  PERFORM pg_temp.must((r->>'ok')::boolean AND r->>'reference' = 'mingla-inst-' || v_i1 || '-a1'
    AND (r->>'amount_cents')::bigint = 270625 AND (r->>'attempt_no')::int = 1, 'begin_1', r);
  -- One open attempt: a concurrent begin (pay link or auto) is refused.
  r2 := public.issue_3645_begin_installment_attempt(v_i1, 'pay_link', 11250);
  PERFORM pg_temp.must(r2->>'reason' = 'attempt_in_flight', 'begin_while_created_refused', r2);

  -- Decline 1 → failed, retry 1 at due + 3d.
  r2 := public.issue_3645_resolve_installment_attempt((r->>'attempt_id')::uuid, 'failed', '9001',
    'Declined', NULL, NULL, NULL, true, timestamptz '2027-03-01 12:06:00+00');
  PERFORM pg_temp.must(r2->>'outcome' = 'failed' AND (r2->>'retry_count')::int = 1, 'fail_1', r2);
  SELECT * INTO v_inst FROM public.order_installments WHERE id = v_i1;
  PERFORM pg_temp.must(v_inst.status = 'failed' AND v_inst.next_retry_at = timestamptz '2027-03-04 12:00:00+00'
    AND v_inst.failure_reason = 'card_declined:Declined' AND v_inst.in_flight_attempt_id IS NULL, 'fail_1_row');

  -- A failed row is charged again only after the cron flips it back (auto_card).
  UPDATE public.order_installments SET status = 'scheduled' WHERE id = v_i1;
  r := public.issue_3645_begin_installment_attempt(v_i1, 'auto_card', 11250, false, timestamptz '2027-03-04 12:05:00+00');
  PERFORM pg_temp.must(r->>'reference' = 'mingla-inst-' || v_i1 || '-a2', 'begin_2', r);
  r2 := public.issue_3645_resolve_installment_attempt((r->>'attempt_id')::uuid, 'failed', NULL,
    'Insufficient funds', NULL, NULL, NULL, true, timestamptz '2027-03-04 12:06:00+00');
  SELECT * INTO v_inst FROM public.order_installments WHERE id = v_i1;
  PERFORM pg_temp.must(v_inst.retry_count = 2 AND v_inst.next_retry_at = timestamptz '2027-03-08 12:00:00+00',
    'fail_2_due_plus_7d', to_jsonb(v_inst));

  UPDATE public.order_installments SET status = 'scheduled' WHERE id = v_i1;
  r := public.issue_3645_begin_installment_attempt(v_i1, 'auto_card', 11250, false, timestamptz '2027-03-08 12:05:00+00');
  r2 := public.issue_3645_resolve_installment_attempt((r->>'attempt_id')::uuid, 'failed', NULL,
    'Declined', NULL, NULL, NULL, true, timestamptz '2027-03-08 12:06:00+00');
  PERFORM pg_temp.must(r2->>'outcome' = 'at_risk' AND (r2->>'retry_count')::int = 3, 'fail_3_at_risk', r2);
  PERFORM pg_temp.must((SELECT at_risk FROM public.orders WHERE id = v_order), 'order_flagged_at_risk');
  PERFORM pg_temp.must((SELECT next_retry_at IS NULL FROM public.order_installments WHERE id = v_i1), 'no_retry_after_3');

  -- At risk: automatic charge refused unless the host overrides.
  UPDATE public.order_installments SET status = 'scheduled' WHERE id = v_i1;
  r := public.issue_3645_begin_installment_attempt(v_i1, 'auto_card', 11250);
  PERFORM pg_temp.must(r->>'reason' = 'order_at_risk', 'at_risk_refused', r);
  r := public.issue_3645_begin_installment_attempt(v_i1, 'auto_card', 11250, true, timestamptz '2027-03-09 10:00:00+00');
  PERFORM pg_temp.must((r->>'ok')::boolean, 'override_allowed', r);

  -- Amount mismatch: nothing collected, in-flight cleared, not counted.
  r2 := public.issue_3645_resolve_installment_attempt((r->>'attempt_id')::uuid, 'succeeded', '9100',
    'Approved', NULL, 4000, 270000, true, timestamptz '2027-03-09 10:01:00+00');
  PERFORM pg_temp.must(r2->>'reason' = 'amount_mismatch' AND NOT (r2->>'ok')::boolean, 'amount_mismatch', r2);
  SELECT * INTO v_inst FROM public.order_installments WHERE id = v_i1;
  PERFORM pg_temp.must(v_inst.status = 'scheduled' AND v_inst.in_flight_attempt_id IS NULL AND v_inst.retry_count = 3,
    'amount_mismatch_row', to_jsonb(v_inst));

  -- Success: collected with the attempt's reference, fees recorded, at risk clears.
  r := public.issue_3645_begin_installment_attempt(v_i1, 'auto_card', 11250, true, timestamptz '2027-03-09 11:00:00+00');
  r2 := public.issue_3645_resolve_installment_attempt((r->>'attempt_id')::uuid, 'succeeded', '9200',
    'Approved', NULL, 4060, 270625, true, timestamptz '2027-03-09 11:01:00+00');
  PERFORM pg_temp.must(r2->>'outcome' = 'collected' AND (r2->>'remaining')::int = 2, 'collect', r2);
  SELECT * INTO v_inst FROM public.order_installments WHERE id = v_i1;
  PERFORM pg_temp.must(v_inst.status = 'collected' AND v_inst.stripe_payment_intent_id = r->>'reference'
    AND v_inst.provider_transaction_id = '9200' AND v_inst.application_fee_amount_cents = 11250
    AND v_inst.provider_fee_cents = 4060 AND v_inst.payout_accounting_state = 'ready'
    AND v_inst.failed_at IS NULL AND v_inst.next_retry_at IS NULL AND v_inst.buyer_action = 'none',
    'collect_row', to_jsonb(v_inst));
  PERFORM pg_temp.must(NOT (SELECT at_risk FROM public.orders WHERE id = v_order), 'at_risk_cleared');

  -- Replay of the same success.
  r2 := public.issue_3645_resolve_installment_attempt((r->>'attempt_id')::uuid, 'succeeded', '9200',
    'Approved', NULL, 4060, 270625);
  PERFORM pg_temp.must(r2->>'outcome' = 'replayed', 'replay', r2);
END
$ladder$;

-- ---------------------------------------------------------------------------
-- C. Paused (bank approval), unknown, uncounted failure, late success
--    refund_due on collected / cancelled, downgrade.
-- ---------------------------------------------------------------------------
DO $paths$
DECLARE
  f jsonb := pg_temp.i3645_plan('paths', 'auto_card', true);
  v_i1 uuid := (f->>'i1')::uuid;
  v_i2 uuid := (f->>'i2')::uuid;
  v_i3 uuid := (f->>'i3')::uuid;
  r jsonb;
  r2 jsonb;
  v_paused uuid;
  v_unknown uuid;
  v_inst public.order_installments;
  v_count integer;
BEGIN
  -- Paused → approval_required, counts toward the ladder, link stored 24h.
  r := public.issue_3645_begin_installment_attempt(v_i1, 'auto_card', 11250, false, timestamptz '2027-03-01 12:00:00+00');
  v_paused := (r->>'attempt_id')::uuid;
  r2 := public.issue_3645_resolve_installment_attempt(v_paused, 'paused', NULL, 'send_otp',
    'https://checkout.paystack.com/approve-test', NULL, NULL, true, timestamptz '2027-03-01 12:01:00+00');
  PERFORM pg_temp.must(r2->>'outcome' = 'approval_required' AND (r2->>'retry_count')::int = 1, 'paused', r2);
  SELECT * INTO v_inst FROM public.order_installments WHERE id = v_i1;
  PERFORM pg_temp.must(v_inst.status = 'failed' AND v_inst.failure_reason = 'approval_required'
    AND v_inst.buyer_action = 'approval_required' AND v_inst.in_flight_attempt_id IS NULL, 'paused_row', to_jsonb(v_inst));
  PERFORM pg_temp.must((SELECT approval_url_expires_at = timestamptz '2027-03-02 12:01:00+00'
    FROM public.order_installment_charge_attempts WHERE id = v_paused), 'paused_link_24h');
  -- The audit row never carries the link.
  SELECT count(*) INTO v_count FROM public.audit_log
   WHERE target_id = v_i1::text AND after::text LIKE '%paystack.com%';
  PERFORM pg_temp.must(v_count = 0, 'audit_has_no_link');

  -- Starting the approve attempt supersedes the paused one.
  r := public.issue_3645_begin_installment_attempt(v_i1, 'approve', 11250, false, timestamptz '2027-03-01 13:00:00+00');
  PERFORM pg_temp.must(r->>'reference' = 'mingla-inst-' || v_i1 || '-p2', 'approve_reference', r);
  PERFORM pg_temp.must((SELECT state FROM public.order_installment_charge_attempts WHERE id = v_paused) = 'superseded',
    'paused_superseded');
  -- Buyer completes OTP → collected.
  r2 := public.issue_3645_resolve_installment_attempt((r->>'attempt_id')::uuid, 'succeeded', '9301', 'Approved',
    NULL, 4060, 270625, true, timestamptz '2027-03-01 13:05:00+00');
  PERFORM pg_temp.must(r2->>'outcome' = 'collected', 'approve_collected', r2);

  -- Unknown (timeout): row stays scheduled with the attempt in flight; nothing counted.
  r := public.issue_3645_begin_installment_attempt(v_i2, 'auto_card', 11250, false, timestamptz '2027-04-01 12:00:00+00');
  v_unknown := (r->>'attempt_id')::uuid;
  r2 := public.issue_3645_resolve_installment_attempt(v_unknown, 'unknown', NULL, 'timeout', NULL, NULL, NULL);
  SELECT * INTO v_inst FROM public.order_installments WHERE id = v_i2;
  PERFORM pg_temp.must(r2->>'outcome' = 'unknown' AND v_inst.status = 'scheduled'
    AND v_inst.in_flight_attempt_id = v_unknown AND v_inst.retry_count = 0, 'unknown_row', to_jsonb(v_inst));
  r2 := public.issue_3645_begin_installment_attempt(v_i2, 'auto_card', 11250);
  PERFORM pg_temp.must(r2->>'reason' = 'attempt_in_flight', 'begin_while_unknown_refused', r2);
  -- Verify said "not found" after 1h → failed without counting.
  r2 := public.issue_3645_resolve_installment_attempt(v_unknown, 'failed', NULL, 'not_created', NULL, NULL, NULL, false);
  SELECT * INTO v_inst FROM public.order_installments WHERE id = v_i2;
  PERFORM pg_temp.must(v_inst.status = 'scheduled' AND v_inst.retry_count = 0 AND v_inst.in_flight_attempt_id IS NULL,
    'uncounted_failure_row', to_jsonb(v_inst));
  -- A late failure on an already-resolved attempt is ignored.
  r2 := public.issue_3645_resolve_installment_attempt(v_unknown, 'failed', NULL, 'late', NULL, NULL, NULL);
  PERFORM pg_temp.must(r2->>'outcome' = 'ignored', 'late_failure_ignored', r2);

  -- Late success for the not-created attempt after the instalment collected another way → refund_due.
  r := public.issue_3645_begin_installment_attempt(v_i2, 'auto_card', 11250);
  PERFORM public.issue_3645_resolve_installment_attempt((r->>'attempt_id')::uuid, 'succeeded', '9401', 'Approved',
    NULL, 4060, 270625);
  r2 := public.issue_3645_resolve_installment_attempt(v_unknown, 'succeeded', '9402', 'Approved', NULL, 4060, 270625);
  PERFORM pg_temp.must(r2->>'outcome' = 'refund_due' AND r2->>'reason' = 'installment_collected', 'dup_refund_due', r2);
  PERFORM pg_temp.must((SELECT stripe_payment_intent_id FROM public.order_installments WHERE id = v_i2) = r->>'reference',
    'dup_does_not_overwrite_collecting_reference');
  -- Replay of a refund_due success stays refund_due (refund retried idempotently).
  r2 := public.issue_3645_resolve_installment_attempt(v_unknown, 'succeeded', '9402', 'Approved', NULL, 4060, 270625);
  PERFORM pg_temp.must(r2->>'outcome' = 'refund_due', 'dup_replay_refund_due', r2);

  -- Success on a cancelled instalment → refund_due.
  r := public.issue_3645_begin_installment_attempt(v_i3, 'auto_card', 11250);
  UPDATE public.order_installments SET status = 'cancelled', cancelled_at = now() WHERE id = v_i3;
  r2 := public.issue_3645_resolve_installment_attempt((r->>'attempt_id')::uuid, 'succeeded', '9501', 'Approved',
    NULL, 4060, 270625);
  PERFORM pg_temp.must(r2->>'outcome' = 'refund_due' AND r2->>'reason' = 'installment_cancelled', 'cancelled_refund_due', r2);
  PERFORM pg_temp.must((SELECT status FROM public.order_installments WHERE id = v_i3) = 'cancelled', 'cancelled_stays');
  -- And begin refuses a cancelled row.
  r2 := public.issue_3645_begin_installment_attempt(v_i3, 'pay_link', 0);
  PERFORM pg_temp.must(r2->>'reason' = 'installment_not_chargeable', 'begin_cancelled_refused', r2);
END
$paths$;

-- ---------------------------------------------------------------------------
-- D. Cancelled event / order refusals, pay-link checkpoint, downgrade.
-- ---------------------------------------------------------------------------
DO $links$
DECLARE
  f jsonb := pg_temp.i3645_plan('links', 'pay_link', false);
  g jsonb := pg_temp.i3645_plan('down', 'auto_card', true);
  h jsonb := pg_temp.i3645_plan('cancel', 'pay_link', false);
  v_i1 uuid := (f->>'i1')::uuid;
  r jsonb;
BEGIN
  -- pay_link rows refuse automatic charging.
  r := public.issue_3645_begin_installment_attempt(v_i1, 'auto_card', 0);
  PERFORM pg_temp.must(r->>'reason' = 'not_auto_card', 'pay_link_refuses_auto', r);
  -- Checkpoint before due: nothing counted.
  r := public.issue_3645_checkpoint_pay_link_installment(v_i1, timestamptz '2027-02-27 12:00:00+00');
  PERFORM pg_temp.must(r->>'reason' = 'checkpoint_not_reached', 'checkpoint_early', r);
  -- In flight (buyer on the payment page): refused.
  r := public.issue_3645_begin_installment_attempt(v_i1, 'pay_link', 0);
  PERFORM pg_temp.must((r->>'ok')::boolean AND r->>'reference' LIKE '%-l1', 'pay_link_begin', r);
  PERFORM pg_temp.must(public.issue_3645_checkpoint_pay_link_installment(v_i1, timestamptz '2027-03-01 13:00:00+00')->>'reason'
    = 'attempt_in_flight', 'checkpoint_in_flight');
  -- Buyer abandoned: superseded, nothing counted, in-flight cleared.
  PERFORM public.issue_3645_abandon_attempt((r->>'attempt_id')::uuid);
  PERFORM pg_temp.must((SELECT retry_count = 0 AND in_flight_attempt_id IS NULL FROM public.order_installments WHERE id = v_i1),
    'abandon_uncounted');
  -- Due reached: failure 1 (pay_link_unpaid); +3d: failure 2; +7d: at risk.
  r := public.issue_3645_checkpoint_pay_link_installment(v_i1, timestamptz '2027-03-01 13:00:00+00');
  PERFORM pg_temp.must(r->>'outcome' = 'failed' AND (r->>'retry_count')::int = 1, 'checkpoint_1', r);
  PERFORM pg_temp.must((SELECT failure_reason = 'pay_link_unpaid' AND next_retry_at = timestamptz '2027-03-04 12:00:00+00'
    FROM public.order_installments WHERE id = v_i1), 'checkpoint_1_row');
  PERFORM pg_temp.must(public.issue_3645_checkpoint_pay_link_installment(v_i1, timestamptz '2027-03-02 12:00:00+00')->>'reason'
    = 'checkpoint_not_reached', 'checkpoint_retry_not_reached');
  r := public.issue_3645_checkpoint_pay_link_installment(v_i1, timestamptz '2027-03-04 13:00:00+00');
  PERFORM pg_temp.must((r->>'retry_count')::int = 2, 'checkpoint_2', r);
  r := public.issue_3645_checkpoint_pay_link_installment(v_i1, timestamptz '2027-03-08 13:00:00+00');
  PERFORM pg_temp.must(r->>'outcome' = 'at_risk', 'checkpoint_3_at_risk', r);
  PERFORM pg_temp.must(public.issue_3645_checkpoint_pay_link_installment(v_i1, timestamptz '2027-03-20 13:00:00+00')->>'reason'
    = 'already_at_risk', 'checkpoint_after_at_risk');
  -- The link keeps working after at risk; paying collects and clears at risk.
  r := public.issue_3645_begin_installment_attempt(v_i1, 'pay_link', 0);
  PERFORM pg_temp.must((r->>'ok')::boolean, 'pay_link_after_at_risk', r);
  r := public.issue_3645_resolve_installment_attempt((r->>'attempt_id')::uuid, 'succeeded', '9601', 'Approved',
    NULL, 4060, 270625);
  PERFORM pg_temp.must(r->>'outcome' = 'collected', 'pay_link_collected', r);
  PERFORM pg_temp.must(NOT (SELECT at_risk FROM public.orders WHERE id = (f->>'order')::uuid), 'pay_link_clears_at_risk');

  -- Downgrade: the failing row and every later scheduled row move to pay links.
  UPDATE public.order_installments SET status = 'collected', collected_at = now(),
    stripe_payment_intent_id = 'mingla-inst-x-a1' WHERE id = (g->>'i1')::uuid;
  r := public.issue_3645_downgrade_to_pay_link((g->>'i2')::uuid, 'authorization_unusable');
  PERFORM pg_temp.must((r->>'downgraded_count')::int = 2, 'downgrade_count', r);
  PERFORM pg_temp.must((SELECT count(*) FROM public.order_installments WHERE order_id = (g->>'order')::uuid
    AND collection_method = 'pay_link') = 2, 'downgrade_rows');
  PERFORM pg_temp.must((SELECT deactivated_at IS NOT NULL FROM private.order_payment_authorizations
    WHERE order_id = (g->>'order')::uuid), 'downgrade_deactivates');
  PERFORM pg_temp.must((SELECT count(*) FROM public.issue_3645_installment_authorization_for_charge((g->>'i3')::uuid)) = 0,
    'downgrade_no_charge_authorization');

  -- Cancelled order / event refuse begin.
  UPDATE public.orders SET cancelled_at = now() WHERE id = (h->>'order')::uuid;
  PERFORM pg_temp.must(public.issue_3645_begin_installment_attempt((h->>'i1')::uuid, 'pay_link', 0)->>'reason'
    = 'order_cancelled', 'begin_order_cancelled');
  UPDATE public.orders SET cancelled_at = NULL WHERE id = (h->>'order')::uuid;
  UPDATE public.events SET status = 'cancelled' WHERE id = (h->>'event')::uuid;
  r := public.issue_3645_begin_installment_attempt((h->>'i1')::uuid, 'pay_link', 0);
  -- (cancelling the event may also cancel the row through the event-cancel path)
  PERFORM pg_temp.must(NOT (r->>'ok')::boolean
    AND r->>'reason' IN ('event_cancelled', 'installment_not_chargeable', 'installment_cancelled'), 'begin_event_cancelled', r);
END
$links$;

-- E. Grants: every new writer is service_role only.
DO $grants$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.issue_3645_paystack_plan_bind(uuid,jsonb,boolean)',
    'public.issue_3645_begin_installment_attempt(uuid,text,bigint,boolean,timestamptz)',
    'public.issue_3645_resolve_installment_attempt(uuid,text,text,text,text,bigint,bigint,boolean,timestamptz)',
    'public.issue_3645_checkpoint_pay_link_installment(uuid,timestamptz)',
    'public.issue_3645_issue_pay_link(uuid,text,bytea,timestamptz)',
    'public.issue_3645_resolve_pay_link(bytea,timestamptz)',
    'public.issue_3645_clear_at_risk_if_settled(uuid)',
    'public.issue_3645_downgrade_to_pay_link(uuid,text)',
    'public.issue_3645_abandon_attempt(uuid)'
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'grant_exposed %', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'grant_service_role_missing %', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.issue_3645_count_installment_failure(uuid,text,timestamptz)',
    'public.issue_3645_lock_installment_graph(uuid)',
    'public.issue_3645_audit_installment(uuid,text,jsonb)'
  ] LOOP
    IF has_function_privilege('service_role', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'internal_helper_exposed %', v_fn;
    END IF;
  END LOOP;
END
$grants$;

ROLLBACK;
