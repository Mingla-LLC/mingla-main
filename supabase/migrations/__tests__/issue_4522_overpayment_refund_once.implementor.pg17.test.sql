-- MINGLA-INVARIANT: I-4522-OVERPAY-REFUND-ONCE | issue #4522 | An overpayment is refunded at most once: an open or unanswered refund is re-checked, never replaced; a new refund only after every earlier one is confirmed failed and every refund on the charge was adopted, one sweep at a time; creating + pending + succeeded never exceed its amount (database guard); a late extra refund is recorded for ops; three refusals stop the lane.
-- MINGLA-INVARIANT: I-4522-COLLECTED-IS-WHAT-WAS-CHARGED | issue #4522 | A collected instalment row records exactly the amount the provider collected; money still owed after a short charge stays on an open row, so paid, paid-in-full, payouts and cancel refunds count only money actually collected.
\set ON_ERROR_STOP on

-- issue #4522 third rework (T3-1 .. T3-7), with the tester's numbers. Rolled back.
--   T3-1  a pending refund is checked, never re-created; the hard guard
--         refuses a second live refund; events by id / metadata, replayed and
--         out of order; a new attempt only after the prior one is re-read.
--   T3-1  a host's trip cancel with a $100 refund pending asks for $500 of the
--         $600 charge, not $600; the traveler's 50% cancel still totals $700.
--   T3-2  three refusals stop the lane (needs_ops, alert once, never due);
--         a dashboard refund on the charge resolves it; ops retry / by hand.
--   T3-3  a $300 charge on a row grown to $450 records $300 and re-opens $150.
--   T3-4  an overpayment refund reverses no referral share and leaves later
--         policy reversals exactly as on an order with no overpayment.
--   T3-5  "abandoned" releases only once the attempt is 24 hours old.
--   T3-6  NGN 30,000,000.00 (3,000,000,000 kobo) goes back in two 32-bit parts.
--   T3-7  an overpayment under NGN 50 stops for ops at once (alert once).
--   T4-1  nothing is reserved before the charge's refunds were read
--         (reconcile); a second sweep while one is sending is busy; a lost
--         answer is adopted from the provider's list; a refused create never
--         reverses a succeeded refund; a late refund past the amount is
--         acknowledged, recorded and stopped for ops with the exact extra;
--         a refund Mingla already recorded is never adopted as a dashboard one.
--   T4-4  a refund the provider reverses stops counting on its row, so an ops
--         retry's refund is counted once.
--   T5-1  a second refund for one attempt (a late create answer, or an
--         unmatched webhook / listed refund for a known overpayment) is
--         recorded once and alerts ops once with what was owed back and what
--         was refunded; the recorded refund completing keeps it with ops.
--   T6-1  an open recorded refund after a refund past the amount is still
--         checked (never re-sent, never re-alerted); ops can act once it ends.
--   T6-2  a succeeded extra refund counts as returned: an ops retry after the
--         recorded refund failed or was reversed sends nothing.
--   T6-4  an extra refund that later fails stops counting, no second alert.
--
-- FAILS-ON-REVERT: let issue_4522_begin_overpayment_refund reserve a new
-- attempt while one is creating/pending, drop issue_4522_overpayment_attempts_guard,
-- drop the overpayment term from issue_3645_cancel_refund_installment, drop
-- the failure limit, drop the source condition from
-- issue_3872_refund_share_trigger, drop issue_4522_record_short_collection's
-- update, drop the begin's reconcile or busy step, let a refund without its id
-- reverse a succeeded one, drop the over-amount adoption, or drop the known
-- refund check, keep a reversed refund counted on its row, or drop the
-- unmatched-refund record (issue_4522_overpayment_extra_refund) -> red.

BEGIN;

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL %: %', p_label, COALESCE(p_detail, '(no detail)');
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

INSERT INTO auth.users(id, email) VALUES
  ('4522c300-0000-4000-8000-000000000001', 'r3-host@example.test'),
  ('4522c300-0000-4000-8000-000000000002', 'r3-buyer@example.test'),
  ('4522c300-0000-4000-8000-000000000003', 'r3-referrer@example.test');
INSERT INTO public.creator_accounts(id, email) VALUES ('4522c300-0000-4000-8000-000000000001', 'r3-host@example.test');
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES ('4522c300-0000-4000-8000-000000000002', '+2348000045233');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country, payout_hold_cutover_at)
VALUES ('4522c300-0000-4000-8000-000000000011', '4522c300-0000-4000-8000-000000000001', 'R3 st', 'r3-st-4522', 'USD', 'stripe', 'US', now() - interval '10 days'),
       ('4522c300-0000-4000-8000-000000000012', '4522c300-0000-4000-8000-000000000001', 'R3 ps', 'r3-ps-4522', 'NGN', 'paystack', 'NG', now() - interval '10 days');
INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, charges_enabled, payouts_enabled, country, default_currency)
VALUES ('4522c300-0000-4000-8000-000000000011', 'acct_r3', true, true, 'US', 'usd');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency, refund_policy)
VALUES ('4522c300-0000-4000-8000-000000000021', '4522c300-0000-4000-8000-000000000011', '4522c300-0000-4000-8000-000000000001',
  'R3 trip', 'r3-trip', 'trip', 'scheduled', 'public', 'America/New_York', 'USD',
  '{"kind":"custom","tiers":[{"days_before_start":0,"refund_pct":50}]}'),
       ('4522c300-0000-4000-8000-000000000022', '4522c300-0000-4000-8000-000000000012', '4522c300-0000-4000-8000-000000000001',
  'R3 naira trip', 'r3-trip-ng', 'trip', 'scheduled', 'public', 'Africa/Lagos', 'NGN',
  '{"kind":"custom","tiers":[{"days_before_start":0,"refund_pct":50}]}');
INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total, is_unlimited, min_purchase_qty, available_online, available_in_person)
VALUES ('4522c300-0000-4000-8000-000000000040', '4522c300-0000-4000-8000-000000000021', 'SA', 120000, 'USD', false, 20, false, 1, true, false);
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
 ('4522c300-0000-4000-8000-000000000021', now() + interval '90 days', now() + interval '97 days', 'America/New_York', true),
 ('4522c300-0000-4000-8000-000000000022', now() + interval '90 days', now() + interval '97 days', 'Africa/Lagos', true);

-- A $1,200 Stripe trip: $600 deposit, rows $100 (charged by the cron) + $500.
-- A $600 balance payment lands after the $100 row: $100 of it was not owed.
CREATE FUNCTION pg_temp.overpaid(p_order uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v jsonb; v_flex uuid; v_row1 uuid;
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source, installment_plan_root, payment_plan_terms, stripe_payment_intent_id)
  VALUES (p_order, '4522c300-0000-4000-8000-000000000021', '4522c300-0000-4000-8000-000000000002',
    'r3-buyer@example.test', 'R3 Buyer', '+2348000045233', 60000, 'USD', 'online_card', 'paid', 'online_checkout', true,
    '{"v":2,"flex_enabled":true,"min_payment_minor":1000,"auto_adjust":true,"deposit_minor":60000}', 'pi_dep_' || p_order::text);
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, ticket_type_id)
  VALUES (p_order, 1, 10000, 'USD', now() + interval '20 days', 'scheduled', 'stripe', 'auto_card', '4522c300-0000-4000-8000-000000000040'),
         (p_order, 2, 50000, 'USD', now() + interval '50 days', 'scheduled', 'stripe', 'auto_card', '4522c300-0000-4000-8000-000000000040');
  v := public.issue_4522_begin_flex_payment(p_order, 60000, 60000, 'r3-key-' || left(p_order::text, 8), 'auto_card');
  v_flex := (v->>'installmentId')::uuid;
  v_row1 := (SELECT id FROM public.order_installments WHERE order_id = p_order AND ordinal = 1);
  UPDATE public.order_installments SET status = 'collected', collected_at = now(), stripe_payment_intent_id = 'pi_row1_' || p_order::text
   WHERE id = v_row1;
  UPDATE public.order_installments SET status = 'collected', collected_at = now(), stripe_payment_intent_id = 'pi_flex_' || p_order::text,
         stripe_charge_id = 'ch_flex_' || p_order::text
   WHERE id = v_flex;
  PERFORM public.record_order_installment_provider_sale(v_flex, 900, 0);
  v := public.issue_4522_settle_flex_payment(v_flex);
  IF (v->>'heldMinor')::bigint <> 10000 THEN RAISE EXCEPTION 'setup: expected $100 held, got %', v; END IF;
  RETURN (SELECT id FROM public.order_overpayments WHERE installment_id = v_flex);
END $$;
CREATE FUNCTION pg_temp.op(p_id uuid) RETURNS public.order_overpayments LANGUAGE sql AS $$
  SELECT * FROM public.order_overpayments WHERE id = p_id $$;
