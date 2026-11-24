-- MINGLA-INVARIANT: I-4522-TRIP-CANCEL-OPS-RECORD | issue #4522 | A second-provider trip cancel refund that was sent and never answered is finished only by staff (a current admin session): recording it needs the provider's refund reference and records it exactly as a provider-confirmed refund (once, never re-sent, never written off); escalating it changes no money.
\set ON_ERROR_STOP on

-- Issue #4522 seventh pass, H-2 ops tool (20281202084522 section 9). Rolled back.
--   O-1  no session / a non-admin session is refused; only authenticated may execute.
--   O-2  a refund sent in the last 15 minutes is not actionable yet.
--   O-3  record needs a reference; a reused reference (in any case or
--        spacing, pass 8 P8-5), a different amount or currency, and an
--        already-confirmed refund are refused.
--   O-4  escalate records the reason and changes no money; its audit row
--        carries the reason (pass 8 P8-4).
--   O-5  record with a reference writes the charge and order refunded figures
--        once, exactly as the provider-confirmed path on a twin order does
--        (instalment row, order figure, payment status, payout item value).
--   O-6  a second identical call is a no-op returning the same result; one
--        audit row; a later escalate is refused.
--   O-7  the cancel is handed to its resume: the commit settles it and it
--        completes exactly once (the one buyer email is sent on that first
--        completion by cancel-trip-booking).
-- FAILS ON REVERT: without section 9 the functions do not exist and every
-- call below raises 42883.

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
  ('45220009-0000-4000-8000-000000000001', 'h2-host@example.test'),
  ('45220009-0000-4000-8000-000000000002', 'h2-staff@example.test'),
  ('45220009-0000-4000-8000-000000000003', 'h2-stranger@example.test');
INSERT INTO public.admin_users(email, role, status) VALUES ('h2-staff@example.test', 'admin', 'active');
INSERT INTO public.creator_accounts(id, email) VALUES
  ('45220009-0000-4000-8000-000000000001', 'h2-host@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country)
VALUES ('45220009-0000-4000-8000-000000000010', '45220009-0000-4000-8000-000000000001',
        'H2 brand', 'h2-brand-4522', 'NGN', 'paystack', 'NG');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone,
  currency, refund_policy)
VALUES ('45220009-0000-4000-8000-000000000020', '45220009-0000-4000-8000-000000000010',
        '45220009-0000-4000-8000-000000000001', 'Lagos to Accra', 'h2-trip-4522', 'trip', 'scheduled',
        'public', 'Africa/Lagos', 'NGN',
        '{"kind":"flexible","tiers":[{"days_before_start":0,"refund_pct":100}],"deposit_non_refundable":true}');
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
VALUES ('45220009-0000-4000-8000-000000000020', now() + interval '120 days', now() + interval '127 days',
        'Africa/Lagos', true);
INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total, is_unlimited,
  min_purchase_qty, available_online, available_in_person)
VALUES ('45220009-0000-4000-8000-000000000030', '45220009-0000-4000-8000-000000000020', 'Room',
        120000000, 'NGN', false, 20, false, 1, true, false);

-- A plan order shaped like a real one: the order row is the ₦300,000 deposit,
-- instalment 1 (₦306,000 with fees) collected; the host cancels; the deposit
-- refund is confirmed, the instalment refund was sent and never answered.
CREATE FUNCTION pg_temp.stuck_cancel(p_order uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_b jsonb; v_refund uuid; v_row uuid;
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source, installment_plan_root, stripe_payment_intent_id)
  VALUES (p_order, '45220009-0000-4000-8000-000000000020', 'h2-buyer@example.test', 'H2 Buyer',
    '+2348000000009', 30000000, 'NGN', 'online_card', 'paid', 'online_checkout', true, 'ps_deposit_' || p_order::text);
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, plan_bound_at, buyer_total_cents, planned_application_fee_cents, ticket_type_id)
  SELECT p_order, g, 30000000, 'NGN', now() + (g * 20 || ' days')::interval, 'scheduled', 'paystack', 'pay_link',
         now(), 30600000, 1350000, '45220009-0000-4000-8000-000000000030'
    FROM generate_series(1, 3) g;
  UPDATE public.order_installments SET status = 'collected', collected_at = now() - interval '1 day',
         due_at = now() - interval '1 day', stripe_payment_intent_id = 'mingla-inst-' || p_order::text,
         payout_accounting_state = 'ready'
   WHERE order_id = p_order AND ordinal = 1
  RETURNING id INTO v_row;
  v_b := public.biz_cancel_trip_booking_begin(p_order, 'operator', NULL, 'Host cancelled');
  v_refund := (v_b->>'refund_id')::uuid;
  PERFORM public.record_paystack_refund_outcome('order', p_order, v_refund, 'ps_deposit_' || p_order::text,
    'mingla_trip_refund:' || v_refund || ':deposit', 'h2dep-' || right(p_order::text, 4), 30000000, 'processed');
  PERFORM public.record_paystack_refund_outcome('order_installment', v_row, v_refund, 'mingla-inst-' || p_order::text,
    'mingla_trip_refund:' || v_refund || ':' || v_row, NULL, 30600000, 'pending');
  IF NOT public.issue_4522_claim_trip_paystack_send(v_refund, 'mingla_trip_refund:' || v_refund || ':' || v_row) THEN
    RAISE EXCEPTION 'setup: the instalment refund is claimed as sent';
  END IF;
  RETURN v_refund;
