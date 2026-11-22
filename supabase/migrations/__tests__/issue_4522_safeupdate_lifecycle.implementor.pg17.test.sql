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
  v := public.issue_4522_begin_overpayment_refund((v->0->>'overpaymentId')::uuid);
  PERFORM public.t4522su_check('S-REFUND begin creates the linked refund', v->>'refundId' IS NOT NULL
    AND v->>'idempotencyKey' LIKE 'mingla_overpay_refund:%:1', v::text);
  PERFORM public.t4522su_check('S-REFUND unknown keeps it pending',
    public.issue_4522_finish_overpayment_refund((v->>'overpaymentId')::uuid, 1, 'unknown', NULL, 'timeout')->>'state' = 'refund_pending');
  PERFORM public.t4522su_check('S-REFUND resume hands back the same key',
    public.issue_4522_begin_overpayment_refund((v->>'overpaymentId')::uuid)->>'idempotencyKey' = v->>'idempotencyKey');
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
  v := public.issue_4522_begin_overpayment_refund(v_op);
  v := public.issue_4522_finish_overpayment_refund(v_op, 1, 'failed', NULL, 'charge_disputed');
  PERFORM public.t4522su_check('R-LATE failed refund waits for its retry', v->>'state' = 'refund_failed', v::text);
  PERFORM public.t4522su_check('R-LATE not retried early',
    public.issue_4522_begin_overpayment_refund(v_op)->>'reason' = 'retry_not_due');
  v := public.issue_4522_begin_overpayment_refund(v_op, now() + interval '2 hours');
  PERFORM public.t4522su_check('R-LATE retried with the next attempt', (v->>'attemptNo')::int = 2, v::text);
  v := public.issue_4522_hold_collected_excess(public.t4522su_row(r, 1), 50000, 'pi_x');
  PERFORM public.t4522su_check('R-EXCESS runs', (v->>'ok')::boolean, v::text);
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
