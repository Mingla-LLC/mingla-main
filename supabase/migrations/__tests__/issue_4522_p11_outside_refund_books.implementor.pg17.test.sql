-- MINGLA-INVARIANT: I-4522-OUTSIDE-REFUND-BOOKED | issue #4522 | A refund Paystack made outside Mingla's refund calls (its dashboard) that staff record on a trip cancel is booked on that charge exactly as a Mingla-made refund of the same money: the order's refunded figure, its payment status and what the host's payout item is worth equal a twin order refunded by Mingla alone; a late refund that completes the charge moves the order to 'refunded'.
\set ON_ERROR_STOP on

-- Issue #4522 pass 11 (20281202084522). Rolled back.
--   K-1  P11-1 partial: N1M charge, 100% tier. Paystack's dashboard refunded
--        N500k outside Mingla; the cancel's N1M ask was refused; staff record
--        "partly refunded already" (N500k, its reference); Mingla sends the
--        N500k left. Books, payment status and the host's payout item value
--        equal a twin whose first N500k was a Mingla seat refund.
--   K-2  P11-1 whole charge (GAP): N1M charge, 50% tier (asks N500k);
--        Paystack shows the whole N1M refunded from its dashboard. The part
--        is recorded for what it asked and the other N500k is booked too:
--        books N1M = provider, the host's item is worth 0.
--   K-3  a reference Mingla already holds is never booked twice (pass 12:
--        refused outright, the part left open).
--   K-4  P11-4: a late seat refund that completes the charge after the
--        cancel completed moves the order from partial_refund to refunded.
-- FAILS ON REVERT (20281202084522 at 7defbe7cbd): K-1 books 50000000 (not
-- 100000000) and the item is still worth 50000000 to the host; K-2 books
-- 50000000; K-4 stays partial_refund.

BEGIN;

INSERT INTO auth.users(id, email) VALUES
  ('4522b011-0000-4000-8000-000000000001', 'p11k-host@example.test'),
  ('4522b011-0000-4000-8000-000000000002', 'p11k-staff@example.test');
INSERT INTO public.admin_users(email, role, status) VALUES ('p11k-staff@example.test', 'admin', 'active');
INSERT INTO public.creator_accounts(id, email) VALUES ('4522b011-0000-4000-8000-000000000001', 'p11k-host@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country) VALUES
  ('4522b011-0000-4000-8000-000000000010', '4522b011-0000-4000-8000-000000000001', 'P11 NG', 'p11k-ng-4522', 'NGN', 'paystack', 'NG');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency, refund_policy) VALUES
  ('4522b011-0000-4000-8000-000000000020', '4522b011-0000-4000-8000-000000000010', '4522b011-0000-4000-8000-000000000001',
   'Full tier trip', 'p11k-full-4522', 'trip', 'scheduled', 'public', 'Africa/Lagos', 'NGN',
   '{"kind":"standard","tiers":[{"days_before_start":0,"refund_pct":100}]}'),
  ('4522b011-0000-4000-8000-000000000021', '4522b011-0000-4000-8000-000000000010', '4522b011-0000-4000-8000-000000000001',
   'Half tier trip', 'p11k-half-4522', 'trip', 'scheduled', 'public', 'Africa/Lagos', 'NGN',
   '{"kind":"standard","tiers":[{"days_before_start":0,"refund_pct":50}]}');
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
  ('4522b011-0000-4000-8000-000000000020', now() + interval '100 days', now() + interval '103 days', 'Africa/Lagos', true),
  ('4522b011-0000-4000-8000-000000000021', now() + interval '100 days', now() + interval '103 days', 'Africa/Lagos', true);

CREATE FUNCTION pg_temp.paid_order(p_order uuid, p_event uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, currency,
    payment_method, payment_status, source, installment_plan_root, stripe_payment_intent_id)
  VALUES (p_order, p_event, 'p11k-buyer@example.test', 'P11 Buyer', '+2348030000000', 100000000, 'NGN',
    'online_card', 'paid', 'online_checkout', false, 'mingla_p11k_' || p_order::text);
