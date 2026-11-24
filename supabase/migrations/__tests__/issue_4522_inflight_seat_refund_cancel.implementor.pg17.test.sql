-- MINGLA-INVARIANT: I-4522-CANCEL-COUNTS-INFLIGHT-REFUNDS | issue #4522 | A trip cancel counts every refund of a charge still in flight as already refunded (preview = begin = what is asked), never asks the provider for more than a charge holds (a refused ask is lowered only to policy % of what is truly left, once, never raised), and a counted refund that later fails is recorded once as the exact amount owed and claimed once for the ops alert.
\set ON_ERROR_STOP on

-- Issue #4522 pass 8, P8-1 / P8-2 (20281202064522). Rolled back.
--   F-1  P8-1 card, 50% tier, $1,000 paid, a $500 seat refund still pending:
--        preview = begin = 50% x ($1,000 - $500) = $250 (main: $500), and the
--        cancel records the refund it counted.
--   F-2  that seat refund then goes out: cancel + seat = $750 = policy.
--   F-3  a counted seat refund that FAILS instead: the cancel records owed
--        $250 (= 50% x $1,000 - $250) once; the claim returns it once.
--   F-4  P8-2 second provider, 100% tier, N1M, a N500k seat refund made at
--        the provider with its answer lost (refund row pending): the cancel
--        asks N500k for the deposit charge, never N1M.
--   F-5  a cancel already asking the whole N1M that the provider refused
--        (released): the read-back figure lowers it to N500k once (refunds
--        row, plan, attempt); a replay and a lower figure change nothing; a
--        part already sent is never resized.
--   F-6  staff tool: the refused part is listed after 15 minutes with the
--        refunded_elsewhere outcome; only an admin may act; the figure is
--        required; it resizes, is audited, replays idempotently; recording a
--        refused part as refunded_at_provider is refused.
-- FAILS ON REVERT: without the in-flight count F-1 sees 50000 (asserts 25000);
-- without the resize / shortfall functions F-3, F-5, F-6 raise 42883.

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
  ('45228001-0000-4000-8000-000000000001', 'p8f-host@example.test'),
  ('45228001-0000-4000-8000-000000000002', 'p8f-staff@example.test'),
  ('45228001-0000-4000-8000-000000000003', 'p8f-stranger@example.test');
INSERT INTO public.admin_users(email, role, status) VALUES ('p8f-staff@example.test', 'admin', 'active');
INSERT INTO public.creator_accounts(id, email) VALUES ('45228001-0000-4000-8000-000000000001', 'p8f-host@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country) VALUES
  ('45228001-0000-4000-8000-000000000010', '45228001-0000-4000-8000-000000000001', 'P8 US', 'p8f-us-4522', 'USD', 'stripe', 'US'),
  ('45228001-0000-4000-8000-000000000011', '45228001-0000-4000-8000-000000000001', 'P8 NG', 'p8f-ng-4522', 'NGN', 'paystack', 'NG');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency, refund_policy) VALUES
  ('45228001-0000-4000-8000-000000000020', '45228001-0000-4000-8000-000000000010', '45228001-0000-4000-8000-000000000001',
   'Half tier trip', 'p8f-half-4522', 'trip', 'scheduled', 'public', 'America/New_York', 'USD',
   '{"kind":"standard","tiers":[{"days_before_start":0,"refund_pct":50}]}'),
  ('45228001-0000-4000-8000-000000000021', '45228001-0000-4000-8000-000000000011', '45228001-0000-4000-8000-000000000001',
   'Full tier trip', 'p8f-full-4522', 'trip', 'scheduled', 'public', 'Africa/Lagos', 'NGN',
   '{"kind":"standard","tiers":[{"days_before_start":0,"refund_pct":100}]}');
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
  ('45228001-0000-4000-8000-000000000020', now() + interval '100 days', now() + interval '103 days', 'America/New_York', true),
  ('45228001-0000-4000-8000-000000000021', now() + interval '100 days', now() + interval '103 days', 'Africa/Lagos', true);

