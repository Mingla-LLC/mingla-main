-- MINGLA-INVARIANT: I-4522-CHARGE-IS-WHAT-IS-OWED | issue #4522 | A planned charge is confirmed only after its row is marked in flight under the order lock for exactly the amount it was created for; no rollover or re-spread changes a row in flight, so what lands is what the row owes.
-- MINGLA-INVARIANT: I-4522-SAFEUPDATE | issue #4522 | Every #4522 money function runs in a hosted PostgREST session (pg-safeupdate preloaded) as the role that really calls it: the flexible-payment lifecycle, verified release, overpayment return, refund compute, cancel, add-on refund helpers, the RSVP add-on wrapper and the door scan never issue a DELETE or UPDATE without a WHERE clause.
\set ON_ERROR_STOP on

-- issue #4522 N1. Hosted Supabase preloads pg-safeupdate for every PostgREST
-- session (authenticator: session_preload_libraries=safeupdate), so a bare
-- "DELETE FROM pg_temp.x;" raises 21000 and the edge's RPC fails: before the
-- fix every flexible payment was collected and never applied. This suite
-- loads the library and calls each function AS service_role (the edge) or
-- authenticated (the apps), the way production does. Rolled back.
--
-- FAILS-ON-REVERT: drop "WHERE true" from any of the three temp-table
-- DELETEs in issue_4522_rebalance_order -> S-SETTLE raises 21000.

BEGIN;
LOAD 'safeupdate';

CREATE FUNCTION public.t4522su_raised(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN 'ok:' || COALESCE(v, 'null');
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || SQLSTATE || ':' || SQLERRM;
END $$;

CREATE FUNCTION public.t4522su_check(p_label text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL %: %', p_label, COALESCE(p_detail, '(no detail)');
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;
GRANT EXECUTE ON FUNCTION public.t4522su_raised(text), public.t4522su_check(text, boolean, text)
  TO service_role, authenticated;

-- ── Fixture (as the migration owner) ──────────────────────────────────────
INSERT INTO auth.users(id, email) VALUES
  ('4522a500-0000-4000-8000-000000000001', 'su-host@example.test'),
  ('4522a500-0000-4000-8000-000000000002', 'su-buyer@example.test'),
  ('4522a500-0000-4000-8000-000000000003', 'su-guest@example.test');
INSERT INTO public.creator_accounts(id, email) VALUES ('4522a500-0000-4000-8000-000000000001', 'su-host@example.test');
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES ('4522a500-0000-4000-8000-000000000002', '+2348000045221');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country)
VALUES ('4522a500-0000-4000-8000-000000000010', '4522a500-0000-4000-8000-000000000001', 'SU ps', 'su-ps-4522', 'NGN', 'paystack', 'NG'),
       ('4522a500-0000-4000-8000-000000000011', '4522a500-0000-4000-8000-000000000001', 'SU st', 'su-st-4522', 'USD', 'stripe', 'US');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency, published_at,
  rsvp_allow_plus_ones, rsvp_plus_ones_max)
VALUES ('4522a500-0000-4000-8000-000000000020', '4522a500-0000-4000-8000-000000000010', '4522a500-0000-4000-8000-000000000001', 'SU trip NG', 'su-trip-ng', 'trip', 'scheduled', 'public', 'Africa/Lagos', 'NGN', now(), false, 0),
       ('4522a500-0000-4000-8000-000000000021', '4522a500-0000-4000-8000-000000000011', '4522a500-0000-4000-8000-000000000001', 'SU trip US', 'su-trip-us', 'trip', 'scheduled', 'public', 'America/New_York', 'USD', now(), false, 0),
       ('4522a500-0000-4000-8000-000000000022', '4522a500-0000-4000-8000-000000000011', '4522a500-0000-4000-8000-000000000001', 'SU rsvp', 'su-rsvp', 'rsvp', 'scheduled', 'public', 'UTC', 'USD', now(), true, 3);
INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total, is_unlimited, min_purchase_qty, available_online, available_in_person)
VALUES ('4522a500-0000-4000-8000-000000000030', '4522a500-0000-4000-8000-000000000020', 'A', 120000000, 'NGN', false, 20, false, 1, true, false),
       ('4522a500-0000-4000-8000-000000000040', '4522a500-0000-4000-8000-000000000021', 'SA', 120000, 'USD', false, 20, false, 1, true, false),
       ('4522a500-0000-4000-8000-000000000041', '4522a500-0000-4000-8000-000000000021', 'SB', 120000, 'USD', false, 20, false, 1, true, false);
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
 ('4522a500-0000-4000-8000-000000000020', '2027-03-12T09:00Z', '2027-03-19T09:00Z', 'Africa/Lagos', true),
 ('4522a500-0000-4000-8000-000000000021', '2027-03-12T09:00Z', '2027-03-19T09:00Z', 'America/New_York', true),
 ('4522a500-0000-4000-8000-000000000022', now() - interval '1 hour', now() + interval '2 hours', 'UTC', true);

UPDATE public.events SET refund_policy = '{"kind":"custom","tiers":[{"days_before_start":0,"refund_pct":50}]}'
 WHERE id = '4522a500-0000-4000-8000-000000000021';