CREATE FUNCTION pg_temp.n_attempts(p_id uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.order_overpayment_refund_attempts WHERE overpayment_id = p_id $$;

DO $t$
DECLARE
  o1 uuid := '4522c300-0000-4000-8000-0000000000a1';
  o2 uuid := '4522c300-0000-4000-8000-0000000000a2';
  o3 uuid := '4522c300-0000-4000-8000-0000000000a3';
  o4 uuid := '4522c300-0000-4000-8000-0000000000a4';
  o5 uuid := '4522c300-0000-4000-8000-0000000000a5';
  op uuid; v jsonb; v_flex uuid; v_raised boolean; v_i int;
BEGIN
  -- ── T3-1: pending is checked, never re-created ────────────────────────
  op := pg_temp.overpaid(o1);
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T3-1 the first plan reserves attempt 1 for $100',
    v->>'action' = 'create' AND (v->>'attemptNo')::int = 1 AND (v->>'amountMinor')::bigint = 10000
    AND v->>'idempotencyKey' = 'mingla_overpay_refund:' || op || ':1', v::text);
  v := public.issue_4522_finish_overpayment_refund(op, 1, 'pending', 're_r3_1');
  PERFORM pg_temp.check('T3-1 the provider''s refund id is stored the moment it answers pending',
    (SELECT provider_refund_id FROM public.order_overpayment_refund_attempts WHERE overpayment_id = op) = 're_r3_1'
    AND (pg_temp.op(op)).state = 'refund_pending', v::text);
  FOR v_i IN 1..3 LOOP
    v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
    PERFORM pg_temp.check('T3-1 every later pass verifies the stored refund (pass ' || v_i || ')',
      v->>'action' = 'verify' AND v->'attempts'->0->>'providerRefundId' = 're_r3_1' AND pg_temp.n_attempts(op) = 1, v::text);
    PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'pending', 're_r3_1');
  END LOOP;
  -- 30 hours later (past the provider's key window): still verified by id, nothing new.
  UPDATE public.order_overpayment_refund_attempts SET created_at = now() - interval '30 hours' WHERE overpayment_id = op;
  v := public.issue_4522_begin_overpayment_refund(op, 99, true);
  PERFORM pg_temp.check('T3-1 after the key window: verify by id, never a new refund',
    v->>'action' = 'verify' AND (v->'attempts'->0->>'withinKeyWindow')::boolean = false AND pg_temp.n_attempts(op) = 1, v::text);
  -- 8 days: ops told once, still nothing new.
  UPDATE public.order_overpayment_refund_attempts SET created_at = now() - interval '8 days' WHERE overpayment_id = op;
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T3-1 pending past the ceiling alerts ops once', (v->>'alertOps')::boolean
    AND v->>'alertKind' = 'refund_pending_too_long' AND v->>'action' = 'verify', v::text);
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T3-1 ... and only once', NOT (v->>'alertOps')::boolean AND pg_temp.n_attempts(op) = 1, v::text);
  -- The hard guard: a second live refund of the same overpayment is refused.
  v_raised := false;
  BEGIN
    INSERT INTO public.order_overpayment_refund_attempts (overpayment_id, attempt_no, origin, amount_minor, state)
    VALUES (op, 2, 'mingla', 10000, 'creating');
  EXCEPTION WHEN check_violation THEN v_raised := SQLERRM = 'overpayment_refund_exceeds_amount';
  END;
  PERFORM pg_temp.check('T3-1 the database guard refuses a second live refund', v_raised);
  -- The webhook: succeeded by refund id; a stale pending afterwards and a replay change nothing.
  v := public.issue_4522_overpayment_refund_event('stripe', 're_r3_1', 'pi_flex_' || o1::text, 10000, 'succeeded');
  PERFORM pg_temp.check('T3-1 refund.updated succeeded resolves it by refund id (never an orphan)',
    (v->>'handled')::boolean AND v->>'matchedBy' = 'provider_refund_id' AND (pg_temp.op(op)).state = 'refunded', v::text);
  v := public.issue_4522_overpayment_refund_event('stripe', 're_r3_1', 'pi_flex_' || o1::text, 10000, 'pending');
  PERFORM pg_temp.check('T3-1 an out-of-order pending event never moves it back',
    (v->>'handled')::boolean AND (pg_temp.op(op)).state = 'refunded'
    AND (SELECT state FROM public.order_overpayment_refund_attempts WHERE overpayment_id = op) = 'succeeded', v::text);
  PERFORM public.issue_4522_overpayment_refund_event('stripe', 're_r3_1', 'pi_flex_' || o1::text, 10000, 'succeeded');
  v_flex := (pg_temp.op(op)).installment_id;
  PERFORM pg_temp.check('T3-1 returned exactly once: one succeeded refund row, $100 on the row',
    (SELECT refunded_amount_cents FROM public.order_installments WHERE id = v_flex) = 10000
    AND (SELECT count(*) FROM public.refunds WHERE metadata->>'overpayment_id' = op::text AND status = 'succeeded') = 1
    AND (SELECT payout_accounting_state FROM public.order_installments WHERE id = v_flex) = 'ready');
  PERFORM pg_temp.check('T3-1 refunded: nothing due, plan done',
    jsonb_array_length(public.issue_4522_overpayments_due(o1, now(), 10)) = 0
    AND (public.issue_4522_begin_overpayment_refund(op, NULL, true)->>'done')::boolean);

  -- ── T3-1: a failed refund is re-read before the next one ────────────────
  op := pg_temp.overpaid(o2);
  PERFORM public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'failed', 're_r3_f1', 'card_closed');
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T3-1 a refused refund retries only when due', v->>'reason' = 'retry_not_due', v::text);
  UPDATE public.order_overpayments SET next_attempt_at = now() - interval '1 minute' WHERE id = op;
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T3-1 before a new refund every earlier provider refund is re-read',
    v->>'action' = 'verify_prior' AND v->'attempts'->0->>'providerRefundId' = 're_r3_f1' AND pg_temp.n_attempts(op) = 1, v::text);
  v := public.issue_4522_begin_overpayment_refund(op, 1, true);
  PERFORM pg_temp.check('T3-1 ... then attempt 2 with a new key', v->>'action' = 'create' AND (v->>'attemptNo')::int = 2
    AND v->>'idempotencyKey' = 'mingla_overpay_refund:' || op || ':2', v::text);
  -- Its create answer was lost; the webhook names it by metadata (amount must match).
  v := public.issue_4522_overpayment_refund_event('stripe', 're_r3_2', 'pi_flex_' || o2::text, 9999, 'pending', op, 2);
  PERFORM pg_temp.check('T3-1 a metadata match with the wrong amount changes nothing',
    v->>'matchedBy' = 'none' AND (SELECT provider_refund_id FROM public.order_overpayment_refund_attempts
                                  WHERE overpayment_id = op AND attempt_no = 2) IS NULL, v::text);
  v := public.issue_4522_overpayment_refund_event('stripe', 're_r3_2', 'pi_flex_' || o2::text, 10000, 'pending', op, 2);
  PERFORM pg_temp.check('T3-1 the metadata match stores the refund id (pending)', v->>'matchedBy' = 'metadata'
    AND (SELECT provider_refund_id FROM public.order_overpayment_refund_attempts WHERE overpayment_id = op AND attempt_no = 2) = 're_r3_2', v::text);
  -- A revived prior refund (provider now says succeeded) completes it; no third refund.
  v := public.issue_4522_finish_overpayment_refund(op, 2, 'succeeded', 're_r3_2');
  PERFORM pg_temp.check('T3-1 attempt 2 succeeded: refunded', (pg_temp.op(op)).state = 'refunded', v::text);

  -- ── T3-1: cancels with the $100 refund pending ─────────────────────────
  op := pg_temp.overpaid(o3);
  PERFORM public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'pending', 're_r3_c1');
  v_flex := (pg_temp.op(op)).installment_id;
  v := public.issue_3645_cancel_refund_installment(v_flex, 'The host cancelled this trip', 'r3-host-cancel-1');
  PERFORM pg_temp.check('T3-1 a host''s trip cancel asks for $500 of the $600 charge while $100 is pending',
    (v->>'amount_cents')::bigint = 50000 AND NOT (v->>'is_full_refund')::boolean, v::text);
  v := public.issue_4522_compute_refund_for_cancel_as(o3, now(), 'buyer');
  PERFORM pg_temp.check('T3-1 the traveler''s 50% cancel: $600 policy + $100 being returned = $700',
    (v->>'refund_total_cents')::bigint = 60000 AND (v->>'overpayment_return_cents')::bigint = 10000
    AND (v->>'total_back_cents')::bigint = 70000, v::text);
  PERFORM pg_temp.check('T3-1 ... the flexible charge''s policy part is $250 of its $500',
    EXISTS (SELECT 1 FROM jsonb_array_elements(v->'per_payment_refund') e
             WHERE e->>'installment_id' = v_flex::text AND (e->>'paid_cents')::bigint = 50000
               AND (e->>'refund_cents')::bigint = 25000), v::text);

  -- ── T3-2: three refusals stop the lane; the dashboard refund resolves it ─
  op := pg_temp.overpaid(o4);
  FOR v_i IN 1..3 LOOP
    UPDATE public.order_overpayments SET next_attempt_at = now() - interval '1 minute' WHERE id = op AND state = 'refund_failed';
    v := public.issue_4522_begin_overpayment_refund(op, 99, true);
    PERFORM pg_temp.check('T3-2 attempt ' || v_i || ' reserved', v->>'action' = 'create' AND (v->>'attemptNo')::int = v_i, v::text);
    v := public.issue_4522_finish_overpayment_refund(op, v_i, 'failed', NULL, 'charge_disputed');
  END LOOP;
  PERFORM pg_temp.check('T3-2 the third refusal stops it (needs_ops) and alerts once',
    (pg_temp.op(op)).state = 'needs_ops' AND (pg_temp.op(op)).needs_ops_reason = 'refund_failed_repeatedly'
    AND (v->>'alertOps')::boolean AND v->>'alertKind' = 'refund_failed_repeatedly', v::text);
  PERFORM pg_temp.check('T3-2 stopped: never due again, the plan sends nothing',
    jsonb_array_length(public.issue_4522_overpayments_due(o4, now(), 10)) = 0
    AND public.issue_4522_begin_overpayment_refund(op, 99, true)->>'reason' = 'needs_ops' AND pg_temp.n_attempts(op) = 3);
  v_flex := (pg_temp.op(op)).installment_id;
  PERFORM pg_temp.check('T3-2 the host payout for the charge stays held (whole row, bounded by the alert)',
    public.issue_4522_row_payout_blocked(v_flex));
  v := public.issue_4522_overpayment_refund_event('stripe', 're_mingla_other', 'pi_flex_' || o4::text, 10000, 'succeeded',
         NULL, NULL, true);
  PERFORM pg_temp.check('T3-2 a refund Mingla made for another reason is never taken as the overpayment',
    NOT (v->>'handled')::boolean AND (pg_temp.op(op)).state = 'needs_ops', v::text);
  v := public.issue_4522_overpayment_refund_event('stripe', 're_dashboard', 'pi_flex_' || o4::text, 60000, 'succeeded',
         NULL, NULL, false);
  PERFORM pg_temp.check('T3-2 a $600 dashboard refund on the charge returns the $100 overpayment first and closes it',
    (v->>'handled')::boolean AND (v->>'allocatedMinor')::bigint = 10000 AND (pg_temp.op(op)).state = 'refunded'
    AND (SELECT origin || ':' || state FROM public.order_overpayment_refund_attempts WHERE overpayment_id = op AND attempt_no = 4)
        = 'provider_match:succeeded', v::text);
  v := public.issue_4522_overpayment_refund_event('stripe', 're_dashboard', 'pi_flex_' || o4::text, 60000, 'succeeded',
         NULL, NULL, false);
  PERFORM pg_temp.check('T3-2 the dashboard event replayed allocates nothing more',
    pg_temp.n_attempts(op) = 4 AND (SELECT refunded_amount_cents FROM public.order_installments WHERE id = v_flex) = 10000, v::text);
  v := public.issue_4522_overpayment_refund_event('stripe', 're_dashboard', 'pi_flex_' || o4::text, 60000, 'failed');
  PERFORM pg_temp.check('T3-2 a refund the provider reverses after it succeeded stops the lane for ops (alert)',
    (pg_temp.op(op)).state = 'needs_ops' AND (pg_temp.op(op)).needs_ops_reason = 'provider_reversed_refund'
    AND (pg_temp.op(op)).resolved_at IS NULL AND (v->'results'->0->>'alertOps')::boolean, v::text);

  -- Ops actions: retry restarts the lane; by hand records the return.
  op := pg_temp.overpaid(o5);
  PERFORM public.issue_4522_overpayment_to_needs_ops(op, 'refund_failed_repeatedly', now());
  v := public.issue_4522_resolve_overpayment_by_ops(op, 'retry', '4522c300-0000-4000-8000-000000000001');
  PERFORM pg_temp.check('T3-2 ops retry restarts automatic refunding', (pg_temp.op(op)).state = 'held'
    AND (pg_temp.op(op)).consecutive_failures = 0 AND (pg_temp.op(op)).ops_alerted_at IS NULL, v::text);
  PERFORM public.issue_4522_begin_overpayment_refund(op, NULL, true);
  v_raised := false;
  BEGIN
    PERFORM public.issue_4522_resolve_overpayment_by_ops(op, 'refunded_by_hand', '4522c300-0000-4000-8000-000000000001', 'manual-1');
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_raised := true;
  END;
  PERFORM pg_temp.check('T3-2 an ops action is refused while a refund is open at the provider (PT409)', v_raised);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'failed', NULL, 'declined');
  v := public.issue_4522_resolve_overpayment_by_ops(op, 'refunded_by_hand', '4522c300-0000-4000-8000-000000000001', 'manual-1');
  PERFORM pg_temp.check('T3-2 refunded by hand is recorded and closes it', (pg_temp.op(op)).state = 'refunded'
    AND (pg_temp.op(op)).resolved_by = '4522c300-0000-4000-8000-000000000001', v::text);