END $$;

CREATE TEMP TABLE h2 AS
SELECT pg_temp.stuck_cancel('45220009-0000-4000-8000-0000000000a1') AS refund_a,
       pg_temp.stuck_cancel('45220009-0000-4000-8000-0000000000b1') AS refund_b;

-- O-1. Staff only.
DO $$
DECLARE v_att uuid; v_err text;
BEGIN
  SELECT pa.id INTO v_att FROM public.paystack_refund_attempts pa, h2
   WHERE pa.local_refund_id = h2.refund_a AND pa.merchant_note NOT LIKE '%:deposit';
  PERFORM pg_temp.act_as(NULL);
  v_err := pg_temp.raised(format('SELECT public.issue_4522_resolve_trip_cancel_refund_by_ops(%L, %L, %L, %L)',
    v_att, 'escalate', NULL, 'No refund in Paystack'));
  IF v_err IS NULL OR v_err NOT LIKE '42501:%' THEN RAISE EXCEPTION 'O-1a no session is refused: %', v_err; END IF;
  PERFORM pg_temp.act_as('45220009-0000-4000-8000-000000000003');
  v_err := pg_temp.raised(format('SELECT public.issue_4522_resolve_trip_cancel_refund_by_ops(%L, %L, %L, %L)',
    v_att, 'escalate', NULL, 'No refund in Paystack'));
  IF v_err IS NULL OR v_err NOT LIKE '42501:%' THEN RAISE EXCEPTION 'O-1b a non-admin is refused: %', v_err; END IF;
  IF pg_temp.raised('SELECT public.issue_4522_list_unanswered_trip_cancel_refunds()') NOT LIKE '42501:%' THEN
    RAISE EXCEPTION 'O-1c a non-admin cannot list the queue';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.issue_4522_resolve_trip_cancel_refund_by_ops(uuid, text, text, text, bigint, text, bigint)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.issue_4522_resolve_trip_cancel_refund_by_ops(uuid, text, text, text, bigint, text, bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_4522_list_unanswered_trip_cancel_refunds()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_4522_trip_cancel_ops_view(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'O-1d execute is granted to authenticated only';
  END IF;
END $$;

-- O-2. A send in flight is never raced.
DO $$
DECLARE v_att uuid; v_err text;
BEGIN
  PERFORM pg_temp.act_as('45220009-0000-4000-8000-000000000002');
  SELECT pa.id INTO v_att FROM public.paystack_refund_attempts pa, h2
   WHERE pa.local_refund_id = h2.refund_a AND pa.merchant_note NOT LIKE '%:deposit';
  IF jsonb_array_length(public.issue_4522_list_unanswered_trip_cancel_refunds()) <> 0 THEN
    RAISE EXCEPTION 'O-2a a refund sent minutes ago is not in the queue yet';
  END IF;
  v_err := pg_temp.raised(format('SELECT public.issue_4522_resolve_trip_cancel_refund_by_ops(%L, %L, %L, %L)',
    v_att, 'refunded_at_provider', 'h2-ref-a', 'Paystack shows it refunded'));
  IF v_err NOT LIKE '%trip_cancel_refund_too_recent%' THEN RAISE EXCEPTION 'O-2b too recent: %', v_err; END IF;
  UPDATE public.paystack_refund_attempts SET updated_at = now() - interval '3 hours'
   WHERE local_refund_id IN (SELECT refund_a FROM h2 UNION ALL SELECT refund_b FROM h2)
     AND merchant_note NOT LIKE '%:deposit';
END $$;

-- O-3. Refusals.
DO $$
DECLARE v_att uuid; v_dep uuid; v_err text; v_list jsonb; v_view jsonb;
BEGIN
  PERFORM pg_temp.act_as('45220009-0000-4000-8000-000000000002');
  SELECT pa.id INTO v_att FROM public.paystack_refund_attempts pa, h2
   WHERE pa.local_refund_id = h2.refund_a AND pa.merchant_note NOT LIKE '%:deposit';
  SELECT pa.id INTO v_dep FROM public.paystack_refund_attempts pa, h2
   WHERE pa.local_refund_id = h2.refund_a AND pa.merchant_note LIKE '%:deposit';
  v_list := public.issue_4522_list_unanswered_trip_cancel_refunds();
  IF jsonb_array_length(v_list) <> 2 THEN RAISE EXCEPTION 'O-3a both stuck cancels are listed: %', v_list; END IF;
  v_view := public.issue_4522_get_unanswered_trip_cancel_refund((SELECT refund_a FROM h2));
  IF v_view->>'trip_name' <> 'Lagos to Accra' OR (v_view->>'unconfirmed_amount_cents')::bigint <> 30600000
     OR jsonb_array_length(v_view->'charges') <> 2
     OR v_view->'charges'->0->>'state' <> 'recorded' OR v_view->'charges'->1->>'state' <> 'unanswered'
     OR (v_view->'charges'->1->>'actionable')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'O-3b the panel shows the deposit recorded and the instalment unanswered: %', v_view;
  END IF;
  v_err := pg_temp.raised(format('SELECT public.issue_4522_resolve_trip_cancel_refund_by_ops(%L, %L, %L, %L)',
    v_att, 'refunded_at_provider', '  ', 'Paystack shows it refunded'));
  IF v_err NOT LIKE '%provider_refund_reference_required%' THEN RAISE EXCEPTION 'O-3c reference required: %', v_err; END IF;
  v_err := pg_temp.raised(format('SELECT public.issue_4522_resolve_trip_cancel_refund_by_ops(%L, %L, %L, %L)',
    v_att, 'refunded_at_provider', 'h2-ref-a', 'no'));
  IF v_err NOT LIKE '%reason_invalid_length%' THEN RAISE EXCEPTION 'O-3d reason required: %', v_err; END IF;
  v_err := pg_temp.raised(format('SELECT public.issue_4522_resolve_trip_cancel_refund_by_ops(%L, %L, %L, %L)',
    v_att, 'refunded_at_provider', 'h2dep-00a1', 'Paystack shows it refunded'));
  IF v_err NOT LIKE '%provider_refund_reference_already_used%' THEN RAISE EXCEPTION 'O-3e reused reference: %', v_err; END IF;
  -- Pass 8 (P8-5): the same reference in another case, with spaces, is the same reference.
  v_err := pg_temp.raised(format('SELECT public.issue_4522_resolve_trip_cancel_refund_by_ops(%L, %L, %L, %L)',
    v_att, 'refunded_at_provider', '  H2DEP-00A1 ', 'Paystack shows it refunded'));
  IF v_err IS NULL OR v_err NOT LIKE '%provider_refund_reference_already_used%' THEN
    RAISE EXCEPTION 'O-3e2 a reused reference in another case is refused: %', v_err;
  END IF;
  v_err := pg_temp.raised(format('SELECT public.issue_4522_resolve_trip_cancel_refund_by_ops(%L, %L, %L, %L, %s, %L)',
    v_att, 'refunded_at_provider', 'h2-ref-a', 'Paystack shows it refunded', 30000000, 'ngn'));
  IF v_err NOT LIKE '%amount_or_currency_mismatch%' THEN RAISE EXCEPTION 'O-3f different amount: %', v_err; END IF;
  v_err := pg_temp.raised(format('SELECT public.issue_4522_resolve_trip_cancel_refund_by_ops(%L, %L, %L, %L, %s, %L)',
    v_att, 'refunded_at_provider', 'h2-ref-a', 'Paystack shows it refunded', 30600000, 'usd'));
  IF v_err NOT LIKE '%amount_or_currency_mismatch%' THEN RAISE EXCEPTION 'O-3g different currency: %', v_err; END IF;
  v_err := pg_temp.raised(format('SELECT public.issue_4522_resolve_trip_cancel_refund_by_ops(%L, %L, %L, %L)',
    v_dep, 'refunded_at_provider', 'h2-ref-x', 'Paystack shows it refunded'));
  IF v_err NOT LIKE '%trip_cancel_refund_already_confirmed%' THEN RAISE EXCEPTION 'O-3h already confirmed: %', v_err; END IF;
END $$;

-- O-4. Escalate changes no money.
DO $$
DECLARE v_att uuid; v_res jsonb; v_before jsonb; v_after jsonb;
BEGIN
  PERFORM pg_temp.act_as('45220009-0000-4000-8000-000000000002');
  SELECT pa.id INTO v_att FROM public.paystack_refund_attempts pa, h2
   WHERE pa.local_refund_id = h2.refund_a AND pa.merchant_note NOT LIKE '%:deposit';
  SELECT jsonb_build_object('o', to_jsonb(o) - 'updated_at',
           'i', (SELECT jsonb_agg(to_jsonb(oi) - 'updated_at' ORDER BY oi.ordinal) FROM public.order_installments oi WHERE oi.order_id = o.id),
           'a', (SELECT to_jsonb(pa) - 'updated_at' FROM public.paystack_refund_attempts pa WHERE pa.id = v_att),
           's', (SELECT status FROM public.refunds r, h2 WHERE r.id = h2.refund_a))
    INTO v_before FROM public.orders o WHERE o.id = '45220009-0000-4000-8000-0000000000a1';
  v_res := public.issue_4522_resolve_trip_cancel_refund_by_ops(v_att, 'escalate', NULL, 'Paystack shows no refund for it');
  IF NOT (v_res->>'ok')::boolean OR v_res->>'outcome' <> 'escalate' OR v_res ? 'reference' THEN
    RAISE EXCEPTION 'O-4a escalated: %', v_res;
  END IF;
  SELECT jsonb_build_object('o', to_jsonb(o) - 'updated_at',
           'i', (SELECT jsonb_agg(to_jsonb(oi) - 'updated_at' ORDER BY oi.ordinal) FROM public.order_installments oi WHERE oi.order_id = o.id),
           'a', (SELECT to_jsonb(pa) - 'updated_at' FROM public.paystack_refund_attempts pa WHERE pa.id = v_att),
           's', (SELECT status FROM public.refunds r, h2 WHERE r.id = h2.refund_a))
    INTO v_after FROM public.orders o WHERE o.id = '45220009-0000-4000-8000-0000000000a1';
  IF v_before IS DISTINCT FROM v_after THEN RAISE EXCEPTION 'O-4b escalate changed money: % -> %', v_before, v_after; END IF;
  IF NOT (public.issue_4522_get_unanswered_trip_cancel_refund((SELECT refund_a FROM h2))->>'escalated')::boolean THEN
    RAISE EXCEPTION 'O-4c the item shows escalated';
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE action = 'trip_cancel_refund.escalated_by_ops'
        AND user_id = '45220009-0000-4000-8000-000000000002') <> 1 THEN
    RAISE EXCEPTION 'O-4d one escalation audit row, naming who';
  END IF;
  -- Pass 8 (P8-4): the audit row itself says why (no reference on an escalation).
  IF (SELECT count(*) FROM public.audit_log WHERE action = 'trip_cancel_refund.escalated_by_ops'
        AND after->>'reason' = 'Paystack shows no refund for it'
        AND after ? 'provider_refund_reference' AND after->'provider_refund_reference' = 'null'::jsonb) <> 1 THEN
    RAISE EXCEPTION 'O-4e the escalation audit row carries the reason';
  END IF;
END $$;

-- O-5. Record on order A by staff; order B confirmed by the provider path.
DO $$
DECLARE v_att uuid; v_row_a uuid; v_row_b uuid; v_res jsonb; v_a jsonb; v_b jsonb; v_ref_b uuid;
BEGIN
  PERFORM pg_temp.act_as('45220009-0000-4000-8000-000000000002');
  SELECT pa.id, pa.source_id INTO v_att, v_row_a FROM public.paystack_refund_attempts pa, h2
   WHERE pa.local_refund_id = h2.refund_a AND pa.merchant_note NOT LIKE '%:deposit';
  v_res := public.issue_4522_resolve_trip_cancel_refund_by_ops(v_att, 'refunded_at_provider', ' h2-ref-a ',
    'Paystack dashboard shows refund h2-ref-a', 30600000, 'NGN');
  IF NOT (v_res->>'ok')::boolean OR v_res->>'reference' <> 'h2-ref-a' OR (v_res->>'unanswered_left')::int <> 0
     OR (v_res->>'idempotent_replay')::boolean THEN
    RAISE EXCEPTION 'O-5a recorded: %', v_res;
  END IF;
  SELECT h2.refund_b INTO v_ref_b FROM h2;
  SELECT pa.source_id INTO v_row_b FROM public.paystack_refund_attempts pa
   WHERE pa.local_refund_id = v_ref_b AND pa.merchant_note NOT LIKE '%:deposit';
  PERFORM public.record_paystack_refund_outcome('order_installment', v_row_b, v_ref_b,
    'mingla-inst-45220009-0000-4000-8000-0000000000b1', 'mingla_trip_refund:' || v_ref_b || ':' || v_row_b,
    'h2-ref-b', 30600000, 'processed');
  SELECT jsonb_build_object('order_refunded', o.refunded_amount_cents, 'status', o.payment_status,
           'row_refunded', oi.refunded_amount_cents, 'row_payout', oi.payout_accounting_state,
           'applications', (SELECT count(*) FROM public.order_installment_refund_applications x WHERE x.installment_id = oi.id),
           'item_now', (SELECT n.net_cents FROM public.issue_4522_payout_item_now('order_installment', oi.id, 30600000, 0, 0, 1350000, 29050000) n),
           'debts', (SELECT count(*) FROM public.organiser_payout_debts d WHERE d.brand_id = '45220009-0000-4000-8000-000000000010'))
    INTO v_a FROM public.orders o JOIN public.order_installments oi ON oi.order_id = o.id
   WHERE oi.id = v_row_a;
  SELECT jsonb_build_object('order_refunded', o.refunded_amount_cents, 'status', o.payment_status,
           'row_refunded', oi.refunded_amount_cents, 'row_payout', oi.payout_accounting_state,
           'applications', (SELECT count(*) FROM public.order_installment_refund_applications x WHERE x.installment_id = oi.id),
           'item_now', (SELECT n.net_cents FROM public.issue_4522_payout_item_now('order_installment', oi.id, 30600000, 0, 0, 1350000, 29050000) n),
           'debts', (SELECT count(*) FROM public.organiser_payout_debts d WHERE d.brand_id = '45220009-0000-4000-8000-000000000010'))
    INTO v_b FROM public.orders o JOIN public.order_installments oi ON oi.order_id = o.id
   WHERE oi.id = v_row_b;
  IF v_a IS DISTINCT FROM v_b THEN
    RAISE EXCEPTION 'O-5b staff recording equals a provider-confirmed refund: % vs %', v_a, v_b;
  END IF;
  IF (v_a->>'row_refunded')::bigint <> 30600000 OR (v_a->>'order_refunded')::bigint <> 30000000
     OR (v_a->>'applications')::int <> 1 THEN
    RAISE EXCEPTION 'O-5c the instalment and the deposit are each refunded once: %', v_a;
  END IF;
  IF (SELECT provider_refund_id FROM public.paystack_refund_attempts WHERE id = v_att) <> 'h2-ref-a'
     OR (SELECT status FROM public.paystack_refund_attempts WHERE id = v_att) <> 'processed' THEN
    RAISE EXCEPTION 'O-5d the attempt carries the staff reference, processed';
  END IF;
  -- Pass 8 (P8-4): the audit row carries who, when, why and the (trimmed) reference.
  IF (SELECT count(*) FROM public.audit_log WHERE action = 'trip_cancel_refund.recorded_by_ops'
        AND user_id = '45220009-0000-4000-8000-000000000002' AND created_at IS NOT NULL
        AND after->>'reason' = 'Paystack dashboard shows refund h2-ref-a'
        AND after->>'provider_refund_reference' = 'h2-ref-a') <> 1 THEN
    RAISE EXCEPTION 'O-5f the record audit row carries who, when, why and the reference: %',
      (SELECT jsonb_agg(after) FROM public.audit_log WHERE action = 'trip_cancel_refund.recorded_by_ops');
  END IF;
  IF public.issue_4522_get_unanswered_trip_cancel_refund((SELECT refund_a FROM h2)) IS NOT NULL
     OR jsonb_array_length(public.issue_4522_list_unanswered_trip_cancel_refunds()) <> 0 THEN
    RAISE EXCEPTION 'O-5e the item leaves the queue';
  END IF;
END $$;

-- O-6. Replays and later actions.
DO $$
DECLARE v_att uuid; v_res jsonb; v_err text;
BEGIN
  PERFORM pg_temp.act_as('45220009-0000-4000-8000-000000000002');
  SELECT pa.id INTO v_att FROM public.paystack_refund_attempts pa, h2
   WHERE pa.local_refund_id = h2.refund_a AND pa.merchant_note NOT LIKE '%:deposit';
  v_res := public.issue_4522_resolve_trip_cancel_refund_by_ops(v_att, 'refunded_at_provider', 'h2-ref-a',
    'Paystack dashboard shows refund h2-ref-a');
  IF NOT (v_res->>'idempotent_replay')::boolean OR v_res->>'reference' <> 'h2-ref-a' THEN
    RAISE EXCEPTION 'O-6a a second call is a no-op returning the same result: %', v_res;
  END IF;
  IF (SELECT refunded_amount_cents FROM public.order_installments WHERE id =
        (SELECT source_id FROM public.paystack_refund_attempts WHERE id = v_att)) <> 30600000
     OR (SELECT count(*) FROM public.audit_log WHERE action = 'trip_cancel_refund.recorded_by_ops') <> 1 THEN
    RAISE EXCEPTION 'O-6b nothing recorded twice';
  END IF;
  v_err := pg_temp.raised(format('SELECT public.issue_4522_resolve_trip_cancel_refund_by_ops(%L, %L, %L, %L)',
    v_att, 'escalate', NULL, 'Second thoughts'));
  IF v_err NOT LIKE '%trip_cancel_refund_already_resolved%' THEN RAISE EXCEPTION 'O-6c escalate after record: %', v_err; END IF;
  v_err := pg_temp.raised(format('SELECT public.issue_4522_resolve_trip_cancel_refund_by_ops(%L, %L, %L, %L)',
    v_att, 'refunded_at_provider', 'h2-ref-other', 'Different reference'));
  IF v_err NOT LIKE '%trip_cancel_refund_already_resolved%' THEN RAISE EXCEPTION 'O-6d another reference: %', v_err; END IF;
END $$;

-- O-7. The cancel is resumed and completes exactly once.
DO $$
DECLARE v_refund uuid;
BEGIN
  SELECT refund_a INTO v_refund FROM h2;
  IF (SELECT (metadata #>> '{trip_cancel,failures}')::int FROM public.refunds WHERE id = v_refund) <> 0
     OR '45220009-0000-4000-8000-0000000000a1'::uuid NOT IN (SELECT public.issue_4522_trip_cancels_to_resume(50)) THEN
    RAISE EXCEPTION 'O-7a the next instalment run resumes the cancel';
  END IF;
  -- what cancel-trip-booking's resume does once every refund is made
  IF NOT (public.biz_cancel_trip_booking_commit(v_refund, ARRAY['h2-ref-a', 'h2dep-00a1'], 0)->>'ok')::boolean
     OR (SELECT refunded_amount_cents FROM public.orders WHERE id = '45220009-0000-4000-8000-0000000000a1') <> 30000000
     OR public.issue_4522_settle_trip_cancel_status('45220009-0000-4000-8000-0000000000a1') <> 'refunded' THEN
    RAISE EXCEPTION 'O-7b the commit settles the cancel once and the booking ends refunded';
  END IF;
  IF NOT (public.issue_4522_trip_cancel_note(v_refund, 'completed', NULL)->>'first_completion')::boolean
     OR (public.issue_4522_trip_cancel_note(v_refund, 'completed', NULL)->>'first_completion')::boolean THEN
    RAISE EXCEPTION 'O-7c it completes exactly once (one buyer email)';
  END IF;
END $$;

ROLLBACK;
