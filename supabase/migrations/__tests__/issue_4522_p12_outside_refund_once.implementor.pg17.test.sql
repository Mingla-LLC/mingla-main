-- MINGLA-INVARIANT: I-4522-OUTSIDE-REFUND-BOOKED-ONCE | issue #4522 | A Paystack refund made outside Mingla (its dashboard) is booked on its charge by the one booking function whether the cancel's automatic read-back or staff find it first, at most once per provider refund reference; Mingla's own refunds are never booked as outside refunds and staff can never record Mingla's own reference as one.
\set ON_ERROR_STOP on

-- Issue #4522 pass 12 (20281202084522). Rolled back.
--   M-1  P12-1: dashboard N500k; the cancel's N1M ask is refused; the
--        cancel's own read-back of Paystack's list (no staff) books the
--        dashboard refund on the charge at once and lowers the ask to N500k;
--        a replay books nothing more; staff then entering the same
--        reference book nothing more; Mingla's N500k finishes the cancel:
--        books N1M = provider, the host's item is worth 0.
--   M-2  the read-back never books Mingla's own refunds (a Mingla merchant
--        note, a reference on a Mingla attempt) nor failed rows.
--   M-3  P12-2: staff entering Mingla's own reference is refused
--        (provider_refund_reference_is_minglas) and the part stays open:
--        the real dashboard reference is then booked.
--   M-4  P12-2: a part an earlier wrong entry already used (recorded before
--        pass 12) still takes the real dashboard reference.
--   M-5  a figure-only read-back then the staff reference: booked once.
-- FAILS ON REVERT (20281202084522 at a57242fda0): M-1 books 0 after the
-- read-back (and 50000000 at the end, item worth 50000000); M-3 accepts
-- Mingla's reference; M-4 is refused with trip_cancel_refund_already_resolved.

BEGIN;

INSERT INTO auth.users(id, email) VALUES
  ('4522b012-0000-4000-8000-000000000001', 'p12k-host@example.test'),
  ('4522b012-0000-4000-8000-000000000002', 'p12k-staff@example.test');
INSERT INTO public.admin_users(email, role, status) VALUES ('p12k-staff@example.test', 'admin', 'active');
INSERT INTO public.creator_accounts(id, email) VALUES ('4522b012-0000-4000-8000-000000000001', 'p12k-host@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country) VALUES
  ('4522b012-0000-4000-8000-000000000010', '4522b012-0000-4000-8000-000000000001', 'P12 NG', 'p12k-ng-4522', 'NGN', 'paystack', 'NG');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency, refund_policy) VALUES
  ('4522b012-0000-4000-8000-000000000020', '4522b012-0000-4000-8000-000000000010', '4522b012-0000-4000-8000-000000000001',
   'Full tier trip', 'p12k-full-4522', 'trip', 'scheduled', 'public', 'Africa/Lagos', 'NGN',
   '{"kind":"standard","tiers":[{"days_before_start":0,"refund_pct":100}]}'),
  ('4522b012-0000-4000-8000-000000000021', '4522b012-0000-4000-8000-000000000010', '4522b012-0000-4000-8000-000000000001',
   'Half tier trip', 'p12k-half-4522', 'trip', 'scheduled', 'public', 'Africa/Lagos', 'NGN',
   '{"kind":"standard","tiers":[{"days_before_start":0,"refund_pct":50}]}');
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
  ('4522b012-0000-4000-8000-000000000020', now() + interval '100 days', now() + interval '103 days', 'Africa/Lagos', true),
  ('4522b012-0000-4000-8000-000000000021', now() + interval '100 days', now() + interval '103 days', 'Africa/Lagos', true);

CREATE FUNCTION pg_temp.paid_order(p_order uuid, p_event uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, currency,
    payment_method, payment_status, source, installment_plan_root, stripe_payment_intent_id)
  VALUES (p_order, p_event, 'p12k-buyer@example.test', 'P11 Buyer', '+2348030000000', 100000000, 'NGN',
    'online_card', 'paid', 'online_checkout', false, 'mingla_p12k_' || p_order::text);
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


CREATE FUNCTION pg_temp.att(p_refund uuid) RETURNS uuid
LANGUAGE sql AS $$
  SELECT id FROM public.paystack_refund_attempts WHERE merchant_note = 'mingla_trip_refund:' || p_refund || ':deposit';
$$;
CREATE FUNCTION pg_temp.books(p_order uuid) RETURNS bigint
LANGUAGE sql AS $$ SELECT refunded_amount_cents::bigint FROM public.orders WHERE id = p_order; $$;