CREATE FUNCTION public.t4522su_seed(p_order uuid, p_provider text, p_rows jsonb) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_st boolean := p_provider = 'stripe';
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source, installment_plan_root, payment_plan_terms, stripe_payment_intent_id)
  VALUES (p_order, CASE WHEN v_st THEN '4522a500-0000-4000-8000-000000000021'::uuid ELSE '4522a500-0000-4000-8000-000000000020'::uuid END,
    '4522a500-0000-4000-8000-000000000002', 'su-buyer@example.test', 'SU Buyer', '+2348000045221',
    CASE WHEN v_st THEN 30000 ELSE 30000000 END, CASE WHEN v_st THEN 'USD' ELSE 'NGN' END, 'online_card', 'paid',
    'online_checkout', true,
    jsonb_build_object('v', 2, 'flex_enabled', true, 'min_payment_minor', CASE WHEN v_st THEN 5000 ELSE 5000000 END,
      'auto_adjust', true, 'deposit_minor', CASE WHEN v_st THEN 30000 ELSE 30000000 END, 'time_zone', 'Africa/Lagos'),
    'pi_dep_' || p_order::text);
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, plan_bound_at, buyer_total_cents, planned_application_fee_cents, ticket_type_id, addon_portion_minor)
  SELECT p_order, o::int, (r->>'amt')::bigint, CASE WHEN v_st THEN 'USD' ELSE 'NGN' END, (r->>'due')::timestamptz,
         'scheduled', p_provider, CASE WHEN v_st THEN 'auto_card' ELSE 'pay_link' END,
         CASE WHEN v_st THEN NULL ELSE now() END,
         CASE WHEN v_st THEN NULL ELSE (r->>'amt')::bigint * 102 / 100 END,
         (r->>'amt')::bigint * 45 / 1000, (r->>'tt')::uuid, 0
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY a(r, o);
END $$;
CREATE FUNCTION public.t4522su_row(p_order uuid, p_ord int) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.order_installments WHERE order_id = p_order AND ordinal = p_ord $$;
CREATE FUNCTION public.t4522su_flex(p_order uuid, p_key text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.order_installments WHERE order_id = p_order AND flex_client_key = p_key $$;
GRANT EXECUTE ON FUNCTION public.t4522su_row(uuid, int), public.t4522su_flex(uuid, text) TO service_role, authenticated;
-- The overpayment's state, for assertions only (the table is closed to service_role).
CREATE FUNCTION public.t4522su_op_state(p_id uuid) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT state FROM public.order_overpayments WHERE id = p_id $$;
GRANT EXECUTE ON FUNCTION public.t4522su_op_state(uuid) TO service_role;

-- S: Stripe, two packages. P: Paystack (rollover, attempts). R: refunds.
SELECT public.t4522su_seed('4522a500-0000-4000-8000-0000000000a1', 'stripe',
  '[{"tt":"4522a500-0000-4000-8000-000000000040","due":"2026-12-17T14:00Z","amt":30000},
    {"tt":"4522a500-0000-4000-8000-000000000040","due":"2027-02-10T14:00Z","amt":30000},
    {"tt":"4522a500-0000-4000-8000-000000000041","due":"2027-02-10T14:00Z","amt":30000}]');
SELECT public.t4522su_seed('4522a500-0000-4000-8000-0000000000a2', 'paystack',
  '[{"tt":"4522a500-0000-4000-8000-000000000030","due":"2026-11-01T08:00Z","amt":30000000},
    {"tt":"4522a500-0000-4000-8000-000000000030","due":"2027-01-13T08:00Z","amt":30000000},
    {"tt":"4522a500-0000-4000-8000-000000000030","due":"2027-02-10T08:00Z","amt":30000000}]');
SELECT public.t4522su_seed('4522a500-0000-4000-8000-0000000000a3', 'stripe',
  '[{"tt":"4522a500-0000-4000-8000-000000000040","due":"2027-01-13T14:00Z","amt":45000},
    {"tt":"4522a500-0000-4000-8000-000000000040","due":"2027-02-10T14:00Z","amt":45000}]');
UPDATE public.order_installments SET status = 'failed', retry_count = 3, failed_at = now(), failure_reason = 'card_declined'
 WHERE id = public.t4522su_row('4522a500-0000-4000-8000-0000000000a2', 1);

-- ── The edge: service_role ────────────────────────────────────────────────
SET ROLE service_role;

DO $t$
DECLARE
  s uuid := '4522a500-0000-4000-8000-0000000000a1';
  v jsonb; v_flex uuid; v_txt text;
BEGIN
  -- S-BEGIN / S-SETTLE: a flexible payment is begun, collected and applied.
  v := public.issue_4522_begin_flex_payment(s, 30000, 90000, 'su-key-000001', 'auto_card');
  v_flex := (v->>'installmentId')::uuid;
  PERFORM public.t4522su_check('S-BEGIN as service_role', v_flex IS NOT NULL, v::text);
  UPDATE public.order_installments SET status = 'collected', collected_at = now(), stripe_payment_intent_id = 'pi_su_1'
   WHERE id = v_flex AND status IN ('scheduled', 'failed');
  v_txt := public.t4522su_raised(format('SELECT public.issue_4522_settle_flex_payment(%L)::text', v_flex));
  PERFORM public.t4522su_check('S-SETTLE runs under pg-safeupdate (no 21000)', v_txt LIKE 'ok:%' AND v_txt NOT LIKE '%21000%', v_txt);
  v := public.issue_4522_settle_flex_payment(v_flex);
  PERFORM public.t4522su_check('S-SETTLE replays', (v->>'replayed')::boolean AND (v->>'remainingMinor')::bigint = 60000, v::text);
  v := public.record_order_installment_provider_sale(v_flex, 1350, 0);
  PERFORM public.t4522su_check('S-PAYOUT a settled payment is payout-ready',
    (v->>'payout_accounting_state') = 'ready', v::text);
  PERFORM public.t4522su_check('S-CLAIM the cron claims again after the settlement',
    (public.claim_order_installment_for_charge(public.t4522su_row(s, 1))->>'ok')::boolean);

  -- S-OVERPAY: a planned row lands while a flexible payment of the rest is open.
  v := public.issue_4522_begin_flex_payment(s, 60000, 60000, 'su-key-000002', 'auto_card');
  v_flex := (v->>'installmentId')::uuid;
  UPDATE public.order_installments SET status = 'collected', collected_at = now(), stripe_payment_intent_id = 'pi_su_row1'
   WHERE id = public.t4522su_row(s, 1) AND status IN ('scheduled', 'failed');
  UPDATE public.order_installments SET status = 'collected', collected_at = now(), stripe_payment_intent_id = 'pi_su_2'
   WHERE id = v_flex AND status IN ('scheduled', 'failed');
  v := public.record_order_installment_provider_sale(v_flex, 2700, 0);
  v := public.issue_4522_settle_flex_payment(v_flex);
  PERFORM public.t4522su_check('S-OVERPAY settles and holds what was not owed', (v->>'heldMinor')::bigint > 0, v::text);
  PERFORM public.t4522su_check('S-OVERPAY the row waits outside payouts',
    (SELECT payout_accounting_state FROM public.order_installments WHERE id = v_flex) = 'pending');
  v := public.issue_4522_overpayments_due(s, now(), 10);
  PERFORM public.t4522su_check('S-REFUND the overpayment is due', jsonb_array_length(v) = 1, v::text);
  v := public.issue_4522_begin_overpayment_refund((v->0->>'overpaymentId')::uuid, NULL, true);
  PERFORM public.t4522su_check('S-REFUND begin creates the linked refund', v->>'refundId' IS NOT NULL
    AND v->>'idempotencyKey' LIKE 'mingla_overpay_refund:%:1', v::text);
  PERFORM public.t4522su_check('S-REFUND unknown keeps it pending',
    public.issue_4522_finish_overpayment_refund((v->>'overpaymentId')::uuid, 1, 'unknown', NULL, 'timeout')->>'state' = 'refund_pending');
  PERFORM public.t4522su_check('S-REFUND a second sweep while the answer may still be coming is told busy (T4-1)',
    public.issue_4522_begin_overpayment_refund((v->>'overpaymentId')::uuid, NULL, true)->>'reason' = 'busy');
  PERFORM public.t4522su_check('S-REFUND resume verifies the same attempt (same key), never a new one',
    public.issue_4522_begin_overpayment_refund((v->>'overpaymentId')::uuid, NULL, true, now() + interval '3 minutes')->'attempts'->0->>'idempotencyKey' = v->>'idempotencyKey');
  PERFORM public.t4522su_check('S-REFUND succeeded',
    public.issue_4522_finish_overpayment_refund((v->>'overpaymentId')::uuid, 1, 'succeeded', 're_su_1')->>'state' = 'refunded');
  PERFORM public.t4522su_check('S-REFUND the row is payout-ready for what it kept',
    (SELECT payout_accounting_state = 'ready' AND refunded_amount_cents > 0 FROM public.order_installments WHERE id = v_flex));

  -- S-COMPUTE / S-CANCEL: refund compute and the cancel write path.
  v := public.issue_4522_compute_refund_for_cancel_as(s, now(), 'buyer');
  PERFORM public.t4522su_check('S-COMPUTE refund compute', (v->>'ok')::boolean, v::text);
  v := public.biz_cancel_trip_booking_begin(s, 'buyer', '4522a500-0000-4000-8000-000000000002', 'Changed my plans for the trip', now());
  PERFORM public.t4522su_check('S-CANCEL begin', v IS NOT NULL, COALESCE(v::text, 'null'));
  PERFORM public.t4522su_check('S-NOTICE paid-in-full claim runs',
    public.t4522su_raised(format('SELECT public.issue_4522_claim_paid_in_full_notice(%L, %L)::text', s, 'su')) LIKE 'ok:%');
  -- Pass 6 (S9-1 / S9-2): the trip-cancel commit (order figure, payment
  -- status) and the paid-in-full retry list never trip pg-safeupdate (this
  -- order's instalment parts are not marked here, so the commit may refuse
  -- on the order's own check; only a 21000 is a failure).
  PERFORM public.t4522su_check('S9 trip-cancel commit runs',
    public.t4522su_raised(format('SELECT public.biz_cancel_trip_booking_commit(%L, ARRAY[%L], 0, now())::text',
      COALESCE(v->>'refund_id', gen_random_uuid()::text), 'su_rf')) NOT LIKE '%21000%',
    public.t4522su_raised(format('SELECT public.biz_cancel_trip_booking_commit(%L, ARRAY[%L], 0, now())::text',
      COALESCE(v->>'refund_id', gen_random_uuid()::text), 'su_rf')));
  PERFORM public.t4522su_check('S9 paid-in-full retry list runs',
    public.t4522su_raised('SELECT count(*)::text FROM public.issue_4522_unsent_paid_in_full(10)') LIKE 'ok:%');

  -- S-ADDONS: the add-on refund helpers (switches off) on the same order.
  FOREACH v_txt IN ARRAY ARRAY[
    format('SELECT public.issue_3281_add_on_refund_lines(%L, %L::jsonb)::text', s, '[]'),
    format('SELECT public.issue_3281_add_on_refund_cents(%L, %L::jsonb, %L::jsonb, false)::text', s, '[]', '[]'),
    format('SELECT public.issue_3281_add_ons_all_returned(%L, false)::text', s),
    format('SELECT public.issue_3281_order_has_open_spread(%L)::text', s),
    format('SELECT public.issue_3281_add_on_plan_split(%L, %L::jsonb)::text', s, '[]')
  ] LOOP
    PERFORM public.t4522su_check('S-ADDONS ' || left(v_txt, 60),
      public.t4522su_raised(v_txt) NOT LIKE '%21000%', public.t4522su_raised(v_txt));
  END LOOP;
END
$t$;

DO $t$
DECLARE
  p uuid := '4522a500-0000-4000-8000-0000000000a2';
  r uuid := '4522a500-0000-4000-8000-0000000000a3';
  v jsonb; v_flex uuid; v_op uuid;
BEGIN
  -- P-ROLLOVER: the third missed payment rolls onto the later rows.
  v := public.issue_4522_missed_rollover(public.t4522su_row(p, 1), now());
  PERFORM public.t4522su_check('P-ROLLOVER under pg-safeupdate', (v->>'rolledOver')::boolean, v::text);

  -- P-VERIFY: an open payment past the window, never attempted: listed, then
  -- released only with the provider-verified reason; a stuck one is flagged.
  v := public.issue_4522_begin_flex_payment(p, 10000000, 90000000, 'su-key-000003', 'pay_link', now() - interval '2 days');
  v_flex := (v->>'installmentId')::uuid;
  v := public.issue_4522_flex_payments_to_verify(NULL, now(), 50);
  PERFORM public.t4522su_check('P-VERIFY the sweep lists it',
    EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE x->>'installmentId' = v_flex::text AND (x->>'pastCeiling')::boolean), v::text);
  PERFORM public.t4522su_check('P-VERIFY flag stuck (once)',
    public.issue_4522_flag_stuck_flex(v_flex, 'processing') AND NOT public.issue_4522_flag_stuck_flex(v_flex, 'processing'));
  v := public.issue_4522_release_flex_verified(v_flex, 'no_provider_charge', NULL);
  PERFORM public.t4522su_check('P-VERIFY release', (v->>'released')::boolean, v::text);

  -- P-ATTEMPT: a Paystack flexible payment's attempt starts and closes.
  v := public.issue_4522_begin_flex_payment(p, 10000000, (SELECT sum(amount_cents) FROM public.order_installments
         WHERE order_id = p AND kind = 'scheduled' AND status IN ('scheduled', 'failed'))::bigint, 'su-key-000004', 'pay_link');
  v_flex := (v->>'installmentId')::uuid;
  v := public.issue_3645_begin_installment_attempt(v_flex, 'pay_link', 0, false, now());
  PERFORM public.t4522su_check('P-ATTEMPT begins', (v->>'ok')::boolean, v::text);
  v := public.issue_3645_resolve_installment_attempt((v->>'attempt_id')::uuid, 'failed', NULL, 'declined', NULL, NULL, NULL);
  v := public.issue_4522_close_failed_flex(v_flex);
  PERFORM public.t4522su_check('P-CLOSE closes', (v->>'ok')::boolean OR (v->>'closed') IS NOT NULL, v::text);

  -- R-LATE: a planned row superseded while its charge landed, returned in
  -- full; a failed refund is retried with the next attempt.
  v := public.issue_4522_begin_flex_payment(r, 90000, 90000, 'su-key-000005', 'auto_card');
  v_flex := (v->>'installmentId')::uuid;
  UPDATE public.order_installments SET status = 'collected', collected_at = now(), stripe_payment_intent_id = 'pi_su_r'
   WHERE id = v_flex AND status IN ('scheduled', 'failed');
  v := public.issue_4522_settle_flex_payment(v_flex);
  v := public.issue_4522_record_late_collection(public.t4522su_row(r, 1), 45000, 'pi_su_late');
  PERFORM public.t4522su_check('R-LATE held', v->>'outcome' = 'held', v::text);
  SELECT (x->>'overpaymentId')::uuid INTO v_op FROM jsonb_array_elements(public.issue_4522_overpayments_due(r, now(), 10)) x;
  v := public.issue_4522_begin_overpayment_refund(v_op, NULL, true);
  v := public.issue_4522_finish_overpayment_refund(v_op, 1, 'failed', NULL, 'charge_disputed');
  PERFORM public.t4522su_check('R-LATE failed refund waits for its retry', v->>'state' = 'refund_failed', v::text);
  PERFORM public.t4522su_check('R-LATE not retried early',
    public.issue_4522_begin_overpayment_refund(v_op, NULL, true)->>'reason' = 'retry_not_due');
  v := public.issue_4522_begin_overpayment_refund(v_op, NULL, true, now() + interval '2 hours');
  PERFORM public.t4522su_check('R-LATE retried with the next attempt', (v->>'attemptNo')::int = 2, v::text);
  v := public.issue_4522_hold_collected_excess(public.t4522su_row(r, 1), 50000, 'pi_x');
  PERFORM public.t4522su_check('R-EXCESS runs', (v->>'ok')::boolean, v::text);

  -- T3 (third rework): the attempt lane, provider events, ops actions, the
  -- event-cancel refund, a short collection and an abandoned release, all as
  -- service_role under pg-safeupdate.
  v := public.issue_4522_finish_overpayment_refund(v_op, 2, 'pending', 're_su_t3');
  PERFORM public.t4522su_check('T3 pending stores the refund id', v->>'state' = 'refund_pending', v::text);
  v := public.issue_4522_overpayment_refund_event('stripe', 're_su_t3', 'pi_su_late', 45000, 'failed');
  PERFORM public.t4522su_check('T3 event by refund id (failed)', (v->>'handled')::boolean, v::text);
  v := public.issue_4522_begin_overpayment_refund(v_op, 2, true, now() + interval '5 hours');
  v := public.issue_4522_overpayment_refund_event('stripe', 're_su_meta', 'pi_su_late', (v->>'amountMinor')::bigint, 'pending',
         v_op, (v->>'attemptNo')::int);
  PERFORM public.t4522su_check('T3 event by metadata', v->>'matchedBy' = 'metadata', v::text);
  v := public.issue_4522_overpayment_refund_event('stripe', 're_su_meta', 'pi_su_late', 45000, 'failed');
  PERFORM public.t4522su_check('T3 the third refusal stops it',
    public.t4522su_op_state(v_op) = 'needs_ops', v::text);
  v := public.issue_4522_overpayment_refund_event('stripe', 're_su_dash', 'pi_su_late', 45000, 'succeeded', NULL, NULL, false);
  PERFORM public.t4522su_check('T3 a dashboard refund is matched', v->>'matchedBy' = 'provider_charge'
    AND public.t4522su_op_state(v_op) = 'refunded', v::text);
  v := public.issue_4522_overpayment_refund_event('stripe', 're_su_dash', 'pi_su_late', 45000, 'failed');
  PERFORM public.t4522su_check('T3 a reversed refund stops it for ops',
    public.t4522su_op_state(v_op) = 'needs_ops', v::text);
  v := public.issue_4522_resolve_overpayment_by_ops(v_op, 'retry', '4522a500-0000-4000-8000-000000000001');
  PERFORM public.t4522su_check('T3 ops retry', v->>'state' = 'held', v::text);
  v := public.issue_4522_resolve_overpayment_by_ops(v_op, 'refunded_by_hand', '4522a500-0000-4000-8000-000000000001', 'su-manual');
  PERFORM public.t4522su_check('T3 ops by hand', v->>'state' = 'refunded', v::text);
  v := public.issue_3645_cancel_refund_installment(v_flex, 'The host cancelled this trip', 'su-cancel-1');
  PERFORM public.t4522su_check('T3 event-cancel refund prepare', (v->>'amount_cents')::bigint > 0, v::text);
  v := public.issue_4522_mark_stripe_charge_in_flight(public.t4522su_row('4522a500-0000-4000-8000-0000000000a1', 2),
         'pi_su_short', (SELECT amount_cents FROM public.order_installments WHERE id = public.t4522su_row('4522a500-0000-4000-8000-0000000000a1', 2)),
         (SELECT schedule_version FROM public.order_installments WHERE id = public.t4522su_row('4522a500-0000-4000-8000-0000000000a1', 2)));
  PERFORM public.t4522su_check('T3 marking a Stripe charge in flight runs', v ? 'ok', v::text);
  UPDATE public.order_installments SET status = 'collected', collected_at = now(), stripe_payment_intent_id = 'pi_su_short'
   WHERE id = public.t4522su_row('4522a500-0000-4000-8000-0000000000a1', 2) AND status IN ('scheduled', 'failed');
  v := public.issue_4522_record_short_collection(public.t4522su_row('4522a500-0000-4000-8000-0000000000a1', 2), 100, 'pi_su_short');
  PERFORM public.t4522su_check('T3 short collection', (v->>'ok')::boolean, v::text);
  v := public.issue_4522_release_flex_verified(v_flex, 'provider_abandoned', 'mingla-inst-x-l1');
  PERFORM public.t4522su_check('T3 abandoned release path runs', v IS NOT NULL, v::text);
END
$t$;

-- ── The apps: authenticated ───────────────────────────────────────────────
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"4522a500-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '4522a500-0000-4000-8000-000000000002', true);
SELECT public.t4522su_check('A-BALANCE the buyer reads the balance under pg-safeupdate',
  (public.biz_trip_order_balance('4522a500-0000-4000-8000-0000000000a3')->>'viewer') = 'buyer');
RESET ROLE;

-- ── RSVP add-on wrapper (service_role) and the door scan (authenticated) ──
SET ROLE service_role;
SELECT public.t4522su_check('RSVP the wrapper runs under pg-safeupdate',
  (public.issue_3281_submit_rsvp_with_add_ons('4522a500-0000-4000-8000-000000000022', '4522a500-0000-4000-8000-000000000003',
     'SU Guest', 'su-guest@example.test', '+15554522001', 'going', 0, '[]', NULL, 'US', false, NULL, '[]')->>'rsvpId') IS NOT NULL);
RESET ROLE;
UPDATE public.event_rsvps SET qr_code = 'mingla:v1:rsvp:' || id || ':sig:' || md5(id::text) || md5(id::text)
 WHERE event_id = '4522a500-0000-4000-8000-000000000022';
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"4522a500-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '4522a500-0000-4000-8000-000000000001', true);
SELECT public.t4522su_check('SCAN the door scan runs under pg-safeupdate',
  (public.biz_rsvp_scan('4522a500-0000-4000-8000-000000000022',
     (SELECT qr_code FROM public.event_rsvps WHERE event_id = '4522a500-0000-4000-8000-000000000022' LIMIT 1))->>'result') = 'success');
RESET ROLE;

ROLLBACK;

-- F. I-4522-CHARGE-IS-WHAT-IS-OWED, two real sessions (dblink), both orders.
--    A planned Stripe charge of row B races the rollover of missed row A.
--    Each session is service_role under pg-safeupdate, as the edge runs.
--    Committed fixtures in their own namespace (the database is suite-owned).
--    Whatever order the two take the order lock in, B is charged exactly what
--    it owes at that moment, A's missed amount is collected in full later,
--    and the order collects exactly what it owes: nothing lost, nothing twice.
\getenv i4522_pw PGPASSWORD
CREATE EXTENSION IF NOT EXISTS dblink;
SELECT n.nspname AS i4522_dblink_schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'dblink' \gset
SET search_path = public, :"i4522_dblink_schema";
CREATE TEMP TABLE i4522_cc AS
SELECT format('host=127.0.0.1 port=%s dbname=%I user=%I password=%s',
  current_setting('port'), current_database(), current_user, :'i4522_pw') AS conn;
INSERT INTO auth.users(id, email) VALUES ('4522cc00-0000-4000-8000-000000000001', 'race2-host@example.test');
INSERT INTO public.creator_accounts(id, email) VALUES ('4522cc00-0000-4000-8000-000000000001', 'race2-host@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country)
VALUES ('4522cc00-0000-4000-8000-000000000010', '4522cc00-0000-4000-8000-000000000001',
        'Race2 brand', 'race2-brand-4522', 'USD', 'stripe', 'US');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency)
VALUES ('4522cc00-0000-4000-8000-000000000020', '4522cc00-0000-4000-8000-000000000010',
        '4522cc00-0000-4000-8000-000000000001', 'Race2 trip', 'race2-trip-4522', 'trip', 'scheduled',
        'public', 'America/New_York', 'USD'),
       -- F-2's order has its own trip: the main session still holds F-1's locks.
       ('4522cc00-0000-4000-8000-000000000021', '4522cc00-0000-4000-8000-000000000010',
        '4522cc00-0000-4000-8000-000000000001', 'Race2 trip B', 'race2-trip-b-4522', 'trip', 'scheduled',
        'public', 'America/New_York', 'USD');
INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total, is_unlimited,
  min_purchase_qty, available_online, available_in_person)