END
$t$;

-- ── T4-1 (fourth rework): adopt before create, one sender, late answers ─
DO $t$
DECLARE
  o6 uuid := '4522c300-0000-4000-8000-0000000000a6';
  o7 uuid := '4522c300-0000-4000-8000-0000000000a7';
  o8 uuid := '4522c300-0000-4000-8000-0000000000a8';
  op uuid; v jsonb; v_flex uuid;
BEGIN
  op := pg_temp.overpaid(o6);
  v := public.issue_4522_begin_overpayment_refund(op);
  PERFORM pg_temp.check('T4-1 nothing is reserved before the provider''s refunds on the charge were read (reconcile)',
    v->>'action' = 'reconcile' AND v->>'providerRef' = 'pi_flex_' || o6::text AND pg_temp.n_attempts(op) = 0, v::text);
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T4-1 ... after it, attempt 1 is reserved', v->>'action' = 'create' AND (v->>'attemptNo')::int = 1, v::text);
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T4-1 a second sweep while attempt 1 is being sent is told busy and gets nothing',
    v->>'reason' = 'busy' AND v->'attempts' IS NULL AND pg_temp.n_attempts(op) = 1, v::text);
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true, now() + interval '3 minutes');
  PERFORM pg_temp.check('T4-1 once the sender is quiet, the unanswered attempt is verified with its stored refund row id',
    v->>'action' = 'verify' AND v->'attempts'->0->>'state' = 'creating'
    AND v->'attempts'->0->>'refundId' = (pg_temp.op(op)).refund_id::text, v::text);
  -- our answer write was lost; the refund the provider lists (our metadata) is adopted
  v := public.issue_4522_overpayment_refund_event('stripe', 're_t4_1', 'pi_flex_' || o6::text, 10000, 'succeeded', op, 1, true);
  PERFORM pg_temp.check('T4-1 the listed refund is adopted: refunded once', (pg_temp.op(op)).state = 'refunded'
    AND v->>'matchedBy' = 'metadata', v::text);
  v := public.issue_4522_overpayment_refund_event('stripe', 're_t4_1', 'pi_flex_' || o6::text, 10000, 'succeeded', op, 1, true);
  PERFORM pg_temp.check('T4-1 its webhook later changes nothing', (pg_temp.op(op)).state = 'refunded'
    AND NOT (v->'results'->0->>'changed')::boolean, v::text);
  v := public.issue_4522_finish_overpayment_refund(op, 1, 'failed', NULL, 'idempotency_error');
  PERFORM pg_temp.check('T4-1 a refused create (no refund id) never reverses a succeeded refund and never alerts',
    (pg_temp.op(op)).state = 'refunded' AND v->>'alertOps' IS NULL
    AND (SELECT state FROM public.order_overpayment_refund_attempts WHERE overpayment_id = op) = 'succeeded', v::text);

  -- the state the old code could leave: attempt 1 counted failed, refund 2 sent; then refund 1's late webhook
  op := pg_temp.overpaid(o7);
  PERFORM public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'not_found', NULL, 'not_created_at_provider');
  UPDATE public.order_overpayments SET next_attempt_at = now() - interval '1 minute' WHERE id = op;
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 2, 'succeeded', 're_t4_b2');
  v := public.issue_4522_overpayment_refund_event('stripe', 're_t4_b1', 'pi_flex_' || o7::text, 10000, 'succeeded', op, 1, true);
  PERFORM pg_temp.check('T4-1 a late refund past the amount is acknowledged (no error), recorded, stopped for ops with the exact extra amount',
    (v->>'handled')::boolean AND v->'results'->0->>'alertKind' = 'provider_refunded_more'
    AND (v->'results'->0->>'alertOps')::boolean AND (v->'results'->0->>'overRefundedMinor')::bigint = 10000
    AND (pg_temp.op(op)).state = 'needs_ops' AND (pg_temp.op(op)).needs_ops_reason = 'provider_refunded_more'
    AND (pg_temp.op(op)).detail->'over_refunded'->0->>'provider_refund_id' = 're_t4_b1', v::text);
  v := public.issue_4522_overpayment_refund_event('stripe', 're_t4_b1', 'pi_flex_' || o7::text, 10000, 'succeeded', op, 1, true);
  PERFORM pg_temp.check('T4-1 ... its replay is acknowledged once more without a second alert or record',
    (v->>'handled')::boolean AND v->'results'->0->>'alertOps' IS NULL
    AND jsonb_array_length((pg_temp.op(op)).detail->'over_refunded') = 1, v::text);

  -- a refund Mingla already recorded (its id is known) is never taken as a dashboard refund, even without metadata
  op := pg_temp.overpaid(o8);
  v_flex := (pg_temp.op(op)).installment_id;
  INSERT INTO public.refunds (order_id, amount_cents, reason, status, currency, stripe_refund_id, metadata)
  VALUES (o8, 5000, 'A host refund', 'succeeded', 'USD', 're_t4_known', '{"kind":"t4_other"}');
  v := public.issue_4522_overpayment_refund_event('stripe', 're_t4_known', 'pi_flex_' || o8::text, 5000, 'succeeded',
         NULL, NULL, false);
  PERFORM pg_temp.check('T4-1 a known Mingla refund listed without metadata is explained, not adopted',
    NOT (v->>'handled')::boolean AND v->>'reason' = 'known_refund' AND pg_temp.n_attempts(op) = 0, v::text);