-- M-1. The automatic read-back books the dashboard refund, once.
DO $$
DECLARE v_o uuid := '4522b012-0000-4000-8000-0000000000e1'; v_r uuid; v_res jsonb; s text; v_list jsonb;
BEGIN
  PERFORM pg_temp.paid_order(v_o, '4522b012-0000-4000-8000-000000000020');
  v_r := pg_temp.refused_cancel(v_o);
  v_list := jsonb_build_array(
    jsonb_build_object('id', 'PSD-M1-500', 'amount', 50000000, 'status', 'processed', 'merchant_note', ''),
    jsonb_build_object('id', 'PSD-M1-OWN', 'amount', 100000000, 'status', 'failed',
                       'merchant_note', 'mingla_trip_refund:' || v_r || ':deposit'));
  v_res := public.issue_4522_trip_cancel_resize_charge(v_r, 'deposit', 50000000, v_list);
  IF (v_res->>'refund_cents')::bigint <> 50000000 OR pg_temp.books(v_o) <> 50000000 THEN
    RAISE EXCEPTION 'M-1a the read-back books the dashboard N500k at once and asks N500k: % books %', v_res, pg_temp.books(v_o);
  END IF;
  v_res := public.issue_4522_trip_cancel_resize_charge(v_r, 'deposit', 50000000, v_list);
  IF pg_temp.books(v_o) <> 50000000 THEN RAISE EXCEPTION 'M-1b a replay books it again: %', pg_temp.books(v_o); END IF;
  UPDATE public.paystack_refund_attempts SET updated_at = now() - interval '20 minutes' WHERE id = pg_temp.att(v_r);
  v_res := public.issue_4522_resolve_trip_cancel_refund_elsewhere_by_ops('4522b012-0000-4000-8000-000000000002', pg_temp.att(v_r),
    'psd-m1-500 ', 'Paystack shows a dashboard refund', 50000000, 'ngn', 50000000, 50000000);
  IF pg_temp.books(v_o) <> 50000000 OR (v_res->>'to_cents')::bigint <> 50000000
     OR (v_res->>'booked_now_cents')::bigint <> 0 THEN
    RAISE EXCEPTION 'M-1c staff after the read-back book nothing more and lower nothing more: % books %', v_res, pg_temp.books(v_o);
  END IF;
  PERFORM pg_temp.made('mingla_trip_refund:' || v_r || ':deposit', 'PSD-M1-MINGLA');
  s := pg_temp.finish(v_r, 'PSD-M1-MINGLA');
  RAISE NOTICE 'M-1 books=% status=% worth=%', pg_temp.books(v_o), s, pg_temp.worth(v_o);
  IF pg_temp.books(v_o) <> 100000000 OR pg_temp.worth(v_o) <> 0 OR s <> 'refunded' THEN
    RAISE EXCEPTION 'M-1d books = provider N1M, the host item worth 0: books % worth % status %', pg_temp.books(v_o), pg_temp.worth(v_o), s;
  END IF;
END $$;

-- M-2. Mingla's own refunds and failed rows are never booked by the read-back.
DO $$
DECLARE v_o uuid := '4522b012-0000-4000-8000-0000000000e2'; v_r uuid;
BEGIN
  PERFORM pg_temp.paid_order(v_o, '4522b012-0000-4000-8000-000000000020');
  v_r := pg_temp.refused_cancel(v_o);
  INSERT INTO public.paystack_refund_attempts(source_type, source_id, local_refund_id, transaction_reference, merchant_note,
    amount_cents, currency, status, provider_refund_id, idempotency_key)
  VALUES ('order', v_o, NULL, 'mingla_p12k_' || v_o::text, 'seat-note-m2', 1, 'ngn', 'processed', 'PSK-M2-KNOWN', 'p12k-m2');
  PERFORM public.issue_4522_trip_cancel_resize_charge(v_r, 'deposit', 0, jsonb_build_array(
    jsonb_build_object('id', 'PSK-M2-KNOWN', 'amount', 10000000, 'status', 'processed', 'merchant_note', ''),
    jsonb_build_object('id', 'PSK-M2-NOTE', 'amount', 10000000, 'status', 'processed', 'merchant_note', 'seat-note-m2'),
    jsonb_build_object('id', 'PSK-M2-OVER', 'amount', 10000000, 'status', 'processed', 'merchant_note', 'mingla_overpay_refund:x:1'),
    jsonb_build_object('id', 'PSK-M2-FAIL', 'amount', 10000000, 'status', 'failed', 'merchant_note', '')));
  IF pg_temp.books(v_o) <> 0 OR public.issue_4522_order_outside_refunded_cents(v_o) <> 0 THEN
    RAISE EXCEPTION 'M-2 Mingla''s own refunds are never booked as outside: books %', pg_temp.books(v_o);
  END IF;
END $$;