$$;
-- The provider confirms an attempt (the one recording path).
CREATE FUNCTION pg_temp.made(p_note text, p_ref text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE a public.paystack_refund_attempts;
BEGIN
  SELECT * INTO a FROM public.paystack_refund_attempts WHERE merchant_note = p_note;
  PERFORM public.record_paystack_refund_outcome(a.source_type, a.source_id, a.local_refund_id,
    a.transaction_reference, a.merchant_note, p_ref, a.amount_cents, 'processed', NULL);
END $$;
-- A cancel's ask the provider refused, actionable by staff.
CREATE FUNCTION pg_temp.refused_cancel(p_order uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE b jsonb; v_note text;
BEGIN
  b := public.biz_cancel_trip_booking_begin(p_order, 'operator', NULL, 'Host cancelled');
  v_note := 'mingla_trip_refund:' || (b->>'refund_id') || ':deposit';
  PERFORM public.issue_4522_claim_trip_paystack_send((b->>'refund_id')::uuid, v_note);
  PERFORM public.issue_4522_claim_trip_paystack_send((b->>'refund_id')::uuid, v_note, true);
  UPDATE public.paystack_refund_attempts SET updated_at = now() - interval '20 minutes' WHERE merchant_note = v_note;
  RETURN (b->>'refund_id')::uuid;
END $$;
CREATE FUNCTION pg_temp.finish(p_refund uuid, p_ref text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  r := public.biz_cancel_trip_booking_commit(p_refund, ARRAY[p_ref], 0);
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'commit %', r; END IF;
  RETURN public.issue_4522_settle_trip_cancel_status((SELECT order_id FROM public.refunds WHERE id = p_refund));
END $$;
-- What the host's payout item of the order is worth (gross N1M, fee N45k).
CREATE FUNCTION pg_temp.worth(p_order uuid) RETURNS bigint
LANGUAGE sql AS $$
  SELECT n.settled_net_cents FROM public.issue_4522_payout_item_now('order', p_order, 100000000, 0, 0, 4500000, 95500000) n;
$$;

-- K-1. Partial: dashboard N500k outside Mingla, then Mingla's N500k.
DO $$
DECLARE v_e uuid := '4522b011-0000-4000-8000-0000000000e1'; v_t uuid := '4522b011-0000-4000-8000-0000000000f1';
        v_seat uuid := '4522b011-0000-4000-8000-0000000000f2'; v_re uuid; v_rt uuid; v_att uuid; v_res jsonb;
        e public.orders; t public.orders; s_e text; s_t text;
BEGIN
  PERFORM pg_temp.paid_order(v_e, '4522b011-0000-4000-8000-000000000020');
  v_re := pg_temp.refused_cancel(v_e);
  SELECT id INTO v_att FROM public.paystack_refund_attempts WHERE merchant_note = 'mingla_trip_refund:' || v_re || ':deposit';
  v_res := public.issue_4522_resolve_trip_cancel_refund_elsewhere_by_ops('4522b011-0000-4000-8000-000000000002', v_att,
    'PSK-DASH-500', 'Paystack shows a dashboard refund', 100000000, 'ngn', 50000000, 50000000);
  IF (v_res->>'to_cents')::bigint <> 50000000 OR NOT (v_res->>'outside_mingla')::boolean
     OR (v_res->>'outside_recorded_cents')::bigint <> 50000000 THEN
    RAISE EXCEPTION 'K-1a the part asks N500k and the dashboard N500k is booked: %', v_res;
  END IF;
  IF (SELECT refunded_amount_cents FROM public.orders WHERE id = v_e) <> 50000000 THEN
    RAISE EXCEPTION 'K-1b the dashboard refund is on the charge at once: %', (SELECT refunded_amount_cents FROM public.orders WHERE id = v_e);
  END IF;
  PERFORM pg_temp.made('mingla_trip_refund:' || v_re || ':deposit', 'PSK-E-MINGLA');
  s_e := pg_temp.finish(v_re, 'PSK-E-MINGLA');

  -- the twin: the first N500k was a Mingla seat refund
  PERFORM pg_temp.paid_order(v_t, '4522b011-0000-4000-8000-000000000020');
  INSERT INTO public.refunds(id, order_id, amount_cents, currency, status, reason, stripe_refund_id, processed_at)
  VALUES (v_seat, v_t, 50000000, 'NGN', 'succeeded', 'Host seat refund', 'PSK-T-SEAT', now());
  UPDATE public.orders SET refunded_amount_cents = public.issue_4522_order_charge_refunded_cents(v_t),
         payment_status = 'partial_refund' WHERE id = v_t;
  v_rt := (public.biz_cancel_trip_booking_begin(v_t, 'operator', NULL, 'Host cancelled')->>'refund_id')::uuid;
  PERFORM pg_temp.made('mingla_trip_refund:' || v_rt || ':deposit', 'PSK-T-MINGLA');
  s_t := pg_temp.finish(v_rt, 'PSK-T-MINGLA');

  SELECT * INTO e FROM public.orders WHERE id = v_e;
  SELECT * INTO t FROM public.orders WHERE id = v_t;
  RAISE NOTICE 'K-1 books e=% t=% status e=% t=% worth e=% t=%', e.refunded_amount_cents, t.refunded_amount_cents,
    e.payment_status, t.payment_status, pg_temp.worth(v_e), pg_temp.worth(v_t);
  IF e.refunded_amount_cents <> 100000000 OR e.refunded_amount_cents <> t.refunded_amount_cents THEN
    RAISE EXCEPTION 'K-1c books N1M, as the Mingla-made twin: % vs %', e.refunded_amount_cents, t.refunded_amount_cents;
  END IF;
  IF e.payment_status IS DISTINCT FROM t.payment_status OR s_e IS DISTINCT FROM s_t THEN
    RAISE EXCEPTION 'K-1d payment status as the twin: % vs %', e.payment_status, t.payment_status;
  END IF;
  IF pg_temp.worth(v_e) <> 0 OR pg_temp.worth(v_e) <> pg_temp.worth(v_t) THEN
    RAISE EXCEPTION 'K-1e the host is never paid for the dashboard refund: % vs twin %', pg_temp.worth(v_e), pg_temp.worth(v_t);
  END IF;
  -- a later refund-commit recount keeps the booked money
  IF public.issue_4522_order_charge_refunded_cents(v_e) <> 100000000 THEN RAISE EXCEPTION 'K-1f one owner'; END IF;
END $$;

-- K-2. Whole charge refunded from the dashboard (GAP), 50% tier.
DO $$
DECLARE v_g uuid := '4522b011-0000-4000-8000-0000000000a1'; v_r uuid; v_att uuid; v_res jsonb; s text;
BEGIN
  PERFORM pg_temp.paid_order(v_g, '4522b011-0000-4000-8000-000000000021');
  v_r := pg_temp.refused_cancel(v_g);
  SELECT id INTO v_att FROM public.paystack_refund_attempts WHERE merchant_note = 'mingla_trip_refund:' || v_r || ':deposit';
  v_res := public.issue_4522_resolve_trip_cancel_refund_elsewhere_by_ops('4522b011-0000-4000-8000-000000000002', v_att,
    'PSK-DASH-ALL', 'Paystack shows the whole charge refunded', 50000000, 'ngn', 100000000, 100000000);
  IF NOT (v_res->>'recorded_whole_charge')::boolean OR (v_res->>'outside_recorded_cents')::bigint <> 50000000 THEN
    RAISE EXCEPTION 'K-2a part recorded as asked, the other N500k booked: %', v_res;
  END IF;
  s := pg_temp.finish(v_r, 'PSK-DASH-ALL');
  RAISE NOTICE 'K-2 books=% status=% worth=%', (SELECT refunded_amount_cents FROM public.orders WHERE id = v_g), s, pg_temp.worth(v_g);
  IF (SELECT refunded_amount_cents FROM public.orders WHERE id = v_g) <> 100000000 OR pg_temp.worth(v_g) <> 0
     OR s <> 'refunded' THEN
    RAISE EXCEPTION 'K-2b books = provider N1M, host item worth 0, refunded';
  END IF;
END $$;

-- K-3. A reference already on Mingla's records is not booked again.
DO $$
DECLARE v_o uuid := '4522b011-0000-4000-8000-0000000000b1'; v_r uuid; v_att uuid; v_res jsonb;
BEGIN
  PERFORM pg_temp.paid_order(v_o, '4522b011-0000-4000-8000-000000000020');
  v_r := pg_temp.refused_cancel(v_o);
  INSERT INTO public.paystack_refund_attempts(source_type, source_id, local_refund_id, transaction_reference, merchant_note,
    amount_cents, currency, status, provider_refund_id, idempotency_key)
  VALUES ('order', v_o, NULL, 'mingla_p11k_' || v_o::text, 'other', 1, 'ngn', 'processed', 'psk-known-1', 'p11k-known');
  SELECT id INTO v_att FROM public.paystack_refund_attempts WHERE merchant_note = 'mingla_trip_refund:' || v_r || ':deposit';
  -- Pass 12 (P12-2): Mingla's own reference is refused outright (nothing
  -- booked, the part not used up).
  BEGIN
    v_res := public.issue_4522_resolve_trip_cancel_refund_elsewhere_by_ops('4522b011-0000-4000-8000-000000000002', v_att,
      'PSK-KNOWN-1', 'Paystack lists a Mingla refund', 100000000, 'ngn', 30000000, 30000000);
    RAISE EXCEPTION 'K-3 a Mingla reference was accepted: %', v_res;
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    IF SQLERRM <> 'provider_refund_reference_is_minglas' THEN RAISE; END IF;
  END;
  IF (SELECT refunded_amount_cents FROM public.orders WHERE id = v_o) <> 0
     OR (SELECT metadata #> '{trip_cancel,ops_resolutions,deposit}' FROM public.refunds WHERE id = v_r) IS NOT NULL THEN
    RAISE EXCEPTION 'K-3 a known reference is never booked twice and never uses up the part';
  END IF;
END $$;

-- K-4. P11-4: a late seat refund completes the charge after the cancel.
DO $$
DECLARE v_o uuid := '4522b011-0000-4000-8000-0000000000c1'; v_seat uuid := '4522b011-0000-4000-8000-0000000000c2';
        b jsonb; v_r uuid; v_sf uuid; s text;
BEGIN
  PERFORM pg_temp.paid_order(v_o, '4522b011-0000-4000-8000-000000000021');
  INSERT INTO public.refunds(id, order_id, amount_cents, currency, status, reason)
  VALUES (v_seat, v_o, 50000000, 'NGN', 'pending', 'Host seat refund');
  INSERT INTO public.paystack_refund_attempts(source_type, source_id, local_refund_id, transaction_reference, merchant_note,
    amount_cents, currency, status, idempotency_key)
  VALUES ('order', v_o, v_seat, 'mingla_p11k_' || v_o::text, 'mingla_refund:' || v_seat, 50000000, 'ngn', 'pending', 'p11k-seat');
  b := public.biz_cancel_trip_booking_begin(v_o, 'operator', NULL, 'Host cancelled');
  v_r := (b->>'refund_id')::uuid;
  -- the seat refund is refused: the traveler is owed the difference
  UPDATE public.paystack_refund_attempts SET status = 'failed', error_message = 'refused' WHERE local_refund_id = v_seat;
  UPDATE public.refunds SET status = 'failed' WHERE id = v_seat;
  SELECT (metadata #>> ARRAY['trip_cancel','shortfalls',v_seat::text,'shortfall_refund_id'])::uuid INTO v_sf
    FROM public.refunds WHERE id = v_r;
  PERFORM pg_temp.made('mingla_trip_refund:' || v_r || ':deposit', 'PSK-K4-CANCEL');
  s := pg_temp.finish(v_r, 'PSK-K4-CANCEL');
  IF NOT public.issue_4522_claim_trip_paystack_send(v_sf, 'mingla_trip_refund:' || v_sf || ':deposit') THEN
    RAISE EXCEPTION 'K-4 setup owed claim';
  END IF;
  PERFORM pg_temp.made('mingla_trip_refund:' || v_sf || ':deposit', 'PSK-K4-OWED');
  s := pg_temp.finish(v_sf, 'PSK-K4-OWED');
  IF s <> 'partial_refund' OR (SELECT refunded_amount_cents FROM public.orders WHERE id = v_o) <> 50000000 THEN
    RAISE EXCEPTION 'K-4a policy paid, partly refunded: % %', s, (SELECT refunded_amount_cents FROM public.orders WHERE id = v_o);
  END IF;
  -- the seat refund went through after all
  UPDATE public.paystack_refund_attempts SET status = 'processed', provider_refund_id = 'PSK-K4-SEAT', error_message = NULL,
         updated_at = now()
   WHERE local_refund_id = v_seat;
  RAISE NOTICE 'K-4 books=% status=%', (SELECT refunded_amount_cents FROM public.orders WHERE id = v_o),
    (SELECT payment_status FROM public.orders WHERE id = v_o);
  IF (SELECT refunded_amount_cents FROM public.orders WHERE id = v_o) <> 100000000
     OR (SELECT payment_status FROM public.orders WHERE id = v_o) <> 'refunded' THEN
    RAISE EXCEPTION 'K-4b the whole charge refunded moves the order to refunded: %',
      (SELECT payment_status FROM public.orders WHERE id = v_o);
  END IF;
END $$;

ROLLBACK;