END
$t$;

-- ── T4-4: a refund the provider reverses, then an ops retry: counted once ─
DO $t$
DECLARE
  o9 uuid := '4522c300-0000-4000-8000-0000000000a9';
  op uuid; v jsonb; v_flex uuid;
BEGIN
  op := pg_temp.overpaid(o9);
  v_flex := (pg_temp.op(op)).installment_id;
  PERFORM public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'succeeded', 're_t44_1');
  PERFORM pg_temp.check('T4-4 the $100 refund is counted on the row', (SELECT refunded_amount_cents FROM public.order_installments WHERE id = v_flex) = 10000);
  v := public.issue_4522_overpayment_refund_event('stripe', 're_t44_1', 'pi_flex_' || o9::text, 10000, 'failed');
  PERFORM pg_temp.check('T4-4 the provider reverses it: the row no longer counts it, ops is told',
    (SELECT refunded_amount_cents FROM public.order_installments WHERE id = v_flex) = 0
    AND (pg_temp.op(op)).state = 'needs_ops' AND (v->'results'->0->>'alertOps')::boolean, v::text);
  v := public.issue_4522_resolve_overpayment_by_ops(op, 'retry', '4522c300-0000-4000-8000-000000000001');
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T4-4 the retry first re-reads the reversed refund', v->>'action' = 'verify_prior', v::text);
  v := public.issue_4522_begin_overpayment_refund(op, 1, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, (v->>'attemptNo')::int, 'succeeded', 're_t44_2');
  PERFORM pg_temp.check('T4-4 after the ops retry the row counts $100 refunded once (the provider''s net), not $200',
    (SELECT refunded_amount_cents FROM public.order_installments WHERE id = v_flex) = 10000
    AND (pg_temp.op(op)).state = 'refunded'
    AND (SELECT count(*) FROM public.order_installment_refund_applications WHERE installment_id = v_flex) = 1, v::text);
  v := public.issue_4522_compute_refund_for_cancel_as(o9, now(), 'buyer');
  PERFORM pg_temp.check('T4-4 a cancel quote after it counts the flexible charge''s $500 kept, at 50% = $250',
    EXISTS (SELECT 1 FROM jsonb_array_elements(v->'per_payment_refund') e
             WHERE e->>'installment_id' = v_flex::text AND (e->>'paid_cents')::bigint = 50000
               AND (e->>'refund_cents')::bigint = 25000), v::text);
END
$t$;

-- ── T3-6 / T3-7 on the second provider ─────────────────────────────────
CREATE FUNCTION pg_temp.ng_overpayment(p_order uuid, p_refund bigint) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_row uuid;
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source, installment_plan_root, payment_plan_terms, stripe_payment_intent_id)
  VALUES (p_order, '4522c300-0000-4000-8000-000000000022', '4522c300-0000-4000-8000-000000000002',
    'r3-buyer@example.test', 'R3 Buyer', '+2348000045233', 30000000, 'NGN', 'online_card', 'paid', 'online_checkout', true,
    '{"v":2,"flex_enabled":true,"min_payment_minor":100000,"auto_adjust":true,"deposit_minor":30000000}', 'ps_dep_' || p_order::text);
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, buyer_total_cents, collected_at, stripe_payment_intent_id)
  VALUES (p_order, 1, 90000000, 'NGN', now() - interval '1 day', 'collected', 'paystack', 'pay_link', 91800000, now(),
    'mingla-inst-' || p_order::text || '-l1')
  RETURNING id INTO v_row;
  RETURN public.issue_4522_hold_overpayment(v_row, 'late_amount_mismatch', p_refund, 'mingla-inst-' || p_order::text || '-l1',
    '{}'::jsonb, p_refund);
END $$;

DO $t$
DECLARE
  op uuid; v jsonb; v_parts text;
BEGIN
  op := pg_temp.ng_overpayment('4522c300-0000-4000-8000-0000000000b1', 3000000000);
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T3-6 part 1 fits a refund row (2,147,483,647)',
    v->>'action' = 'create' AND (v->>'amountMinor')::bigint = 2147483647, v::text);
  v := public.issue_4522_finish_overpayment_refund(op, 1, 'succeeded', 'rfd_p1');
  PERFORM pg_temp.check('T3-6 after part 1 the rest is due now', (pg_temp.op(op)).state = 'held'
    AND jsonb_array_length(public.issue_4522_overpayments_due('4522c300-0000-4000-8000-0000000000b1', now(), 5)) = 1, v::text);
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T3-6 part 2 is the exact rest (852,516,353)', (v->>'amountMinor')::bigint = 852516353, v::text);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 2, 'succeeded', 'rfd_p2');
  SELECT string_agg(amount_cents::text, '+' ORDER BY created_at) INTO v_parts FROM public.refunds
   WHERE metadata->>'overpayment_id' = op::text AND status = 'succeeded';
  PERFORM pg_temp.check('T3-6 refunded in two rows that sum exactly to NGN 30,000,000.00',
    (pg_temp.op(op)).state = 'refunded' AND v_parts = '2147483647+852516353'
    AND (public.issue_4522_balance((pg_temp.op(op)).order_id)->>'overpaymentRefundedMinor')::bigint = 3000000000, v_parts);

  op := pg_temp.ng_overpayment('4522c300-0000-4000-8000-0000000000b2', 2147486647);
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T3-6 the last part never falls under the provider''s minimum (2,147,481,647 then 5,000)',
    (v->>'amountMinor')::bigint = 2147481647, v::text);

  op := pg_temp.ng_overpayment('4522c300-0000-4000-8000-0000000000b3', 3000);
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T3-7 NGN 30 is below the NGN 50 partial-refund minimum: stopped for ops at once, alerted',
    v->>'reason' = 'needs_ops' AND v->>'alertKind' = 'below_provider_minimum' AND (v->>'alertOps')::boolean
    AND (v->>'minRefundMinor')::bigint = 5000 AND (pg_temp.op(op)).state = 'needs_ops' AND pg_temp.n_attempts(op) = 0, v::text);
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T3-7 never retried and alerted only once', v->>'reason' = 'needs_ops' AND v->>'alertOps' IS NULL
    AND jsonb_array_length(public.issue_4522_overpayments_due('4522c300-0000-4000-8000-0000000000b3', now(), 5)) = 0, v::text);
  v := public.issue_4522_overpayment_refund_event('paystack', 'rfd_dash_small', 'mingla-inst-4522c300-0000-4000-8000-0000000000b3-l1',
         3000, 'succeeded', NULL, NULL, false);
  PERFORM pg_temp.check('T3-7 a refund made at the provider for it closes it', (pg_temp.op(op)).state = 'refunded', v::text);
END
$t$;

-- ── T5-1: a second refund for one attempt (the second provider created our
--    request late, or a re-send after a lost answer made another) is never
--    silent: one alert naming the owed and refunded amounts, once ─────────
DO $t$
DECLARE
  op uuid; v jsonb; v_note_ref text := 'mingla-inst-4522c300-0000-4000-8000-0000000000b4-l1';