-- M-3. Staff entering Mingla's own reference is refused; the part stays open.
DO $$
DECLARE v_o uuid := '4522b012-0000-4000-8000-0000000000e3'; v_r uuid; v_res jsonb;
BEGIN
  PERFORM pg_temp.paid_order(v_o, '4522b012-0000-4000-8000-000000000020');
  v_r := pg_temp.refused_cancel(v_o);
  INSERT INTO public.paystack_refund_attempts(source_type, source_id, local_refund_id, transaction_reference, merchant_note,
    amount_cents, currency, status, provider_refund_id, idempotency_key)
  VALUES ('order', v_o, NULL, 'mingla_p12k_' || v_o::text, 'seat-note-m3', 1, 'ngn', 'processed', 'PSK-M3-MINGLA', 'p12k-m3');
  BEGIN
    PERFORM public.issue_4522_resolve_trip_cancel_refund_elsewhere_by_ops('4522b012-0000-4000-8000-000000000002', pg_temp.att(v_r),
      'PSK-M3-MINGLA', 'Paystack lists this refund', 100000000, 'ngn', 30000000, 30000000);
    RAISE EXCEPTION 'M-3a Mingla''s own reference was accepted as an outside refund';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    IF SQLERRM <> 'provider_refund_reference_is_minglas' THEN RAISE; END IF;
  END;
  v_res := public.issue_4522_resolve_trip_cancel_refund_elsewhere_by_ops('4522b012-0000-4000-8000-000000000002', pg_temp.att(v_r),
    'PSD-M3-DASH', 'Paystack shows a dashboard refund', 100000000, 'ngn', 20000000, 20000000);
  IF pg_temp.books(v_o) <> 20000000 OR (v_res->>'to_cents')::bigint <> 80000000 THEN
    RAISE EXCEPTION 'M-3b the real dashboard reference is booked after the refusal: % books %', v_res, pg_temp.books(v_o);
  END IF;
END $$;

-- M-4. A part an earlier wrong entry used still takes the real dashboard reference.
DO $$
DECLARE v_o uuid := '4522b012-0000-4000-8000-0000000000e4'; v_r uuid; v_res jsonb;
BEGIN
  PERFORM pg_temp.paid_order(v_o, '4522b012-0000-4000-8000-000000000020');
  v_r := pg_temp.refused_cancel(v_o);
  -- as recorded before pass 12: Mingla's own reference used the part.
  UPDATE public.refunds
     SET metadata = jsonb_set(metadata, '{trip_cancel,ops_resolutions}', jsonb_build_object('deposit',
           jsonb_build_object('outcome', 'refunded_elsewhere', 'reference', 'PSK-M4-MINGLA',
             'refunded_elsewhere_cents', 50000000, 'outside_mingla', false, 'outside_recorded_cents', 0)))
   WHERE id = v_r;
  v_res := public.issue_4522_resolve_trip_cancel_refund_elsewhere_by_ops('4522b012-0000-4000-8000-000000000002', pg_temp.att(v_r),
    'PSD-M4-DASH', 'Paystack shows a dashboard refund', 100000000, 'ngn', 30000000, 30000000);
  IF pg_temp.books(v_o) <> 30000000 OR (v_res->'earlier'->>'reference') <> 'PSK-M4-MINGLA' THEN
    RAISE EXCEPTION 'M-4 the dashboard refund is booked and the earlier entry kept: % books %', v_res, pg_temp.books(v_o);
  END IF;
END $$;

-- M-5. A figure-only read-back, then staff's reference for that refund: booked once.
DO $$
DECLARE v_o uuid := '4522b012-0000-4000-8000-0000000000e5'; v_r uuid;
BEGIN
  PERFORM pg_temp.paid_order(v_o, '4522b012-0000-4000-8000-000000000020');
  v_r := pg_temp.refused_cancel(v_o);
  PERFORM public.issue_4522_trip_cancel_resize_charge(v_r, 'deposit', 40000000);
  PERFORM public.issue_4522_trip_cancel_resize_charge(v_r, 'deposit', 40000000);
  IF pg_temp.books(v_o) <> 40000000 THEN RAISE EXCEPTION 'M-5a figure booked once: %', pg_temp.books(v_o); END IF;
  UPDATE public.paystack_refund_attempts SET updated_at = now() - interval '20 minutes' WHERE id = pg_temp.att(v_r);
  PERFORM public.issue_4522_resolve_trip_cancel_refund_elsewhere_by_ops('4522b012-0000-4000-8000-000000000002', pg_temp.att(v_r),
    'PSD-M5-DASH', 'Paystack shows a dashboard refund', 60000000, 'ngn', 40000000, 40000000);
  IF pg_temp.books(v_o) <> 40000000 THEN RAISE EXCEPTION 'M-5b the staff reference takes over, never twice: %', pg_temp.books(v_o); END IF;
END $$;

ROLLBACK;