VALUES ('4522cc00-0000-4000-8000-000000000030', '4522cc00-0000-4000-8000-000000000020', 'Room',
        40000, 'USD', false, 20, false, 1, true, false),
       ('4522cc00-0000-4000-8000-000000000031', '4522cc00-0000-4000-8000-000000000021', 'Room',
        40000, 'USD', false, 20, false, 1, true, false);
-- Deposit $100; A (missed: third failure written), B (due now), C (later): $100 each.
INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, currency,
  payment_method, payment_status, source, installment_plan_root, payment_plan_terms)
SELECT o, CASE WHEN o = '4522cc00-0000-4000-8000-0000000000a2' THEN '4522cc00-0000-4000-8000-000000000021'::uuid
            ELSE '4522cc00-0000-4000-8000-000000000020'::uuid END,
       'race2-buyer@example.test', 'Race2 Buyer', '+15554522002',
       10000, 'USD', 'online_card', 'paid', 'online_checkout', true, '{"v":2,"auto_adjust":true,"flex_enabled":false}'
  FROM unnest(ARRAY['4522cc00-0000-4000-8000-0000000000a1', '4522cc00-0000-4000-8000-0000000000a2']::uuid[]) o;
INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
  collection_method, ticket_type_id, retry_count, failed_at, failure_reason)