BEGIN
  -- (a) worker B's re-send stored refund 1; worker A's late answer names refund 2.
  op := pg_temp.ng_overpayment('4522c300-0000-4000-8000-0000000000b4', 500000);
  PERFORM public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'pending', '9001');
  v := public.issue_4522_finish_overpayment_refund(op, 1, 'pending', '9002');
  PERFORM pg_temp.check('T5-1 a late create answer naming a second refund alerts ops once with owed and refunded',
    (v->>'alertOps')::boolean AND v->>'alertKind' = 'provider_refunded_more'
    AND (v->>'refundMinor')::bigint = 500000 AND (v->>'refundedMinor')::bigint = 1000000
    AND (v->>'overRefundedMinor')::bigint = 500000 AND v->>'reason' = 'provider_refund_id_mismatch'
    AND (pg_temp.op(op)).state = 'needs_ops' AND (pg_temp.op(op)).needs_ops_reason = 'provider_refunded_more'
    AND (SELECT provider_refund_id FROM public.order_overpayment_refund_attempts WHERE overpayment_id = op) = '9001', v::text);
  v := public.issue_4522_finish_overpayment_refund(op, 1, 'pending', '9002');
  PERFORM pg_temp.check('T5-1 ... the same late answer again: no second alert', v->>'alertOps' IS NULL
    AND jsonb_array_length((pg_temp.op(op)).detail->'over_refunded') = 1, v::text);
  v := public.issue_4522_overpayment_refund_event('paystack', '9002', v_note_ref, 500000, 'succeeded', op, 1, true);
  PERFORM pg_temp.check('T5-1 ... its webhook (and a reconcile listing it) is acknowledged without a second alert',
    (v->>'handled')::boolean AND v->>'matchedBy' = 'none' AND jsonb_array_length(v->'results') = 0, v::text);
  v := public.issue_4522_overpayment_refund_event('paystack', '9001', v_note_ref, 500000, 'succeeded', op, 1, true);
  PERFORM pg_temp.check('T5-1 ... the recorded refund completing keeps it with ops (payout held), no alert',
    v->'results'->0->>'alertOps' IS DISTINCT FROM 'true' AND (pg_temp.op(op)).state = 'needs_ops'
    AND public.issue_4522_overpayment_returned_minor(op) = 500000
    AND jsonb_array_length(public.issue_4522_overpayments_due('4522c300-0000-4000-8000-0000000000b4', now(), 5)) = 0, v::text);

  -- (b) a lost answer, a re-send recorded refund 2; refund 1's webhook arrives later.
  op := pg_temp.ng_overpayment('4522c300-0000-4000-8000-0000000000b5', 500000);
  v_note_ref := 'mingla-inst-4522c300-0000-4000-8000-0000000000b5-l1';
  PERFORM public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'pending', '9005');
  v := public.issue_4522_overpayment_refund_event('paystack', '9004', v_note_ref, 500000, 'failed', op, 1, true);
  PERFORM pg_temp.check('T5-1 a refused second refund moved no money: not recorded, no alert',
    jsonb_array_length(v->'results') = 0 AND (pg_temp.op(op)).detail->'over_refunded' IS NULL, v::text);
  v := public.issue_4522_overpayment_refund_event('paystack', '9004', v_note_ref, 500000, 'pending', op, 1, true);
  PERFORM pg_temp.check('T5-1 an unmatched refund webhook for a known overpayment alerts ops once',
    (v->>'handled')::boolean AND (v->'results'->0->>'alertOps')::boolean
    AND v->'results'->0->>'alertKind' = 'provider_refunded_more'
    AND (v->'results'->0->>'refundedMinor')::bigint = 1000000 AND (v->'results'->0->>'refundMinor')::bigint = 500000
    AND v->'results'->0->>'providerRef' = v_note_ref AND (pg_temp.op(op)).state = 'needs_ops', v::text);
  v := public.issue_4522_overpayment_refund_event('paystack', '9004', v_note_ref, 500000, 'succeeded', op, 1, true);
  PERFORM pg_temp.check('T5-1 ... its later and duplicate webhooks: no second alert',
    jsonb_array_length(v->'results') = 0 AND jsonb_array_length((pg_temp.op(op)).detail->'over_refunded') = 1, v::text);
END
$t$;

-- ── T6 (sixth rework): after a refund past the amount ───────────────────
--   T6-1 the recorded refund still open is checked again, never re-sent,
--        never re-alerted; once it resolves ops can act.
--   T6-2 a succeeded extra refund counts as returned: an ops retry after the
--        recorded refund failed or was reversed sends nothing.
--   T6-4 an extra refund that later fails stops counting (no second alert).
DO $t$
DECLARE
  op uuid; v jsonb; v_raised boolean := false;
  r6 uuid := '4522c300-0000-4000-8000-0000000000b6';
  r7 uuid := '4522c300-0000-4000-8000-0000000000b7';
  r8 uuid := '4522c300-0000-4000-8000-0000000000b8';
  r9 uuid := '4522c300-0000-4000-8000-0000000000b9';
BEGIN
  -- T6-1
  op := pg_temp.ng_overpayment(r6, 500000);
  PERFORM public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'pending', '9061');
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'pending', '9062');
  PERFORM pg_temp.check('T6-1 stopped for refunded-more with its recorded refund pending: still due for a check',
    (pg_temp.op(op)).needs_ops_reason = 'provider_refunded_more'
    AND jsonb_array_length(public.issue_4522_overpayments_due(r6, now(), 5)) = 1
    AND public.issue_4522_overpayments_due(NULL, now() + interval '6 minutes', 1000)
          @> jsonb_build_array(jsonb_build_object('overpaymentId', op)));
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T6-1 ... the sweep reads the recorded refund by its id: no new refund, no new alert',
    v->>'action' = 'verify' AND v->>'alertOps' = 'false' AND jsonb_array_length(v->'attempts') = 1
    AND v->'attempts'->0->>'providerRefundId' = '9061' AND pg_temp.n_attempts(op) = 1, v::text);
  BEGIN
    PERFORM public.issue_4522_resolve_overpayment_by_ops(op, 'retry', '4522c300-0000-4000-8000-000000000001');
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_raised := true;
  END;
  PERFORM pg_temp.check('T6-1 ... ops retry is refused while it is pending', v_raised);
  v := public.issue_4522_finish_overpayment_refund(op, 1, 'succeeded', '9061');
  PERFORM pg_temp.check('T6-1 ... it completes: stays with ops, no alert; T7-2 still due only for its pending extra refund',
    (pg_temp.op(op)).state = 'needs_ops' AND v->>'alertOps' = 'false'
    AND jsonb_array_length(public.issue_4522_overpayments_due(r6, now(), 5)) = 1, v::text);
  v_raised := false;
  BEGIN
    PERFORM public.issue_4522_resolve_overpayment_by_ops(op, 'retry', '4522c300-0000-4000-8000-000000000001');
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_raised := true;
  END;
  PERFORM pg_temp.check('T7-2 ... ops retry is refused while the extra refund is pending', v_raised);
  PERFORM public.issue_4522_overpayment_refund_event('paystack', '9062', 'mingla-inst-' || r6::text || '-l1', 500000,
    'failed', op, 1, true);
  PERFORM pg_temp.check('T6-1 ... the extra refund failed: no longer due',
    jsonb_array_length(public.issue_4522_overpayments_due(r6, now(), 5)) = 0);
  v := public.issue_4522_resolve_overpayment_by_ops(op, 'retry', '4522c300-0000-4000-8000-000000000001');
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T6-1 ... ops retry is accepted and closes it without a new refund',
    (pg_temp.op(op)).state = 'refunded' AND pg_temp.n_attempts(op) = 1, v::text);

  -- T6-2: the recorded refund fails, the extra one succeeded.
  op := pg_temp.ng_overpayment(r7, 500000);
  PERFORM public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'pending', '9071');
  v := public.issue_4522_overpayment_refund_event('paystack', '9072', 'mingla-inst-' || r7::text || '-l1', 500000,
         'succeeded', op, 1, true);
  PERFORM pg_temp.check('T6-2 the alert says what is still pending at the provider',
    (v->'results'->0->>'alertOps')::boolean AND (v->'results'->0->>'refundedMinor')::bigint = 1000000
    AND (v->'results'->0->>'pendingMinor')::bigint = 500000, v::text);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'failed', '9071', 'refund.failed');
  PERFORM public.issue_4522_resolve_overpayment_by_ops(op, 'retry', '4522c300-0000-4000-8000-000000000001');
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T6-2 ... ops retry sends nothing: the extra refund already returned it',
    (pg_temp.op(op)).state = 'refunded' AND pg_temp.n_attempts(op) = 1
    AND public.issue_4522_overpayment_back_minor(op) = 500000, v::text);

  -- T6-2: the recorded refund succeeded, the provider reversed it, then an extra one succeeded.
  op := pg_temp.ng_overpayment(r8, 500000);
  PERFORM public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'succeeded', '9081');
  PERFORM public.issue_4522_overpayment_refund_event('paystack', '9081', 'mingla-inst-' || r8::text || '-l1', 500000, 'failed');
  v := public.issue_4522_overpayment_refund_event('paystack', '9082', 'mingla-inst-' || r8::text || '-l1', 500000,
         'succeeded', op, 1, true);
  PERFORM pg_temp.check('T6-2 after a reversal the extra refund is not counted as more than owed',
    (v->'results'->0->>'refundedMinor')::bigint = 500000 AND (v->'results'->0->>'overRefundedMinor')::bigint = 0, v::text);
  PERFORM public.issue_4522_resolve_overpayment_by_ops(op, 'retry', '4522c300-0000-4000-8000-000000000001');
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T6-2 ... ops retry sends nothing', (pg_temp.op(op)).state = 'refunded'
    AND pg_temp.n_attempts(op) = 1, v::text);

  -- T6-4: an extra refund recorded while pending, then failed.
  op := pg_temp.ng_overpayment(r9, 500000);
  PERFORM public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'pending', '9091');
  PERFORM public.issue_4522_overpayment_refund_event('paystack', '9092', 'mingla-inst-' || r9::text || '-l1', 500000,
    'pending', op, 1, true);
  v := public.issue_4522_overpayment_refund_event('paystack', '9092', 'mingla-inst-' || r9::text || '-l1', 500000,
         'failed', op, 1, true);
  PERFORM pg_temp.check('T6-4 the extra refund failing marks it failed (kept as history), no second alert',
    jsonb_array_length(v->'results') = 0 AND jsonb_array_length((pg_temp.op(op)).detail->'over_refunded') = 1
    AND (pg_temp.op(op)).detail->'over_refunded'->0->>'status' = 'failed', v::text);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'succeeded', '9091');
  PERFORM pg_temp.check('T6-4 ... it no longer counts as returned', public.issue_4522_overpayment_back_minor(op) = 500000);
  -- The recorded refund reversed after that: nothing went back, so a retry sends it once.
  PERFORM public.issue_4522_overpayment_refund_event('paystack', '9091', 'mingla-inst-' || r9::text || '-l1', 500000, 'failed');
  PERFORM public.issue_4522_resolve_overpayment_by_ops(op, 'retry', '4522c300-0000-4000-8000-000000000001');
  v := public.issue_4522_begin_overpayment_refund(op, 1, true);
  PERFORM pg_temp.check('T6-4 ... with the extra failed and the recorded one reversed, a retry sends the 500,000 owed once',
    v->>'action' = 'create' AND (v->>'amountMinor')::bigint = 500000, v::text);