CREATE FUNCTION pg_temp.paid_order(p_order uuid, p_event uuid, p_cents integer, p_cur text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, currency,
    payment_method, payment_status, source, installment_plan_root, stripe_payment_intent_id)
  VALUES (p_order, p_event, 'p8f-buyer@example.test', 'P8 Buyer', '+15555550188', p_cents, p_cur,
    'online_card', 'paid', 'online_checkout', false, 'pi_p8f_' || p_order::text);
$$;

-- F-1 / F-2. P8-1 on a card order.
DO $$
DECLARE v_o uuid := '45228001-0000-4000-8000-0000000000a1'; v_seat uuid := '45228001-0000-4000-8000-0000000000a2';
        v_prev jsonb; v_b jsonb; v_r public.refunds;
BEGIN
  PERFORM pg_temp.paid_order(v_o, '45228001-0000-4000-8000-000000000020', 100000, 'USD');
  INSERT INTO public.refunds(id, order_id, amount_cents, currency, status, reason)
  VALUES (v_seat, v_o, 50000, 'USD', 'pending', 'Host seat refund');
  v_prev := public.issue_4522_compute_refund_for_cancel_as(v_o, now(), 'operator');
  IF (v_prev->>'refund_total_cents')::bigint <> 25000 THEN
    RAISE EXCEPTION 'F-1a preview counts the pending seat refund: 50%% x (100000 - 50000) = 25000, got %', v_prev->>'refund_total_cents';
  END IF;
  IF (v_prev->>'inflight_refund_cents')::bigint <> 50000 THEN RAISE EXCEPTION 'F-1b preview names the in-flight refund: %', v_prev; END IF;
  v_b := public.biz_cancel_trip_booking_begin(v_o, 'operator', NULL, 'Host cancelled');
  IF (v_b->>'refund_total_cents')::bigint <> 25000
     OR (v_b->'per_payment_refund'->0->>'refund_cents')::bigint <> 25000 THEN
    RAISE EXCEPTION 'F-1c begin asks what the preview showed: %', v_b;
  END IF;
  SELECT * INTO v_r FROM public.refunds WHERE id = (v_b->>'refund_id')::uuid;
  IF v_r.amount_cents <> 25000 OR (v_r.metadata #>> ARRAY['trip_cancel','inflight_counted', v_seat::text])::bigint <> 50000 THEN
    RAISE EXCEPTION 'F-1d the cancel records what it counted: %', v_r.metadata;
  END IF;
  -- F-2: the seat refund goes out and the cancel commits.
  UPDATE public.refunds SET status = 'succeeded', processed_at = now() WHERE id = v_seat;
  PERFORM public.biz_cancel_trip_booking_commit(v_r.id, ARRAY['re_p8f_a'], 0);
  IF (SELECT sum(amount_cents) FROM public.refunds WHERE order_id = v_o AND status = 'succeeded') <> 75000
     OR (SELECT refunded_amount_cents FROM public.orders WHERE id = v_o) <> 75000 THEN
    RAISE EXCEPTION 'F-2 seat + cancel = 75000 (policy), never 100000';
  END IF;
  IF (SELECT metadata #> '{trip_cancel,shortfalls}' FROM public.refunds WHERE id = v_r.id) IS NOT NULL THEN
    RAISE EXCEPTION 'F-2b a seat refund that went out owes nothing';
  END IF;
END $$;

-- F-3. The counted seat refund fails instead.
DO $$
DECLARE v_o uuid := '45228001-0000-4000-8000-0000000000b1'; v_seat uuid := '45228001-0000-4000-8000-0000000000b2';
        v_b jsonb; v_claim jsonb;
BEGIN
  PERFORM pg_temp.paid_order(v_o, '45228001-0000-4000-8000-000000000020', 100000, 'USD');
  INSERT INTO public.refunds(id, order_id, amount_cents, currency, status, reason)
  VALUES (v_seat, v_o, 50000, 'USD', 'pending', 'Host seat refund');
  v_b := public.biz_cancel_trip_booking_begin(v_o, 'operator', NULL, 'Host cancelled');
  UPDATE public.refunds SET status = 'failed' WHERE id = v_seat;
  IF (SELECT (metadata #>> ARRAY['trip_cancel','shortfalls', v_seat::text, 'owed_cents'])::bigint
        FROM public.refunds WHERE id = (v_b->>'refund_id')::uuid) IS DISTINCT FROM 25000 THEN
    RAISE EXCEPTION 'F-3a owed = 50%% x 100000 - 25000 = 25000: %',
      (SELECT metadata FROM public.refunds WHERE id = (v_b->>'refund_id')::uuid);
  END IF;
  UPDATE public.refunds SET status = 'failed' WHERE id = v_seat;  -- no status change: no second entry
  v_claim := public.issue_4522_claim_trip_cancel_shortfalls(50);
  IF jsonb_array_length(v_claim) <> 1 OR (v_claim->0->>'owed_cents')::bigint <> 25000
     OR v_claim->0->>'failed_refund_id' <> v_seat::text OR v_claim->0->>'currency' <> 'usd' THEN
    RAISE EXCEPTION 'F-3b claimed once with the exact amount: %', v_claim;
  END IF;
  IF jsonb_array_length(public.issue_4522_claim_trip_cancel_shortfalls(50)) <> 0 THEN
    RAISE EXCEPTION 'F-3c a second claim returns nothing (ops told once)';
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_4522_claim_trip_cancel_shortfalls(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_4522_trip_cancel_resize_charge(uuid, text, bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'F-3d service role only';
  END IF;
END $$;

-- F-4. P8-2: the lost-answer seat refund is counted on the second provider.
DO $$
DECLARE v_o uuid := '45228001-0000-4000-8000-0000000000c1'; v_seat uuid := '45228001-0000-4000-8000-0000000000c2';
        v_b jsonb;
BEGIN
  PERFORM pg_temp.paid_order(v_o, '45228001-0000-4000-8000-000000000021', 100000000, 'NGN');
  INSERT INTO public.refunds(id, order_id, amount_cents, currency, status, reason)
  VALUES (v_seat, v_o, 50000000, 'NGN', 'pending', 'Host seat refund');
  PERFORM public.record_paystack_refund_outcome('order', v_o, v_seat, 'pi_p8f_' || v_o::text,
    'mingla_line_refund:' || v_seat, 'p8f-seat-c', 50000000, 'processed');
  v_b := public.biz_cancel_trip_booking_begin(v_o, 'operator', NULL, 'Host cancelled');
  IF (v_b->>'refund_total_cents')::bigint <> 50000000 THEN
    RAISE EXCEPTION 'F-4a 100%% of what the charge still holds = 50000000, got %', v_b->>'refund_total_cents';
  END IF;
  IF (SELECT amount_cents FROM public.paystack_refund_attempts
       WHERE merchant_note = 'mingla_trip_refund:' || (v_b->>'refund_id') || ':deposit') <> 50000000 THEN
    RAISE EXCEPTION 'F-4b the provider is asked 50000000, never the whole charge';
  END IF;
END $$;

-- F-5. A cancel asking the whole charge, refused by the provider.
CREATE TEMP TABLE f5(refund_id uuid, note text);
DO $$
DECLARE v_o uuid := '45228001-0000-4000-8000-0000000000d1'; v_b jsonb; v_res jsonb; v_note text; v_r public.refunds;
BEGIN
  PERFORM pg_temp.paid_order(v_o, '45228001-0000-4000-8000-000000000021', 100000000, 'NGN');
  v_b := public.biz_cancel_trip_booking_begin(v_o, 'operator', NULL, 'Host cancelled');
  v_note := 'mingla_trip_refund:' || (v_b->>'refund_id') || ':deposit';
  INSERT INTO f5 VALUES ((v_b->>'refund_id')::uuid, v_note);
  IF NOT public.issue_4522_claim_trip_paystack_send((v_b->>'refund_id')::uuid, v_note) THEN RAISE EXCEPTION 'setup claim'; END IF;
  -- sent part: never resized
  v_res := public.issue_4522_trip_cancel_resize_charge((v_b->>'refund_id')::uuid, 'deposit', 50000000);
  IF v_res->>'reason' <> 'trip_cancel_part_already_sent' THEN RAISE EXCEPTION 'F-5a a sent part is not resized: %', v_res; END IF;
  -- the provider refused it (more than unrefunded): released
  IF NOT public.issue_4522_claim_trip_paystack_send((v_b->>'refund_id')::uuid, v_note, true) THEN RAISE EXCEPTION 'setup release'; END IF;
  v_res := public.issue_4522_trip_cancel_resize_charge((v_b->>'refund_id')::uuid, 'deposit', 50000000);
  IF NOT (v_res->>'changed')::boolean OR (v_res->>'refund_cents')::bigint <> 50000000 THEN
    RAISE EXCEPTION 'F-5b lowered to the true remainder: %', v_res;
  END IF;
  SELECT * INTO v_r FROM public.refunds WHERE id = (v_b->>'refund_id')::uuid;
  IF v_r.amount_cents <> 50000000 OR (v_r.metadata #>> '{trip_cancel,per_payment_refund,0,refund_cents}')::bigint <> 50000000
     OR (SELECT amount_cents FROM public.paystack_refund_attempts WHERE merchant_note = v_note) <> 50000000
     OR (public.issue_4522_trip_cancel_operation(v_o)->'per_payment_refund'->0->>'refund_cents')::bigint <> 50000000 THEN
    RAISE EXCEPTION 'F-5c row, plan, attempt and resume plan all ask 50000000: %', v_r.metadata;
  END IF;
  v_res := public.issue_4522_trip_cancel_resize_charge((v_b->>'refund_id')::uuid, 'deposit', 50000000);
  IF (v_res->>'changed')::boolean THEN RAISE EXCEPTION 'F-5d replay changes nothing: %', v_res; END IF;
  v_res := public.issue_4522_trip_cancel_resize_charge((v_b->>'refund_id')::uuid, 'deposit', 0);
  IF (v_res->>'changed')::boolean OR (SELECT amount_cents FROM public.refunds WHERE id = v_r.id) <> 50000000 THEN
    RAISE EXCEPTION 'F-5e never raised back: %', v_res;
  END IF;
  -- F-6 uses a second stuck cancel of the same shape (the amount stays pinned
  -- except for the resize itself).
  DELETE FROM f5;
  PERFORM pg_temp.paid_order('45228001-0000-4000-8000-0000000000e1', '45228001-0000-4000-8000-000000000021', 100000000, 'NGN');
  v_b := public.biz_cancel_trip_booking_begin('45228001-0000-4000-8000-0000000000e1', 'operator', NULL, 'Host cancelled');
  v_note := 'mingla_trip_refund:' || (v_b->>'refund_id') || ':deposit';
  INSERT INTO f5 VALUES ((v_b->>'refund_id')::uuid, v_note);
  PERFORM public.issue_4522_claim_trip_paystack_send((v_b->>'refund_id')::uuid, v_note);
  PERFORM public.issue_4522_claim_trip_paystack_send((v_b->>'refund_id')::uuid, v_note, true);
  UPDATE public.paystack_refund_attempts SET updated_at = now() - interval '20 minutes' WHERE merchant_note = v_note;
END $$;

-- F-6. Staff finish a refused part.
DO $$
DECLARE v_att uuid; v_err text; v_list jsonb; v_res jsonb; v_ref uuid := (SELECT refund_id FROM f5);
BEGIN
  SELECT id INTO v_att FROM public.paystack_refund_attempts WHERE merchant_note = (SELECT note FROM f5);
  PERFORM pg_temp.act_as('45228001-0000-4000-8000-000000000003');
  v_err := pg_temp.raised(format('SELECT public.issue_4522_resolve_trip_cancel_refund_by_ops(%L, %L, %L, %L, NULL, NULL, %s)',
    v_att, 'refunded_elsewhere', 'p8f-seat-ref', 'Paystack shows the seat refund', 50000000));
  IF v_err IS NULL OR v_err NOT LIKE '42501:%' THEN RAISE EXCEPTION 'F-6a a non-admin is refused: %', v_err; END IF;
  PERFORM pg_temp.act_as('45228001-0000-4000-8000-000000000002');
  v_list := public.issue_4522_list_unanswered_trip_cancel_refunds();
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) x
                  WHERE (x->>'refund_id')::uuid = v_ref AND (x->>'refused_amount_cents')::bigint = 100000000
                    AND x->'charges'->0->>'state' = 'refused' AND (x->'charges'->0->>'actionable')::boolean
                    AND x->'charges'->0->'outcomes' = '["refunded_elsewhere","escalate"]'::jsonb) THEN
    RAISE EXCEPTION 'F-6b the refused part is in Refund operations: %', v_list;
  END IF;
  v_err := pg_temp.raised(format('SELECT public.issue_4522_resolve_trip_cancel_refund_by_ops(%L, %L, %L, %L)',
    v_att, 'refunded_elsewhere', 'p8f-seat-ref', 'Paystack shows the seat refund'));
  IF v_err NOT LIKE '%refunded_elsewhere_required%' THEN RAISE EXCEPTION 'F-6c the figure is required: %', v_err; END IF;
  v_err := pg_temp.raised(format('SELECT public.issue_4522_resolve_trip_cancel_refund_by_ops(%L, %L, %L, %L)',
    v_att, 'refunded_at_provider', 'p8f-x', 'Paystack shows it refunded'));
  IF v_err NOT LIKE '%trip_cancel_refund_not_unanswered%' THEN RAISE EXCEPTION 'F-6d a refused part is not recorded as made: %', v_err; END IF;
  v_res := public.issue_4522_resolve_trip_cancel_refund_by_ops(v_att, 'refunded_elsewhere', 'p8f-seat-ref',
    'Paystack shows the seat refund', 100000000, 'ngn', 50000000);
  IF (v_res->>'to_cents')::bigint <> 50000000 OR (SELECT amount_cents FROM public.refunds WHERE id = v_ref) <> 50000000
     OR (SELECT amount_cents FROM public.paystack_refund_attempts WHERE id = v_att) <> 50000000
     OR (SELECT (metadata #>> '{trip_cancel,failures}')::int FROM public.refunds WHERE id = v_ref) <> 0 THEN
    RAISE EXCEPTION 'F-6e resized to the remainder and handed to the resume: %', v_res;
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE action = 'trip_cancel_refund.resized_by_ops'
        AND (after->>'refund_id')::uuid = v_ref AND (after->>'refunded_elsewhere_cents')::bigint = 50000000
        AND after->>'reason' IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'F-6f one audit row with the figure and the reason';
  END IF;
  v_res := public.issue_4522_resolve_trip_cancel_refund_by_ops(v_att, 'refunded_elsewhere', 'p8f-seat-ref',
    'Paystack shows the seat refund', 100000000, 'ngn', 50000000);
  IF NOT (v_res->>'idempotent_replay')::boolean
     OR (SELECT count(*) FROM public.audit_log WHERE action = 'trip_cancel_refund.resized_by_ops'
           AND (after->>'refund_id')::uuid = v_ref) <> 1 THEN
    RAISE EXCEPTION 'F-6g replay is a no-op: %', v_res;
  END IF;
END $$;

ROLLBACK;