SELECT o, g, 10000, 'USD', d, CASE g WHEN 1 THEN 'failed' ELSE 'scheduled' END, 'stripe', 'auto_card',
       CASE WHEN o = '4522cc00-0000-4000-8000-0000000000a2' THEN '4522cc00-0000-4000-8000-000000000031'::uuid
            ELSE '4522cc00-0000-4000-8000-000000000030'::uuid END, CASE g WHEN 1 THEN 3 ELSE 0 END,
       CASE g WHEN 1 THEN now() END, CASE g WHEN 1 THEN 'card_declined' END
  FROM unnest(ARRAY['4522cc00-0000-4000-8000-0000000000a1', '4522cc00-0000-4000-8000-0000000000a2']::uuid[]) o,
       (VALUES (1, now() - interval '20 days'), (2, now() - interval '1 hour'), (3, now() + interval '40 days')) v(g, d);

CREATE FUNCTION pg_temp.rows(p_order uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT string_agg(ordinal || ':' || amount_cents || ':' || status || ':v' || schedule_version, ','
                    ORDER BY ordinal)
    FROM public.order_installments WHERE order_id = p_order AND ordinal <= 3
$$;
CREATE FUNCTION pg_temp.rid(p_order uuid, p_ordinal int) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.order_installments WHERE order_id = p_order AND ordinal = p_ordinal $$;
-- The webhook for a charge that landed: collected, then the safety net.
CREATE FUNCTION pg_temp.lands(p_id uuid, p_received bigint, p_pi text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.order_installments SET status = 'collected', collected_at = now(), stripe_payment_intent_id = p_pi
   WHERE id = p_id AND status IN ('scheduled', 'failed');
  RETURN public.issue_4522_record_short_collection(p_id, p_received, p_pi);
END $$;
-- The next charge of a row: read amount and version, mark in flight, land for that amount.
CREATE FUNCTION pg_temp.charge(p_id uuid, p_pi text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_amt bigint; v_ver integer; v jsonb;
BEGIN
  SELECT amount_cents, schedule_version INTO v_amt, v_ver FROM public.order_installments WHERE id = p_id;
  v := public.issue_4522_mark_stripe_charge_in_flight(p_id, p_pi, v_amt, v_ver);
  IF NOT COALESCE((v->>'marked')::boolean, false) THEN RAISE EXCEPTION 'F charge of % not marked: %', p_id, v; END IF;
  v := pg_temp.lands(p_id, v_amt, p_pi);
  IF (v->>'shortMinor')::bigint <> 0 THEN RAISE EXCEPTION 'F charge of % landed short: %', p_id, v; END IF;
  RETURN v_amt;
END $$;

DO $race$
DECLARE
  v_conn text := (SELECT conn FROM i4522_cc);
  o1 uuid := '4522cc00-0000-4000-8000-0000000000a1';
  o2 uuid := '4522cc00-0000-4000-8000-0000000000a2';
  v_roll text; v_mark text; v_b bigint; v_c bigint; v_bal jsonb; v_name text;
BEGIN
  -- One pair of sessions per order, each as the edge runs: service_role
  -- under pg-safeupdate.
  FOREACH v_name IN ARRAY ARRAY['i4522_roll', 'i4522_charge', 'i4522_roll2', 'i4522_charge2'] LOOP
    PERFORM dblink_connect(v_name, v_conn);
    PERFORM dblink_exec(v_name, $q$LOAD 'safeupdate'$q$);
    PERFORM dblink_exec(v_name, 'SET ROLE service_role');
  END LOOP;

  -- F-1 rollover first. The charge fixed B at $100 (version 0) and created its
  -- unconfirmed PaymentIntent; the rollover holds the order lock; the mark waits.
  PERFORM dblink_send_query('i4522_roll', format(
    $q$SELECT r::text, pg_sleep(1) IS NULL FROM (SELECT public.issue_4522_missed_rollover(%L) r) s$q$,
    pg_temp.rid(o1, 1)));
  PERFORM pg_sleep(0.2);
  PERFORM dblink_send_query('i4522_charge', format(
    $q$SELECT public.issue_4522_mark_stripe_charge_in_flight(%L, 'pi_f1_b', 10000, 0)::text$q$, pg_temp.rid(o1, 2)));
  PERFORM pg_sleep(0.2);
  IF dblink_is_busy('i4522_charge') <> 1 THEN RAISE EXCEPTION 'F-1 FAIL: the mark did not wait for the rollover'; END IF;
  SELECT r INTO v_roll FROM dblink_get_result('i4522_roll') AS t(r text, slept boolean);
  SELECT r INTO v_mark FROM dblink_get_result('i4522_charge') AS t(r text);
  IF NOT (v_roll::jsonb->>'rolledOver')::boolean OR v_mark::jsonb->>'reason' IS DISTINCT FROM 'balance_changed'
     OR (SELECT stripe_payment_intent_id FROM public.order_installments WHERE id = pg_temp.rid(o1, 2)) IS NOT NULL
     OR pg_temp.rows(o1) IS DISTINCT FROM '1:10000:superseded:v0,2:15000:scheduled:v1,3:15000:scheduled:v1' THEN
    RAISE EXCEPTION 'F-1 FAIL: a $100 charge must not be confirmed on a row that now owes $150: % / % / %',
      v_roll, v_mark, pg_temp.rows(o1);
  END IF;
  -- The next run charges B for what it now owes, then C: exactly the total.
  v_b := pg_temp.charge(pg_temp.rid(o1, 2), 'pi_f1_b2');
  v_c := pg_temp.charge(pg_temp.rid(o1, 3), 'pi_f1_c');
  v_bal := public.issue_4522_balance(o1);
  IF v_b <> 15000 OR v_c <> 15000 OR (v_bal->>'remainingMinor')::bigint <> 0
     OR (v_bal->>'paidMinor')::bigint <> 40000 OR (v_bal->>'totalMinor')::bigint <> 40000
     OR EXISTS (SELECT 1 FROM public.order_overpayments WHERE order_id = o1) THEN
    RAISE EXCEPTION 'F-1 FAIL: collected % + % of $300 owed: %', v_b, v_c, v_bal;
  END IF;
  RAISE NOTICE 'F-1 PASS: rollover first: the stale $100 charge is refused; B $150 + C $150 = $300 owed';

  -- F-2 charge first. The mark holds the order lock; the rollover waits, then
  -- leaves B (in flight) alone and puts A's $100 on C.
  PERFORM dblink_send_query('i4522_charge2', format(
    $q$SELECT r::text, pg_sleep(1) IS NULL FROM (SELECT public.issue_4522_mark_stripe_charge_in_flight(%L, 'pi_f2_b', 10000, 0) r) s$q$,
    pg_temp.rid(o2, 2)));
  PERFORM pg_sleep(0.2);
  PERFORM dblink_send_query('i4522_roll2', format(
    $q$SELECT public.issue_4522_missed_rollover(%L)::text$q$, pg_temp.rid(o2, 1)));
  PERFORM pg_sleep(0.2);
  IF dblink_is_busy('i4522_roll2') <> 1 THEN RAISE EXCEPTION 'F-2 FAIL: the rollover did not wait for the mark'; END IF;
  SELECT r INTO v_mark FROM dblink_get_result('i4522_charge2') AS t(r text, slept boolean);
  SELECT r INTO v_roll FROM dblink_get_result('i4522_roll2') AS t(r text);
  IF NOT COALESCE((v_mark::jsonb->>'marked')::boolean, false) OR NOT (v_roll::jsonb->>'rolledOver')::boolean
     OR pg_temp.rows(o2) IS DISTINCT FROM '1:10000:superseded:v0,2:10000:scheduled:v0,3:20000:scheduled:v1'
     OR (SELECT at_risk FROM public.orders WHERE id = o2) IS TRUE THEN
    RAISE EXCEPTION 'F-2 FAIL: the row in flight must keep its amount and the missed $100 go to C: % / % / %',
      v_mark, v_roll, pg_temp.rows(o2);
  END IF;
  IF (pg_temp.lands(pg_temp.rid(o2, 2), 10000, 'pi_f2_b')->>'shortMinor')::bigint <> 0 THEN
    RAISE EXCEPTION 'F-2 FAIL: B landed short';
  END IF;
  v_c := pg_temp.charge(pg_temp.rid(o2, 3), 'pi_f2_c');
  v_bal := public.issue_4522_balance(o2);
  IF v_c <> 20000 OR (v_bal->>'remainingMinor')::bigint <> 0
     OR (v_bal->>'paidMinor')::bigint <> 40000 OR (v_bal->>'totalMinor')::bigint <> 40000
     OR EXISTS (SELECT 1 FROM public.order_overpayments WHERE order_id = o2) THEN
    RAISE EXCEPTION 'F-2 FAIL: collected $100 + % of $300 owed: %', v_c, v_bal;
  END IF;
  RAISE NOTICE 'F-2 PASS: charge first: B $100 lands exactly, C $200 = $300 owed';

  FOREACH v_name IN ARRAY ARRAY['i4522_roll', 'i4522_charge', 'i4522_roll2', 'i4522_charge2'] LOOP
    PERFORM dblink_disconnect(v_name);
  END LOOP;
END
$race$;

-- G. The mark itself: a changed amount or version is refused and writes
--    nothing; it is closed to client roles.
DO $g$
DECLARE v jsonb; v_c uuid;
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, currency,
    payment_method, payment_status, source, installment_plan_root, payment_plan_terms)
  VALUES ('4522cc00-0000-4000-8000-0000000000a3', '4522cc00-0000-4000-8000-000000000020', 'race2-buyer@example.test',
    'Race2 Buyer', '+15554522002', 10000, 'USD', 'online_card', 'paid', 'online_checkout', true, '{"v":2}');
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, ticket_type_id)
  VALUES ('4522cc00-0000-4000-8000-0000000000a3', 1, 10000, 'USD', now(), 'scheduled', 'stripe', 'auto_card',
    '4522cc00-0000-4000-8000-000000000030') RETURNING id INTO v_c;
  v := public.issue_4522_mark_stripe_charge_in_flight(v_c, 'pi_g_1', 9999, 0);
  IF v->>'reason' IS DISTINCT FROM 'balance_changed' THEN RAISE EXCEPTION 'G-1 FAIL: %', v; END IF;
  v := public.issue_4522_mark_stripe_charge_in_flight(v_c, 'pi_g_1', 10000, 1);
  IF v->>'reason' IS DISTINCT FROM 'balance_changed'
     OR (SELECT stripe_payment_intent_id FROM public.order_installments WHERE id = v_c) IS NOT NULL THEN
    RAISE EXCEPTION 'G-2 FAIL: %', v;
  END IF;
  UPDATE public.orders SET cancelled_at = now() WHERE id = '4522cc00-0000-4000-8000-0000000000a3';
  v := public.issue_4522_mark_stripe_charge_in_flight(v_c, 'pi_g_1', 10000, 0);
  IF v->>'reason' IS DISTINCT FROM 'order_cancelled' THEN RAISE EXCEPTION 'G-3 FAIL: claim refusals pass through: %', v; END IF;
  IF has_function_privilege('authenticated', 'public.issue_4522_mark_stripe_charge_in_flight(uuid, text, bigint, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_4522_mark_stripe_charge_in_flight(uuid, text, bigint, integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.issue_4522_mark_stripe_charge_in_flight(uuid, text, bigint, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G-4 FAIL: service role only';
  END IF;
  RAISE NOTICE 'G PASS: a changed row is never marked; claim refusals pass through; service role only';
END
$g$;

-- H. Rework 9 (T8-3 / T8-4), as service_role under pg-safeupdate: a row
--    marked for one PaymentIntent refuses another live one (PT409) and
--    replays its own; the cron's release clears only the row's own marker and
--    moves schedule_version on (a new charge key); a failed attempt's id on a
--    retried row is dead and may be replaced.
-- FAILS-ON-REVERT: drop the second-PaymentIntent refusal from
-- issue_4522_mark_stripe_charge_in_flight, or the version bump from
-- issue_4522_release_unconfirmed_stripe_charge -> red.
DO $hfix$
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, currency,
    payment_method, payment_status, source, installment_plan_root, payment_plan_terms)
  VALUES ('4522cc00-0000-4000-8000-0000000000a4', '4522cc00-0000-4000-8000-000000000020', 'race3-buyer@example.test',
    'Race3 Buyer', '+15554522003', 10000, 'USD', 'online_card', 'paid', 'online_checkout', true, '{"v":2}');
  INSERT INTO public.order_installments(id, order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, ticket_type_id)
  VALUES ('4522cc00-0000-4000-8000-0000000000b4', '4522cc00-0000-4000-8000-0000000000a4', 1, 10000, 'USD', now(),
    'scheduled', 'stripe', 'auto_card', '4522cc00-0000-4000-8000-000000000030');
END
$hfix$;
SET ROLE service_role;
DO $h$
DECLARE v jsonb; v_row uuid := '4522cc00-0000-4000-8000-0000000000b4'; v_raised boolean := false;
BEGIN
  v := public.issue_4522_mark_stripe_charge_in_flight(v_row, 'pi_h_1', 10000, 0);
  IF NOT COALESCE((v->>'marked')::boolean, false) THEN RAISE EXCEPTION 'H-1 FAIL: %', v; END IF;
  v := public.issue_4522_mark_stripe_charge_in_flight(v_row, 'pi_h_1', 10000, 0);
  IF NOT COALESCE((v->>'marked')::boolean, false) THEN RAISE EXCEPTION 'H-2 FAIL: the same id replays: %', v; END IF;
  BEGIN
    PERFORM public.issue_4522_mark_stripe_charge_in_flight(v_row, 'pi_h_2', 10000, 0);
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'H-3 FAIL: a second live PaymentIntent was accepted'; END IF;
  v := public.issue_4522_release_unconfirmed_stripe_charge(v_row, 'pi_h_2');
  IF v->>'reason' IS DISTINCT FROM 'not_marked_for_this_payment' THEN RAISE EXCEPTION 'H-4 FAIL: %', v; END IF;
  v := public.issue_4522_release_unconfirmed_stripe_charge(v_row, 'pi_h_1');
  IF NOT COALESCE((v->>'released')::boolean, false) THEN RAISE EXCEPTION 'H-5 FAIL: %', v; END IF;
  v := public.issue_4522_mark_stripe_charge_in_flight(v_row, 'pi_h_2', 10000, 0);
  IF v->>'reason' IS DISTINCT FROM 'balance_changed' THEN RAISE EXCEPTION 'H-6 FAIL: the released key version moved on: %', v; END IF;
  v := public.issue_4522_mark_stripe_charge_in_flight(v_row, 'pi_h_2', 10000, 1);
  IF NOT COALESCE((v->>'marked')::boolean, false) THEN RAISE EXCEPTION 'H-7 FAIL: %', v; END IF;
  IF has_function_privilege('authenticated', 'public.issue_4522_release_unconfirmed_stripe_charge(uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_4522_release_unconfirmed_stripe_charge(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'H-8 FAIL: service role only';
  END IF;
END
$h$;
RESET ROLE;
UPDATE public.order_installments SET failed_at = now(), failure_reason = 'card_declined'
 WHERE id = '4522cc00-0000-4000-8000-0000000000b4';
SET ROLE service_role;
DO $h2$
DECLARE v jsonb;
BEGIN
  v := public.issue_4522_mark_stripe_charge_in_flight('4522cc00-0000-4000-8000-0000000000b4', 'pi_h_3', 10000, 1);
  IF NOT COALESCE((v->>'marked')::boolean, false)
     OR (SELECT failed_at FROM public.order_installments WHERE id = '4522cc00-0000-4000-8000-0000000000b4') IS NOT NULL THEN
    RAISE EXCEPTION 'H-9 FAIL: a failed attempt''s id is dead and is replaced (and the mark clears failed_at): %', v;
  END IF;
  RAISE NOTICE 'H PASS: one live PaymentIntent per marked row; release clears only its own and moves the key on';
END
$h2$;
RESET ROLE;