END
$t$;

-- ── Rework 7: a second-provider create is sent once. Unconfirmed after the
--    in-flight ceiling it goes to ops once; only an ops retry sends again ──
DO $t$
DECLARE
  op uuid; v jsonb; v_raised boolean;
  u1 uuid := '4522c300-0000-4000-8000-0000000000c1';
  u2 uuid := '4522c300-0000-4000-8000-0000000000c2';
  u3 uuid := '4522c300-0000-4000-8000-0000000000c3';
BEGIN
  op := pg_temp.ng_overpayment(u1, 500000);
  PERFORM public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'unknown', NULL, 'connection reset');
  UPDATE public.order_overpayment_refund_attempts SET created_at = now() - interval '23 hours', updated_at = now() - interval '10 minutes'
   WHERE overpayment_id = op;
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('rework 7 an unanswered second-provider refund inside the ceiling is only checked, no alert',
    v->>'action' = 'verify' AND v->>'alertOps' = 'false' AND (pg_temp.op(op)).state = 'refund_pending'
    AND pg_temp.n_attempts(op) = 1, v::text);
  v_raised := false;
  BEGIN
    PERFORM public.issue_4522_resolve_overpayment_by_ops(op, 'retry', '4522c300-0000-4000-8000-000000000001');
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_raised := true;
  END;
  PERFORM pg_temp.check('rework 7 ... ops retry is refused before ops was told it is unconfirmed', v_raised);
  UPDATE public.order_overpayment_refund_attempts SET created_at = now() - interval '25 hours' WHERE overpayment_id = op;
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('rework 7 ... past 24 hours unseen: ops once (provider_refund_unconfirmed), still only checked',
    v->>'action' = 'verify' AND (v->>'alertOps')::boolean AND v->>'alertKind' = 'provider_refund_unconfirmed'
    AND v->'attempts'->0->>'createdAt' IS NOT NULL
    AND (pg_temp.op(op)).state = 'needs_ops' AND (pg_temp.op(op)).needs_ops_reason = 'provider_refund_unconfirmed'
    AND public.issue_4522_row_payout_blocked((pg_temp.op(op)).installment_id) AND pg_temp.n_attempts(op) = 1, v::text);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'unknown', NULL, 'not_listed_yet');
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true, now() + interval '3 minutes');
  PERFORM pg_temp.check('rework 7 ... never alerted twice, still due for a check, never a new attempt',
    v->>'action' = 'verify' AND v->>'alertOps' = 'false' AND pg_temp.n_attempts(op) = 1
    AND jsonb_array_length(public.issue_4522_overpayments_due(u1, now(), 5)) = 1, v::text);
  v_raised := false;
  BEGIN
    PERFORM public.issue_4522_resolve_overpayment_by_ops(op, 'refunded_by_hand', '4522c300-0000-4000-8000-000000000001', 'manual-u1');
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_raised := true;
  END;
  PERFORM pg_temp.check('rework 7 ... refunded_by_hand stays refused while it is unconfirmed', v_raised);
  v := public.issue_4522_resolve_overpayment_by_ops(op, 'retry', '4522c300-0000-4000-8000-000000000001');
  PERFORM pg_temp.check('rework 7 ... ops retry (no refund in the dashboard) closes it as never created and restarts the lane',
    (pg_temp.op(op)).state = 'held' AND NOT ((pg_temp.op(op)).detail ? 'unconfirmed_alerted_at')
    AND (SELECT state FROM public.order_overpayment_refund_attempts WHERE overpayment_id = op AND attempt_no = 1) = 'failed', v::text);
  v := public.issue_4522_begin_overpayment_refund(op);
  PERFORM pg_temp.check('rework 7 ... the lane re-reads the charge''s refunds before anything new', v->>'action' = 'reconcile', v::text);
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('rework 7 ... then exactly one new attempt for the 500,000 owed',
    v->>'action' = 'create' AND (v->>'attemptNo')::int = 2 AND (v->>'amountMinor')::bigint = 500000, v::text);

  -- It existed after all: listed (or its webhook) with our merchant note: adopted, back with the lane.
  op := pg_temp.ng_overpayment(u2, 500000);
  PERFORM public.issue_4522_begin_overpayment_refund(op, NULL, true);
  UPDATE public.order_overpayment_refund_attempts SET created_at = now() - interval '25 hours', updated_at = now() - interval '10 minutes'
   WHERE overpayment_id = op;
  PERFORM public.issue_4522_begin_overpayment_refund(op, NULL, true);
  v := public.issue_4522_finish_overpayment_refund(op, 1, 'pending', 'rfd_u2');
  PERFORM pg_temp.check('rework 7 an unconfirmed refund the provider then shows is adopted and back with the lane',
    (pg_temp.op(op)).state = 'refund_pending' AND (pg_temp.op(op)).needs_ops_reason IS NULL
    AND NOT ((pg_temp.op(op)).detail ? 'unconfirmed_alerted_at'), v::text);
  PERFORM public.issue_4522_overpayment_refund_event('paystack', 'rfd_u2', 'mingla-inst-' || u2::text || '-l1', 500000, 'succeeded');
  PERFORM pg_temp.check('rework 7 ... it completes: refunded once, payout released',
    (pg_temp.op(op)).state = 'refunded' AND pg_temp.n_attempts(op) = 1
    AND NOT public.issue_4522_row_payout_blocked((pg_temp.op(op)).installment_id));

  -- The first provider keeps its same-key re-send: no unconfirmed hand-off there.
  op := pg_temp.overpaid(u3);
  PERFORM public.issue_4522_begin_overpayment_refund(op, NULL, true);
  UPDATE public.order_overpayment_refund_attempts SET created_at = now() - interval '25 hours', updated_at = now() - interval '10 minutes'
   WHERE overpayment_id = op;
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('rework 7 the first provider is unchanged: verified (list after the key window), no hand-off',
    v->>'action' = 'verify' AND v->>'alertOps' = 'false' AND (pg_temp.op(op)).state = 'refund_pending', v::text);
END
$t$;

-- ── T7-2 / T7-4: ops retry after a refund past the amount ──────────────
--   T7-2 refused while an EXTRA refund is still pending (it is re-read on
--        the charge meanwhile); T7-4 a total that counts an extra refund is
--        trusted only after the provider was asked again.
DO $t$
DECLARE
  op uuid; v jsonb; v_raised boolean := false;
  x4 uuid := '4522c300-0000-4000-8000-0000000000c4';
  x5 uuid := '4522c300-0000-4000-8000-0000000000c5';
