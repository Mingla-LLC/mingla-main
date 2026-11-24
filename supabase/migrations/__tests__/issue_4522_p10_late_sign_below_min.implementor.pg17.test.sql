-- MINGLA-INVARIANT: I-4522-OWED-PART-NEVER-PAID-TWICE | issue #4522 | An owed part of a trip cancel (the policy amount a counted seat or add-on refund left unpaid when it failed) is sent only while that refund shows no sign of having been made, re-checked under its row lock immediately before the send; a late sign holds an unsent part (withdrawn, told once) or flags a sent one (overlap, told once); a part below the provider minimum is never sent and waits for staff; nothing is ever written off.
\set ON_ERROR_STOP on

-- Issue #4522 pass 10 (20281202084522). Rolled back. Paystack brand, 50% tier,
-- N1,000,000 charge, a N500,000 seat refund counted by the cancel (cancel asks
-- N250,000), then refused -> 'failed' -> owed part N250,000.
--   L-1  P10-1 the provider makes the seat refund late (the refund webhook
--        records its attempt processed with a provider id): the seat refund is
--        recorded as made, the unsent owed part is withdrawn, the send claim
--        is refused, ops are told once that it was withdrawn. Provider total
--        = N750,000 = policy.
--   L-2  P10-1 the late sign arrives AFTER the owed part was claimed for the
--        send: one overlap alert, nothing withdrawn or written off.
--   L-3  P10-1 pre-send re-check alone (the late-sign trigger disabled): a
--        seat attempt sent with no answer makes the claim refuse and hold.
--   L-4  P10-1 card: a late buyer refund on the failed seat refund's card
--        attempt holds the unsent owed part (refunds row cancelled, so the
--        #4271 gate never lets it reach the provider).
--   B-1  P10-3 an owed part below Paystack's NGN 50 minimum (N30): recorded,
--        never claimed, never resumed; told as below the minimum; listed in
--        Refund operations (admin only) with paid outside Paystack or
--        escalate; paid outside Paystack needs a reference and a reason, is
--        audited and idempotent, records exactly N30, stops the wait, and the
--        cancel completes with the payout hold settled.
-- FAILS ON REVERT: without the late-sign trigger L-1 claims the owed part (true);
-- without the pre-send re-check L-3 claims it; without the below-minimum rule
-- B-1 finds no awaiting_staff mark and the claim returns true.

BEGIN;

CREATE FUNCTION pg_temp.raised(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;

CREATE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
END $$;

INSERT INTO auth.users(id, email) VALUES
  ('4522a010-0000-4000-8000-000000000001', 'p10l-host@example.test'),
  ('4522a010-0000-4000-8000-000000000002', 'p10l-staff@example.test'),
  ('4522a010-0000-4000-8000-000000000003', 'p10l-stranger@example.test');
INSERT INTO public.admin_users(email, role, status) VALUES ('p10l-staff@example.test', 'admin', 'active');
INSERT INTO public.creator_accounts(id, email) VALUES ('4522a010-0000-4000-8000-000000000001', 'p10l-host@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country) VALUES
  ('4522a010-0000-4000-8000-000000000010', '4522a010-0000-4000-8000-000000000001', 'P10 NG', 'p10l-ng-4522', 'NGN', 'paystack', 'NG'),
  ('4522a010-0000-4000-8000-000000000011', '4522a010-0000-4000-8000-000000000001', 'P10 US', 'p10l-us-4522', 'USD', 'stripe', 'US');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency, refund_policy) VALUES
  ('4522a010-0000-4000-8000-000000000020', '4522a010-0000-4000-8000-000000000010', '4522a010-0000-4000-8000-000000000001',
   'Half tier NG', 'p10l-half-ng', 'trip', 'scheduled', 'public', 'Africa/Lagos', 'NGN',
   '{"kind":"standard","tiers":[{"days_before_start":0,"refund_pct":50}]}'),
  ('4522a010-0000-4000-8000-000000000021', '4522a010-0000-4000-8000-000000000011', '4522a010-0000-4000-8000-000000000001',
   'Half tier US', 'p10l-half-us', 'trip', 'scheduled', 'public', 'America/New_York', 'USD',
   '{"kind":"standard","tiers":[{"days_before_start":0,"refund_pct":50}]}'),
  ('4522a010-0000-4000-8000-000000000022', '4522a010-0000-4000-8000-000000000010', '4522a010-0000-4000-8000-000000000001',
   'Tiny NG', 'p10l-tiny-ng', 'trip', 'scheduled', 'public', 'Africa/Lagos', 'NGN',
   '{"kind":"standard","tiers":[{"days_before_start":0,"refund_pct":30}]}');
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
SELECT id, now() + interval '100 days', now() + interval '103 days', timezone, true
  FROM public.events WHERE id IN ('4522a010-0000-4000-8000-000000000020', '4522a010-0000-4000-8000-000000000021',
                                  '4522a010-0000-4000-8000-000000000022');

CREATE TEMP TABLE p10 (tag text PRIMARY KEY, order_id uuid, seat uuid, cancel_id uuid, owed uuid);

-- One cancel counting its pending seat refund, then the seat refund refused.
CREATE FUNCTION pg_temp.cancel_then_fail(p_tag text, p_n integer, p_event uuid, p_total integer, p_seat integer,
  p_cur text, p_paystack boolean) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_o uuid := ('4522a010-0000-4000-8000-0000000001' || lpad(p_n::text, 2, '0'))::uuid;
        v_s uuid := ('4522a010-0000-4000-8000-0000000002' || lpad(p_n::text, 2, '0'))::uuid;
        v_b jsonb; v_c uuid;
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, currency,
    payment_method, payment_status, source, installment_plan_root, stripe_payment_intent_id)
  VALUES (v_o, p_event, 'p10l-buyer@example.test', 'P10 Buyer', '+2348030000000', p_total, p_cur,
    'online_card', 'paid', 'online_checkout', false, 'mingla_p10l_' || p_n);
  INSERT INTO public.refunds(id, order_id, amount_cents, currency, status, reason)
  VALUES (v_s, v_o, p_seat, p_cur, 'pending', 'Host seat refund');
  IF p_paystack THEN
    INSERT INTO public.paystack_refund_attempts(source_type, source_id, local_refund_id, transaction_reference,
      merchant_note, amount_cents, currency, status, idempotency_key)
    VALUES ('order', v_o, v_s, 'mingla_p10l_' || p_n, 'mingla_refund:' || v_s::text, p_seat, 'ngn', 'pending',
      'p10l-seat-' || p_n);
  END IF;
  v_b := public.biz_cancel_trip_booking_begin(v_o, 'operator', '4522a010-0000-4000-8000-000000000001', 'Host cancelled');
  v_c := (v_b->>'refund_id')::uuid;
  IF p_paystack THEN
    UPDATE public.paystack_refund_attempts SET status = 'failed', error_message = 'refused' WHERE local_refund_id = v_s;
  END IF;
  UPDATE public.refunds SET status = 'failed' WHERE id = v_s;
  INSERT INTO p10 VALUES (p_tag, v_o, v_s, v_c,
    md5('issue_4522_trip_cancel_shortfall:' || v_c::text || ':' || v_s::text)::uuid);
END $$;

-- L-1. Late processed seat refund before the owed part is sent.
DO $$
DECLARE r p10; v_claim jsonb; v_ok boolean; v_entry jsonb;
BEGIN
  PERFORM pg_temp.cancel_then_fail('l1', 1, '4522a010-0000-4000-8000-000000000020', 100000000, 50000000, 'NGN', true);
  SELECT * INTO r FROM p10 WHERE tag = 'l1';
  IF (SELECT status || ':' || amount_cents FROM public.refunds WHERE id = r.owed) <> 'pending:25000000' THEN
    RAISE EXCEPTION 'L-1 setup: an unheld owed part of 25000000';
  END IF;
  v_claim := public.issue_4522_claim_trip_cancel_shortfalls(50);  -- the first alert ("being sent") goes
  -- the refund webhook records the provider's late answer on the seat refund's attempt
  PERFORM public.record_paystack_refund_outcome('order', r.order_id, r.seat, 'mingla_p10l_1',
    'mingla_refund:' || r.seat::text, 'PSREF-P10L-1', 50000000, 'processed', NULL);
  IF (SELECT status || ':' || COALESCE(stripe_refund_id, '') FROM public.refunds WHERE id = r.seat) <> 'succeeded:PSREF-P10L-1' THEN
    RAISE EXCEPTION 'L-1a the late answer reaches the seat refund: %', (SELECT row_to_json(x) FROM public.refunds x WHERE id = r.seat);
  END IF;
  v_ok := public.issue_4522_claim_trip_paystack_send(r.owed, 'mingla_trip_refund:' || r.owed::text || ':deposit');
  IF v_ok OR (SELECT status FROM public.refunds WHERE id = r.owed) <> 'cancelled'
     OR (SELECT error_message FROM public.paystack_refund_attempts WHERE local_refund_id = r.owed) <> 'shortfall_withdrawn_refund_succeeded' THEN
    RAISE EXCEPTION 'L-1b the unsent owed part is withdrawn, never sent (claim %)', v_ok;
  END IF;
  v_claim := public.issue_4522_claim_trip_cancel_shortfalls(50);
  SELECT x INTO v_entry FROM jsonb_array_elements(v_claim) x WHERE (x->>'cancel_refund_id')::uuid = r.cancel_id;
  IF v_entry->>'kind' <> 'late_held' OR v_entry->>'late_held_reason' <> 'seat_refund_recorded_made'
     OR jsonb_array_length(public.issue_4522_claim_trip_cancel_shortfalls(50)) <> 0 THEN
    RAISE EXCEPTION 'L-1c ops are told once that it was withdrawn: %', v_claim;
  END IF;
  -- provider total = seat 50M + cancel 25M = 75M = 50% policy on 100M + 50% of the seat's 50M... = the policy
  IF (SELECT refunded_amount_cents FROM public.orders WHERE id = r.order_id) <> 50000000 THEN
    RAISE EXCEPTION 'L-1d the order shows the seat refund made: %', (SELECT refunded_amount_cents FROM public.orders WHERE id = r.order_id);
  END IF;
END $$;

-- L-2. Late processed seat refund after the owed part was claimed for sending.
DO $$
DECLARE r p10; v_claim jsonb; v_entry jsonb;
BEGIN
  PERFORM pg_temp.cancel_then_fail('l2', 2, '4522a010-0000-4000-8000-000000000020', 100000000, 50000000, 'NGN', true);
  SELECT * INTO r FROM p10 WHERE tag = 'l2';
  PERFORM public.issue_4522_claim_trip_cancel_shortfalls(50);
  IF NOT public.issue_4522_claim_trip_paystack_send(r.owed, 'mingla_trip_refund:' || r.owed::text || ':deposit') THEN
    RAISE EXCEPTION 'L-2 setup: the owed part is claimed for the send';
  END IF;
  PERFORM public.record_paystack_refund_outcome('order', r.order_id, r.seat, 'mingla_p10l_2',
    'mingla_refund:' || r.seat::text, 'PSREF-P10L-2', 50000000, 'processed', NULL);
  IF (SELECT status FROM public.refunds WHERE id = r.owed) <> 'pending' THEN
    RAISE EXCEPTION 'L-2a a part possibly sent is never withdrawn';
  END IF;
  v_claim := public.issue_4522_claim_trip_cancel_shortfalls(50);
  SELECT x INTO v_entry FROM jsonb_array_elements(v_claim) x WHERE (x->>'cancel_refund_id')::uuid = r.cancel_id;
  IF v_entry->>'kind' <> 'overlap' OR jsonb_array_length(public.issue_4522_claim_trip_cancel_shortfalls(50)) <> 0 THEN
    RAISE EXCEPTION 'L-2b one overlap alert: %', v_claim;
  END IF;
END $$;

-- L-3. The pre-send re-check on its own.
DO $$
DECLARE r p10; v_ok boolean; v_entry jsonb;
BEGIN
  PERFORM pg_temp.cancel_then_fail('l3', 3, '4522a010-0000-4000-8000-000000000020', 100000000, 50000000, 'NGN', true);
  SELECT * INTO r FROM p10 WHERE tag = 'l3';
  PERFORM public.issue_4522_claim_trip_cancel_shortfalls(50);
  ALTER TABLE public.paystack_refund_attempts DISABLE TRIGGER issue_4522_trip_cancel_late_sign;
  -- a host retry of the seat refund was sent with no answer yet
  INSERT INTO public.paystack_refund_attempts(source_type, source_id, local_refund_id, transaction_reference,
    merchant_note, amount_cents, currency, status, idempotency_key, error_message)
  VALUES ('order', r.order_id, r.seat, 'mingla_p10l_3', 'mingla_refund:' || r.seat::text || ':retry', 50000000, 'ngn',
    'pending', 'p10l-seat-3-retry', 'provider_call_started');
  ALTER TABLE public.paystack_refund_attempts ENABLE TRIGGER issue_4522_trip_cancel_late_sign;
  IF (SELECT status FROM public.refunds WHERE id = r.owed) <> 'pending' THEN RAISE EXCEPTION 'L-3 setup'; END IF;
  v_ok := public.issue_4522_claim_trip_paystack_send(r.owed, 'mingla_trip_refund:' || r.owed::text || ':deposit');
  SELECT metadata #> ARRAY['trip_cancel', 'shortfalls', r.seat::text] INTO v_entry FROM public.refunds WHERE id = r.cancel_id;
  IF v_ok OR (SELECT status FROM public.refunds WHERE id = r.owed) <> 'cancelled'
     OR v_entry->>'late_held_reason' <> 'seat_refund_sign_at_send' OR NOT (v_entry->>'held')::boolean THEN
    RAISE EXCEPTION 'L-3 held at the send: claim % entry %', v_ok, v_entry;
  END IF;
  IF (SELECT x->>'kind' FROM jsonb_array_elements(public.issue_4522_claim_trip_cancel_shortfalls(50)) x
       WHERE (x->>'cancel_refund_id')::uuid = r.cancel_id) <> 'late_held' THEN
    RAISE EXCEPTION 'L-3b ops are told it is held';
  END IF;
END $$;

-- L-4. Card: a late buyer refund on the failed seat refund.
DO $$
DECLARE r p10;
BEGIN
  PERFORM pg_temp.cancel_then_fail('l4', 4, '4522a010-0000-4000-8000-000000000021', 100000, 50000, 'USD', false);
  SELECT * INTO r FROM p10 WHERE tag = 'l4';
  IF (SELECT status || ':' || amount_cents FROM public.refunds WHERE id = r.owed) <> 'pending:25000' THEN
    RAISE EXCEPTION 'L-4 setup: a card owed part of 25000';
  END IF;
  ALTER TABLE public.ticket_refund_attempts DISABLE TRIGGER USER;
  INSERT INTO public.ticket_refund_attempts(refund_id, order_id, payment_intent_id, request_fingerprint, status,
    provider, provider_mode, requested_refund_amount_text, currency)
  SELECT r.seat, r.order_id, 'mingla_p10l_4', 'p10l-fp-4', 'awaiting_application_fee', 'stripe', 'test', '50000', 'usd';
  ALTER TABLE public.ticket_refund_attempts ENABLE TRIGGER USER;
  UPDATE public.ticket_refund_attempts SET status = 'pending_visibility', buyer_refund_id = 're_p10l_4' WHERE refund_id = r.seat;
  IF (SELECT status FROM public.refunds WHERE id = r.owed) <> 'cancelled'
     OR NOT (SELECT (metadata #>> ARRAY['trip_cancel', 'shortfalls', r.seat::text, 'held'])::boolean
               FROM public.refunds WHERE id = r.cancel_id) THEN
    RAISE EXCEPTION 'L-4 the unsent card owed part is held';
  END IF;
END $$;

-- B-1. An owed part below the provider minimum.
DO $$
DECLARE r p10; v_entry jsonb; v_att uuid; v_list jsonb; v_err text; v_res jsonb;
BEGIN
  -- 30% tier, N300 paid, N100 seat counted: cancel asks 30% x N200 = N60; the
  -- seat refused -> owed 30% x N300 - N60 = N30 (3000 kobo) < N50.
  PERFORM pg_temp.cancel_then_fail('b1', 5, '4522a010-0000-4000-8000-000000000022', 30000, 10000, 'NGN', true);
  SELECT * INTO r FROM p10 WHERE tag = 'b1';
  SELECT id INTO v_att FROM public.paystack_refund_attempts WHERE local_refund_id = r.owed;
  IF (SELECT status || ':' || amount_cents || ':' || COALESCE(metadata #>> '{trip_cancel,awaiting_staff}', '')
        FROM public.refunds WHERE id = r.owed) <> 'pending:3000:below_provider_minimum'
     OR (SELECT error_message FROM public.paystack_refund_attempts WHERE id = v_att) <> 'below_provider_minimum' THEN
    RAISE EXCEPTION 'B-1a the N30 owed part is recorded and waits for staff: %',
      (SELECT row_to_json(x) FROM public.refunds x WHERE id = r.owed);
  END IF;
  IF public.issue_4522_claim_trip_paystack_send(r.owed, 'mingla_trip_refund:' || r.owed::text || ':deposit') THEN
    RAISE EXCEPTION 'B-1b never claimed for a send';
  END IF;
  UPDATE public.orders SET cancelled_at = now() WHERE id = r.order_id;
  UPDATE public.refunds SET created_at = now() - interval '10 minutes' WHERE id = r.owed;
  IF r.order_id IN (SELECT public.issue_4522_trip_cancels_to_resume(50))
     AND (SELECT count(*) FROM public.refunds WHERE order_id = r.order_id AND status = 'pending'
            AND metadata ? 'trip_cancel' AND NOT (metadata->'trip_cancel' ? 'awaiting_staff')
            AND NOT (metadata->'trip_cancel' ? 'completed_at')) = 0 THEN
    RAISE EXCEPTION 'B-1c the resume leaves the waiting part alone';
  END IF;
  SELECT x INTO v_entry FROM jsonb_array_elements(public.issue_4522_claim_trip_cancel_shortfalls(50)) x
   WHERE (x->>'cancel_refund_id')::uuid = r.cancel_id;
  IF v_entry->>'kind' <> 'shortfall' OR NOT (v_entry->>'below_minimum')::boolean
     OR (v_entry->>'owed_cents')::bigint <> 3000 OR (v_entry->>'provider_minimum_cents')::bigint <> 5000 THEN
    RAISE EXCEPTION 'B-1d ops are told it is below the minimum, with the exact amount: %', v_entry;
  END IF;
  PERFORM pg_temp.act_as('4522a010-0000-4000-8000-000000000003');
  v_err := pg_temp.raised('SELECT public.issue_4522_list_unanswered_trip_cancel_refunds()');
  IF v_err NOT LIKE '42501:%' THEN RAISE EXCEPTION 'B-1e admin only: %', v_err; END IF;
  PERFORM pg_temp.act_as('4522a010-0000-4000-8000-000000000002');
  v_list := public.issue_4522_list_unanswered_trip_cancel_refunds();
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) x
                  WHERE (x->>'refund_id')::uuid = r.owed AND (x->>'below_minimum_amount_cents')::bigint = 3000
                    AND x->'charges'->0->>'state' = 'below_minimum' AND (x->'charges'->0->>'actionable')::boolean
                    AND x->'charges'->0->'outcomes' = '["paid_outside_provider","escalate"]'::jsonb) THEN
    RAISE EXCEPTION 'B-1f listed in Refund operations at once: %', v_list;
  END IF;
  v_err := pg_temp.raised(format('SELECT public.issue_4522_resolve_trip_cancel_refund_by_ops(%L, %L, NULL, %L)',
    v_att, 'paid_outside_provider', 'Paid by bank transfer'));
  IF v_err NOT LIKE '%provider_refund_reference_required%' THEN RAISE EXCEPTION 'B-1g reference required: %', v_err; END IF;
  v_err := pg_temp.raised(format('SELECT public.issue_4522_resolve_trip_cancel_refund_by_ops(%L, %L, %L, %L)',
    v_att, 'paid_outside_provider', 'BANK-P10L-1', ''));
  IF v_err NOT LIKE '%reason_invalid_length%' THEN RAISE EXCEPTION 'B-1h reason required: %', v_err; END IF;
  v_res := public.issue_4522_resolve_trip_cancel_refund_by_ops(v_att, 'paid_outside_provider', ' BANK-P10L-1 ',
    'Paid the N30 by bank transfer', 3000, 'ngn');
  IF NOT (v_res->>'ok')::boolean
     OR (SELECT status || ':' || provider_refund_id || ':' || amount_cents FROM public.paystack_refund_attempts WHERE id = v_att)
        <> 'processed:BANK-P10L-1:3000'
     OR (SELECT metadata->'trip_cancel' ? 'awaiting_staff' FROM public.refunds WHERE id = r.owed)
     OR (SELECT count(*) FROM public.audit_log WHERE action = 'trip_cancel_refund.paid_outside_provider_by_ops'
           AND (after->>'refund_id')::uuid = r.owed AND after->>'provider_refund_reference' = 'BANK-P10L-1'
           AND after->>'reason' IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'B-1i recorded exactly N30, audited, no longer waiting: %', v_res;
  END IF;
  v_res := public.issue_4522_resolve_trip_cancel_refund_by_ops(v_att, 'paid_outside_provider', 'BANK-P10L-1',
    'Paid the N30 by bank transfer', 3000, 'ngn');
  IF NOT (v_res->>'idempotent_replay')::boolean
     OR (SELECT count(*) FROM public.audit_log WHERE action = 'trip_cancel_refund.paid_outside_provider_by_ops'
           AND (after->>'refund_id')::uuid = r.owed) <> 1 THEN
    RAISE EXCEPTION 'B-1j replay is a no-op: %', v_res;
  END IF;
  PERFORM pg_temp.act_as(NULL);
  IF r.order_id NOT IN (SELECT public.issue_4522_trip_cancels_to_resume(50)) THEN
    RAISE EXCEPTION 'B-1k the next run picks the cancel up to finish it';
  END IF;
  -- Everything in this file runs in one transaction, so now() is frozen and the
  -- order's other refunds all share one created_at; "the order's latest refund"
  -- (ORDER BY created_at DESC, id DESC) then fell to a random uuid and could
  -- pick the failed seat refund. In real time the owed part is created last:
  -- state that order explicitly.
  UPDATE public.refunds SET created_at = now() - interval '1 hour' WHERE order_id = r.order_id AND id <> r.owed;
  UPDATE public.refunds SET created_at = now() WHERE id = r.owed;
  v_res := public.biz_cancel_trip_booking_commit(r.owed, ARRAY['BANK-P10L-1'], 0);
  IF NOT (v_res->>'ok')::boolean OR (SELECT status FROM public.refunds WHERE id = r.owed) <> 'succeeded'
     OR public.issue_4522_cancel_refund_unsettled(r.order_id) THEN
    RAISE EXCEPTION 'B-1l the part completes and the payout hold settles: %', v_res;
  END IF;
END $$;

ROLLBACK;