BEGIN
  op := pg_temp.ng_overpayment(x4, 500000);
  PERFORM public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'pending', '9141');
  PERFORM public.issue_4522_overpayment_refund_event('paystack', '9142', 'mingla-inst-' || x4::text || '-l1', 500000,
    'pending', op, 1, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'failed', '9141', 'refund.failed');
  BEGIN
    PERFORM public.issue_4522_resolve_overpayment_by_ops(op, 'retry', '4522c300-0000-4000-8000-000000000001');
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_raised := true;
  END;
  PERFORM pg_temp.check('T7-2 ops retry is refused (PT409) while an extra refund is still pending at the provider',
    v_raised AND (pg_temp.op(op)).state = 'needs_ops');
  UPDATE public.order_overpayments SET updated_at = now() - interval '10 minutes' WHERE id = op;
  PERFORM pg_temp.check('T7-2 ... it stays due for a re-read of the charge',
    public.issue_4522_overpayments_due(NULL, now(), 1000) @> jsonb_build_array(jsonb_build_object('overpaymentId', op)));
  v := public.issue_4522_begin_overpayment_refund(op);
  PERFORM pg_temp.check('T7-2 ... the lane re-reads the charge (reconcile), then waits 5 minutes',
    v->>'action' = 'reconcile' AND pg_temp.n_attempts(op) = 1
    AND NOT public.issue_4522_overpayments_due(NULL, now() + interval '1 minute', 1000) @> jsonb_build_array(jsonb_build_object('overpaymentId', op))
    AND public.issue_4522_begin_overpayment_refund(op, NULL, true)->>'reason' = 'needs_ops', v::text);
  PERFORM public.issue_4522_overpayment_refund_event('paystack', '9142', 'mingla-inst-' || x4::text || '-l1', 500000,
    'succeeded', op, 1, true);
  v := public.issue_4522_resolve_overpayment_by_ops(op, 'retry', '4522c300-0000-4000-8000-000000000001');
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM pg_temp.check('T7-2 ... once it completed, retry closes it with nothing new sent',
    (pg_temp.op(op)).state = 'refunded'
    AND (SELECT count(*) FROM public.order_overpayment_refund_attempts WHERE overpayment_id = op AND origin = 'mingla') = 1, v::text);

  -- T7-4: the extra succeeded, the recorded failed, the provider then reversed the extra (webhook lost).
  op := pg_temp.ng_overpayment(x5, 500000);
  PERFORM public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'pending', '9151');
  PERFORM public.issue_4522_overpayment_refund_event('paystack', '9152', 'mingla-inst-' || x5::text || '-l1', 500000,
    'succeeded', op, 1, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'failed', '9151', 'refund.failed');
  PERFORM public.issue_4522_resolve_overpayment_by_ops(op, 'retry', '4522c300-0000-4000-8000-000000000001');
  v := public.issue_4522_begin_overpayment_refund(op);
  PERFORM pg_temp.check('T7-4 a retry whose total counts an extra refund asks the provider first, never closes on the stored total',
    v->>'action' = 'reconcile' AND (pg_temp.op(op)).state = 'held', v::text);
  -- the provider's list shows the extra refund reversed
  PERFORM public.issue_4522_overpayment_refund_event('paystack', '9152', 'mingla-inst-' || x5::text || '-l1', 500000,
    'failed', op, 1, true);
  v := public.issue_4522_begin_overpayment_refund(op, 1, true);
  PERFORM pg_temp.check('T7-4 ... it was reversed: the 500,000 owed is sent once',
    v->>'action' = 'create' AND (v->>'amountMinor')::bigint = 500000 AND public.issue_4522_overpayment_back_minor(op) = 0, v::text);
END
$t$;

-- ── T3-3: a $300 charge on a row grown to $450 ─────────────────────────
DO $t$
DECLARE
  o uuid := '4522c300-0000-4000-8000-0000000000d1';
  v_row uuid; v jsonb; v_new uuid;
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source, installment_plan_root, payment_plan_terms, stripe_payment_intent_id)
  VALUES (o, '4522c300-0000-4000-8000-000000000021', '4522c300-0000-4000-8000-000000000002',
    'r3-buyer@example.test', 'R3 Buyer', '+2348000045233', 30000, 'USD', 'online_card', 'paid', 'online_checkout', true,
    '{"v":2,"flex_enabled":true,"min_payment_minor":1000,"auto_adjust":true,"deposit_minor":30000}', 'pi_dep_d1');
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, ticket_type_id, addon_portion_minor, referral_share_minor, planned_application_fee_cents)
  VALUES (o, 1, 45000, 'USD', now() - interval '1 hour', 'scheduled', 'stripe', 'auto_card', '4522c300-0000-4000-8000-000000000040', 9000, 4500, 2025),
         (o, 2, 45000, 'USD', now() + interval '30 days', 'scheduled', 'stripe', 'auto_card', '4522c300-0000-4000-8000-000000000040', 0, 0, 2025);
  v_row := (SELECT id FROM public.order_installments WHERE order_id = o AND ordinal = 1);
  -- the webhook marks it collected; the provider collected $300
  UPDATE public.order_installments SET status = 'collected', collected_at = now(), stripe_payment_intent_id = 'pi_d1_row1'
   WHERE id = v_row;
  v := public.issue_4522_record_short_collection(v_row, 30000, 'pi_d1_row1');
  v_new := (v->>'reopenedInstallmentId')::uuid;
  PERFORM pg_temp.check('T3-3 the row records the $300 collected and $150 is re-opened',
    (v->>'shortMinor')::bigint = 15000
    AND (SELECT amount_cents FROM public.order_installments WHERE id = v_row) = 30000
    AND (SELECT amount_cents || ':' || status || ':' || kind FROM public.order_installments WHERE id = v_new) = '15000:scheduled:scheduled'
    AND (SELECT due_at FROM public.order_installments WHERE id = v_new) = (SELECT due_at FROM public.order_installments WHERE id = v_row), v::text);
  PERFORM pg_temp.check('T3-3 add-on part, referral share and planned fee split, nothing lost',
    (SELECT sum(addon_portion_minor) FROM public.order_installments WHERE id IN (v_row, v_new)) = 9000
    AND (SELECT sum(referral_share_minor) FROM public.order_installments WHERE id IN (v_row, v_new)) = 4500
    AND (SELECT sum(planned_application_fee_cents) FROM public.order_installments WHERE id IN (v_row, v_new)) = 2025);
  v := public.issue_4522_balance(o);
  PERFORM pg_temp.check('T3-3 paid counts money actually collected ($300 + $300), $600 still owed',
    (v->>'paidMinor')::bigint = 60000 AND (v->>'remainingMinor')::bigint = 60000 AND (v->>'totalMinor')::bigint = 120000, v::text);
  PERFORM pg_temp.check('T3-3 never paid in full while money is owed',
    NOT public.issue_4522_claim_paid_in_full_notice(o, 'test'));
  v := public.issue_4522_compute_refund_for_cancel_as(o, now(), 'buyer');
  PERFORM pg_temp.check('T3-3 a cancel refunds on money collected ($600 paid, 50% = $300)',
    (v->>'paid_total_cents')::bigint = 60000 AND (v->>'refund_total_cents')::bigint = 30000, v::text);
  PERFORM pg_temp.check('T3-3 a replay re-opens nothing more',
    (public.issue_4522_record_short_collection(v_row, 30000, 'pi_d1_row1')->>'shortMinor')::bigint = 0
    AND (SELECT count(*) FROM public.order_installments WHERE order_id = o) = 3);
END
$t$;

-- ── T3-4: an overpayment refund reverses no referral share ─────────────
INSERT INTO public.referral_offers(id, brand_id, name, audience, scope_kind, reward_kind, share_bps, budget_minor,
  currency, starts_at, status, buyer_discount_id, created_by)
VALUES ('4522c300-0000-4000-8000-000000000030', '4522c300-0000-4000-8000-000000000012', 'R3 referral offer', 'both', 'brand',
  'cash', 1000, 100000000, 'NGN', '2026-01-01T00:00:00Z', 'active', NULL, '4522c300-0000-4000-8000-000000000001');
INSERT INTO public.referral_members(id, offer_id, brand_id, role, user_id, email_norm, display_name, link_slug, code, status,
  last_listing_kind, last_listing_id)
VALUES ('4522c300-0000-4000-8000-000000000051', '4522c300-0000-4000-8000-000000000030', '4522c300-0000-4000-8000-000000000012',
  'buyer', NULL, 'r3-referrer@example.test', 'R3 Referrer', 'r3refone', 'R3REFONE', 'active',
  'event', '4522c300-0000-4000-8000-000000000022');
-- NGN 1,200,000 eligible, 10% share = NGN 120,000.
CREATE FUNCTION pg_temp.share(p_order uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO public.order_attributions(order_kind, order_id, brand_id, source, member_id, offer_id, eligible_minor,
    share_bps, share_minor)
  VALUES ('ticket', p_order, '4522c300-0000-4000-8000-000000000012', 'code', '4522c300-0000-4000-8000-000000000051',
    '4522c300-0000-4000-8000-000000000030', 120000000, 1000, 12000000);
  INSERT INTO public.payee_shares(order_kind, order_id, payee_kind, member_id, payee_email_norm, brand_id, rail, currency,
    gross_minor, mingla_fee_minor, net_minor, status, release_after)
  VALUES ('ticket', p_order, 'referral', '4522c300-0000-4000-8000-000000000051', 'r3-referrer@example.test',
    '4522c300-0000-4000-8000-000000000012', 'paystack', 'NGN', 12000000, 600000, 11400000, 'held_until_event',
    now() + interval '30 days')
  RETURNING id INTO v;
  RETURN v;
END $$;
CREATE FUNCTION pg_temp.policy_refund(p_order uuid, p_amount bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO public.refunds (order_id, amount_cents, reason, status, currency, metadata)
  VALUES (p_order, p_amount, 'Traveler cancelled the trip (policy)', 'pending', 'NGN', '{"kind":"r3_policy"}')
  RETURNING id INTO v;
  UPDATE public.refunds SET status = 'succeeded', processed_at = now() WHERE id = v;
END $$;

DO $t$
DECLARE
  o_over uuid := '4522c300-0000-4000-8000-0000000000e1';
  o_plain uuid := '4522c300-0000-4000-8000-0000000000e2';
  s_over uuid; s_plain uuid; op uuid; v jsonb;
BEGIN
  -- NGN 1,200,000 trip, NGN 120,000 referral share; NGN 100,000 overpayment.
  op := pg_temp.ng_overpayment(o_over, 10000000);
  PERFORM pg_temp.ng_overpayment(o_plain, 1) ; -- same order shape; its NGN 0.01 hold is irrelevant here
  DELETE FROM public.order_overpayments WHERE order_id = o_plain;
  s_over := pg_temp.share(o_over);
  s_plain := pg_temp.share(o_plain);
  v := public.issue_4522_begin_overpayment_refund(op, NULL, true);
  PERFORM public.issue_4522_finish_overpayment_refund(op, 1, 'succeeded', 'rfd_over_1');
  PERFORM pg_temp.check('T3-4 the NGN 100,000 overpayment refund succeeded', (pg_temp.op(op)).state = 'refunded');
  PERFORM pg_temp.check('T3-4 it reversed NGN 0 of the referral share',
    (SELECT reversed_minor FROM public.payee_shares WHERE id = s_over) = 0
    AND NOT EXISTS (SELECT 1 FROM public.payee_share_reversals WHERE share_id = s_over));
  PERFORM pg_temp.policy_refund(o_over, 60000000);
  PERFORM pg_temp.policy_refund(o_plain, 60000000);
  PERFORM pg_temp.check('T3-4 a later 50% policy refund reverses exactly what it does with no overpayment (NGN 60,000)',
    (SELECT reversed_minor FROM public.payee_shares WHERE id = s_over) = 6000000
    AND (SELECT reversed_minor FROM public.payee_shares WHERE id = s_plain) = 6000000,
    (SELECT reversed_minor FROM public.payee_shares WHERE id = s_over)::text || ' vs '
    || (SELECT reversed_minor FROM public.payee_shares WHERE id = s_plain)::text);
END
$t$;

-- ── T3-5: "abandoned" is not final on its own ──────────────────────────
DO $t$
DECLARE
  o uuid := '4522c300-0000-4000-8000-0000000000f1';
  v jsonb; v_flex uuid;
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source, installment_plan_root, payment_plan_terms, stripe_payment_intent_id)
  VALUES (o, '4522c300-0000-4000-8000-000000000022', '4522c300-0000-4000-8000-000000000002',
    'r3-buyer@example.test', 'R3 Buyer', '+2348000045233', 30000000, 'NGN', 'online_card', 'paid', 'online_checkout', true,
    '{"v":2,"flex_enabled":true,"min_payment_minor":100000,"auto_adjust":true,"deposit_minor":30000000}', 'ps_dep_f1');
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, buyer_total_cents, plan_bound_at)
  VALUES (o, 1, 90000000, 'NGN', now() + interval '30 days', 'scheduled', 'paystack', 'pay_link', 91800000, now());
  v := public.issue_4522_begin_flex_payment(o, 90000000, 90000000, 'r3-abandoned-1', 'pay_link', now() - interval '30 hours');
  v_flex := (v->>'installmentId')::uuid;
  INSERT INTO public.order_installment_charge_attempts(installment_id, provider, attempt_no, method, reference, state,
    amount_cents, application_fee_cents, created_at)
  -- the reconcile closed the attempt (superseded); Paystack still says "abandoned"
  VALUES (v_flex, 'paystack', 1, 'pay_link', 'mingla-inst-' || v_flex || '-l1', 'superseded', 91800000, 0, now() - interval '2 hours');
  v := public.issue_4522_release_flex_verified(v_flex, 'provider_abandoned', 'mingla-inst-' || v_flex || '-l1');
  PERFORM pg_temp.check('T3-5 an abandoned checkout 2 hours old is not released',
    v->>'reason' = 'abandoned_not_final'
    AND (SELECT status FROM public.order_installments WHERE id = v_flex) = 'scheduled', v::text);
  UPDATE public.order_installment_charge_attempts SET created_at = now() - interval '25 hours' WHERE installment_id = v_flex;
  v := public.issue_4522_release_flex_verified(v_flex, 'provider_abandoned', 'mingla-inst-' || v_flex || '-l1');
  PERFORM pg_temp.check('T3-5 ... released once it is 24 hours old', (v->>'released')::boolean
    AND (SELECT failure_reason FROM public.order_installments WHERE id = v_flex) = 'flex_released:provider_abandoned', v::text);
END
$t$;

-- ── T3-10 (#3281): add-ons sent while RSVP add-ons are off ─────────────
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency, published_at,
  rsvp_allow_plus_ones, rsvp_plus_ones_max)
VALUES ('4522c300-0000-4000-8000-000000000023', '4522c300-0000-4000-8000-000000000011', '4522c300-0000-4000-8000-000000000001',
  'R3 rsvp', 'r3-rsvp', 'rsvp', 'scheduled', 'public', 'UTC', 'USD', now(), true, 3);
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
VALUES ('4522c300-0000-4000-8000-000000000023', now() - interval '1 hour', now() + interval '2 hours', 'UTC', true);
DO $t$
DECLARE v jsonb; v_err text;
BEGIN
  BEGIN
    v := public.issue_3281_submit_rsvp_with_add_ons('4522c300-0000-4000-8000-000000000023', NULL,
      'R3 Guest', 'r3-guest@example.test', '+15554522301', 'going', 0, '[]', NULL, 'US', false, NULL,
      '[{"addOnId":"4522c300-0000-4000-8000-0000000000ff","quantity":1}]');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  PERFORM pg_temp.check('T3-10 with the switch off the wrapper refuses the add-ons (and undoes its RSVP)',
    v_err = 'rsvp_add_ons_unavailable'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvps WHERE event_id = '4522c300-0000-4000-8000-000000000023'), v_err);
  -- ... so the edge submits the same RSVP plainly: it is saved.
  v := public.submit_event_rsvp_with_form('4522c300-0000-4000-8000-000000000023', NULL,
    'R3 Guest', 'r3-guest@example.test', '+15554522301', 'going', 0, '[]', NULL, 'US', false, NULL);
  PERFORM pg_temp.check('T3-10 the plain submit saves the RSVP', v->>'rsvpId' IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.event_rsvps WHERE id = (v->>'rsvpId')::uuid), v::text);
END
$t$;

-- Closed to client roles.
DO $t$
BEGIN
  PERFORM pg_temp.check('order_overpayment_refund_attempts is closed to every client role and to direct service_role access',
    NOT has_table_privilege('anon', 'public.order_overpayment_refund_attempts', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.order_overpayment_refund_attempts', 'SELECT')
    AND NOT has_table_privilege('service_role', 'public.order_overpayment_refund_attempts', 'INSERT')
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.order_overpayment_refund_attempts'::regclass));
  PERFORM pg_temp.check('the new lane functions: service role only',
    NOT has_function_privilege('authenticated', 'public.issue_4522_overpayment_refund_event(text, text, text, bigint, text, uuid, integer, boolean, timestamptz)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4522_resolve_overpayment_by_ops(uuid, text, uuid, text, text, timestamptz)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4522_record_short_collection(uuid, bigint, text, timestamptz)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.issue_4522_apply_overpayment_attempt_outcome(uuid, text, text, text, timestamptz)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.issue_4522_overpayment_refund_event(text, text, text, bigint, text, uuid, integer, boolean, timestamptz)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.issue_4522_begin_overpayment_refund(uuid, integer, boolean, timestamptz)', 'EXECUTE'));
END
$t$;

ROLLBACK;
