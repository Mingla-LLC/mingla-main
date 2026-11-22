-- MINGLA-INVARIANT: I-4522-12 | issue #4522 | Money is never collected twice for the same balance: a planned row whose Stripe charge or Paystack attempt is in flight blocks a flexible payment, the balance and the cron claim agree on it, a settlement that finds more money than is owed holds the surplus as a flagged overpayment instead of raising, and the cron charges nothing while a flexible payment is unsettled or an overpayment is held.
-- MINGLA-INVARIANT: I-4522-13 | issue #4522 | An abandoned flexible payment (past issue_4522_flex_reclaim_window() with no attempt in flight) never blocks the cron, rollover or a new payment; it is released by the next begin or the sweep, and a late success for it still settles exactly once.
\set ON_ERROR_STOP on

-- Rework after the #4522 tester FAIL (F1 money loss, F2 abandoned payment).
-- Every scenario runs inside one transaction that is rolled back.

BEGIN;

CREATE FUNCTION pg_temp.raised(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL %: %', p_label, COALESCE(p_detail, '(no detail)');
  END IF;
END $$;

INSERT INTO auth.users(id, email) VALUES
  ('45220f01-0000-4000-8000-000000000001', 'race-host@example.test'),
  ('45220f01-0000-4000-8000-000000000002', 'race-buyer@example.test');
INSERT INTO public.creator_accounts(id, email) VALUES ('45220f01-0000-4000-8000-000000000001', 'race-host@example.test');
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES ('45220f01-0000-4000-8000-000000000002', '+2348000000071');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country)
VALUES ('45220f01-0000-4000-8000-000000000010', '45220f01-0000-4000-8000-000000000001', 'Race brand', 'race-brand-4522', 'NGN', 'paystack', 'NG');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency)
VALUES ('45220f01-0000-4000-8000-000000000020', '45220f01-0000-4000-8000-000000000010',
        '45220f01-0000-4000-8000-000000000001', 'Race trip', 'race-trip-4522', 'trip', 'scheduled', 'public', 'Africa/Lagos', 'NGN');
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
VALUES ('45220f01-0000-4000-8000-000000000020', '2027-03-12T09:00Z', '2027-03-19T09:00Z', 'Africa/Lagos', true);
INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total, is_unlimited, min_purchase_qty, available_online, available_in_person)
VALUES ('45220f01-0000-4000-8000-000000000030', '45220f01-0000-4000-8000-000000000020', 'A', 120000000, 'NGN', false, 20, false, 1, true, false),
       ('45220f01-0000-4000-8000-000000000031', '45220f01-0000-4000-8000-000000000020', 'B', 120000000, 'NGN', false, 20, false, 1, true, false);

-- Deposit ₦300,000; rows given as [{tt, due, amt}]; flex on, smallest ₦50,000.
CREATE FUNCTION pg_temp.seed(p_order uuid, p_rows jsonb, p_provider text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source, installment_plan_root, payment_plan_terms)
  VALUES (p_order, '45220f01-0000-4000-8000-000000000020', '45220f01-0000-4000-8000-000000000002',
    'race-buyer@example.test', 'Race Buyer', '+2348000000071', 30000000, 'NGN', 'online_card', 'paid',
    'online_checkout', true,
    jsonb_build_object('v', 2, 'flex_enabled', true, 'min_payment_minor', 5000000, 'auto_adjust', true,
      'deposit_minor', 30000000, 'deposit_non_refundable', false, 'time_zone', 'Africa/Lagos'));
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, plan_bound_at, buyer_total_cents, planned_application_fee_cents, ticket_type_id)
  SELECT p_order, o::int, (r->>'amt')::bigint, 'NGN', (r->>'due')::timestamptz, 'scheduled', p_provider,
         CASE WHEN p_provider = 'stripe' THEN 'auto_card' ELSE 'pay_link' END,
         CASE WHEN p_provider = 'paystack' THEN now() END,
         CASE WHEN p_provider = 'paystack' THEN (r->>'amt')::bigint * 102 / 100 END,
         (r->>'amt')::bigint * 45 / 1000, (r->>'tt')::uuid
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY a(r, o);
END $$;

CREATE FUNCTION pg_temp.row_id(p_order uuid, p_ordinal int) RETURNS uuid
LANGUAGE sql AS $$ SELECT id FROM public.order_installments WHERE order_id = p_order AND ordinal = p_ordinal $$;
CREATE FUNCTION pg_temp.flex_id(p_order uuid, p_key text) RETURNS uuid
LANGUAGE sql AS $$ SELECT id FROM public.order_installments WHERE order_id = p_order AND flex_client_key = p_key $$;
-- What the buyer has paid (deposit + every collected row) less what is held.
CREATE FUNCTION pg_temp.net_collected(p_order uuid) RETURNS bigint
LANGUAGE sql AS $$
  SELECT o.total_cents
       + COALESCE((SELECT sum(amount_cents) FROM public.order_installments WHERE order_id = p_order AND status = 'collected'), 0)
       + COALESCE((SELECT sum(amount_minor) FROM public.order_overpayments WHERE order_id = p_order AND reason = 'superseded_row_collected'), 0)
       - COALESCE((SELECT sum(amount_minor) FROM public.order_overpayments WHERE order_id = p_order AND state = 'held'), 0)
    FROM public.orders o WHERE o.id = p_order $$;
CREATE FUNCTION pg_temp.open_sum(p_order uuid) RETURNS bigint
LANGUAGE sql AS $$ SELECT COALESCE(sum(amount_cents), 0) FROM public.order_installments
  WHERE order_id = p_order AND kind = 'scheduled' AND status IN ('scheduled', 'failed') $$;
-- The success webhook: the predicate-bound update the Stripe/Paystack handlers run.
CREATE FUNCTION pg_temp.collect(p_id uuid, p_pi text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.order_installments SET status = 'collected', collected_at = now(), stripe_payment_intent_id = p_pi,
         failed_at = NULL, failure_reason = NULL, next_retry_at = NULL
   WHERE id = p_id AND status IN ('scheduled', 'failed');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

DO $t$
DECLARE
  o1 uuid := '45220f01-0000-4000-8000-0000000000a1';
  o2 uuid := '45220f01-0000-4000-8000-0000000000a2';
  o3 uuid := '45220f01-0000-4000-8000-0000000000a3';
  o4 uuid := '45220f01-0000-4000-8000-0000000000a4';
  o5 uuid := '45220f01-0000-4000-8000-0000000000a5';
  rows3 jsonb := '[{"tt":"45220f01-0000-4000-8000-000000000030","due":"2026-11-20T08:00Z","amt":30000000},
                   {"tt":"45220f01-0000-4000-8000-000000000030","due":"2027-01-13T08:00Z","amt":30000000},
                   {"tt":"45220f01-0000-4000-8000-000000000030","due":"2027-02-10T08:00Z","amt":30000000}]';
  v jsonb; v_txt text;
BEGIN
  -- ── F1-a: the cron charged row 1 at Stripe (PaymentIntent written, no
  --    webhook yet). Balance, begin and the settlement all see it in flight.
  PERFORM pg_temp.seed(o1, rows3, 'stripe');
  UPDATE public.order_installments SET stripe_payment_intent_id = 'pi_cron_row1' WHERE id = pg_temp.row_id(o1, 1);
  v := public.issue_4522_balance(o1);
  PERFORM pg_temp.check('F1-a balance shows the charge in flight', (v->>'paymentInFlight')::boolean, v::text);
  v_txt := pg_temp.raised(format($$SELECT public.issue_4522_begin_flex_payment(%L, 90000000, 90000000, 'race-key-0001', 'auto_card')$$, o1));
  PERFORM pg_temp.check('F1-a begin refused while the planned charge is in flight',
    v_txt = 'PT409:balance_payment_in_flight', v_txt);
  -- A failed row still carrying an OLD attempt's PaymentIntent, waiting for a
  -- later retry, is not in flight.
  UPDATE public.order_installments SET status = 'failed', failed_at = now(), retry_count = 1,
         failure_reason = 'card_declined', next_retry_at = now() + interval '3 days'
   WHERE id = pg_temp.row_id(o1, 1);
  PERFORM pg_temp.check('F1-a old failed attempt is not in flight',
    (public.issue_4522_balance(o1)->>'paymentInFlight') = 'false');
  -- Its retry falls due: the cron is charging it (a retry's PaymentIntent id
  -- cannot be written on a failed row), so it is in flight again.
  UPDATE public.order_installments SET next_retry_at = now() - interval '1 minute' WHERE id = pg_temp.row_id(o1, 1);
  PERFORM pg_temp.check('F1-a due retry is in flight', (public.issue_4522_balance(o1)->>'paymentInFlight') = 'true');
  v_txt := pg_temp.raised(format($$SELECT public.issue_4522_begin_flex_payment(%L, 90000000, 90000000, 'race-key-0009', 'auto_card')$$, o1));
  PERFORM pg_temp.check('F1-a begin refused while the retry is due', v_txt = 'PT409:balance_payment_in_flight', v_txt);
  PERFORM pg_temp.check('F1-a webhook lands', pg_temp.collect(pg_temp.row_id(o1, 1), 'pi_cron_row1_retry') = 1);
  v := public.issue_4522_begin_flex_payment(o1, 60000000, 60000000, 'race-key-0002', 'auto_card');
  PERFORM pg_temp.check('F1-a after the webhook the buyer pays the true remaining', (v->>'amountMinor')::bigint = 60000000, v::text);

  -- ── F1-b: the two charges race (the cron's PaymentIntent lands after the
  --    flexible payment began). Planned webhook first, then the flexible one.
  PERFORM pg_temp.seed(o2, rows3, 'stripe');
  v := public.issue_4522_begin_flex_payment(o2, 90000000, 90000000, 'race-key-0003', 'auto_card');
  PERFORM pg_temp.check('F1-b cron claim refuses while the flexible payment is open',
    public.claim_order_installment_for_charge(pg_temp.row_id(o2, 1))->>'reason' = 'flex_payment_in_flight');
  UPDATE public.order_installments SET stripe_payment_intent_id = 'pi_race_row1' WHERE id = pg_temp.row_id(o2, 1);
  PERFORM pg_temp.check('F1-b planned webhook', pg_temp.collect(pg_temp.row_id(o2, 1), 'pi_race_row1') = 1);
  PERFORM pg_temp.check('F1-b flex webhook', pg_temp.collect(pg_temp.flex_id(o2, 'race-key-0003'), 'pi_flex_o2') = 1);
  PERFORM pg_temp.check('F1-b cron claim refuses while the flexible payment is unsettled',
    public.claim_order_installment_for_charge(pg_temp.row_id(o2, 2))->>'reason' = 'flex_settlement_pending');
  v_txt := pg_temp.raised(format($$SELECT public.issue_4522_settle_flex_payment(%L)$$, pg_temp.flex_id(o2, 'race-key-0003')));
  PERFORM pg_temp.check('F1-b settlement never raises', v_txt = 'ok', v_txt);
  v := public.issue_4522_settle_flex_payment(pg_temp.flex_id(o2, 'race-key-0003'));
  PERFORM pg_temp.check('F1-b settlement replays idempotently', (v->>'replayed')::boolean AND (v->>'paidInFull')::boolean, v::text);
  PERFORM pg_temp.check('F1-b nothing left to charge', pg_temp.open_sum(o2) = 0);
  PERFORM pg_temp.check('F1-b surplus held exactly once',
    (SELECT count(*) = 1 AND sum(amount_minor) = 30000000 FROM public.order_overpayments WHERE order_id = o2 AND state = 'held'
       AND reason = 'flex_exceeds_balance'));
  PERFORM pg_temp.check('F1-b buyer keeps exactly the price (deposit + paid - held)', pg_temp.net_collected(o2) = 120000000,
    pg_temp.net_collected(o2)::text);
  v := public.issue_4522_balance(o2);
  PERFORM pg_temp.check('F1-b balance flags the held credit', (v->>'heldCreditMinor')::bigint = 30000000
    AND (v->>'remainingMinor')::bigint = 0, v::text);
  PERFORM pg_temp.check('F1-b the overpayment is audited',
    EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'tr3.installment_overpayment_held'
             AND target_id = pg_temp.flex_id(o2, 'race-key-0003')::text));

  -- ── F1-c: same race, the flexible webhook first. Its settlement waits
  --    (PT409, retried by the inbox) while the planned charge is in flight,
  --    then holds the surplus once the planned webhook lands.
  PERFORM pg_temp.seed(o3, rows3, 'stripe');
  PERFORM public.issue_4522_begin_flex_payment(o3, 90000000, 90000000, 'race-key-0004', 'auto_card');
  UPDATE public.order_installments SET stripe_payment_intent_id = 'pi_race_row1_c' WHERE id = pg_temp.row_id(o3, 1);
  PERFORM pg_temp.check('F1-c flex webhook', pg_temp.collect(pg_temp.flex_id(o3, 'race-key-0004'), 'pi_flex_o3') = 1);
  v_txt := pg_temp.raised(format($$SELECT public.issue_4522_settle_flex_payment(%L)$$, pg_temp.flex_id(o3, 'race-key-0004')));
  PERFORM pg_temp.check('F1-c settlement waits for the in-flight planned charge', v_txt = 'PT409:balance_payment_in_flight', v_txt);
  PERFORM pg_temp.check('F1-c cron claims nothing meanwhile',
    public.claim_order_installment_for_charge(pg_temp.row_id(o3, 2))->>'reason' = 'flex_settlement_pending');
  PERFORM pg_temp.check('F1-c planned webhook', pg_temp.collect(pg_temp.row_id(o3, 1), 'pi_race_row1_c') = 1);
  v := public.issue_4522_settle_flex_payment(pg_temp.flex_id(o3, 'race-key-0004'));
  PERFORM pg_temp.check('F1-c settlement holds the surplus', (v->>'ok')::boolean AND (v->>'heldMinor')::bigint = 30000000, v::text);
  PERFORM pg_temp.check('F1-c buyer keeps exactly the price', pg_temp.net_collected(o3) = 120000000, pg_temp.net_collected(o3)::text);

  -- ── F1-d: a planned row superseded while its charge was landing (the
  --    PaymentIntent id was not yet on the row): the late success is held,
  --    never kept, idempotently.
  PERFORM pg_temp.seed(o4, rows3, 'stripe');
  PERFORM public.issue_4522_begin_flex_payment(o4, 90000000, 90000000, 'race-key-0005', 'auto_card');
  PERFORM pg_temp.collect(pg_temp.flex_id(o4, 'race-key-0005'), 'pi_flex_o4');
  v := public.issue_4522_settle_flex_payment(pg_temp.flex_id(o4, 'race-key-0005'));
  PERFORM pg_temp.check('F1-d flexible payment settles the whole balance', (v->>'paidInFull')::boolean, v::text);
  PERFORM pg_temp.check('F1-d the late planned webhook matches no open row', pg_temp.collect(pg_temp.row_id(o4, 1), 'pi_late_row1') = 0);
  v := public.issue_4522_record_late_collection(pg_temp.row_id(o4, 1), 30000000, 'pi_late_row1');
  PERFORM pg_temp.check('F1-d late success is held (webhook acks)', (v->>'ok')::boolean AND v->>'outcome' = 'held', v::text);
  v := public.issue_4522_record_late_collection(pg_temp.row_id(o4, 1), 30000000, 'pi_late_row1');
  PERFORM pg_temp.check('F1-d replay holds nothing more', (v->>'replayed')::boolean
    AND (SELECT count(*) FROM public.order_overpayments WHERE order_id = o4) = 1, v::text);
  PERFORM pg_temp.check('F1-d buyer keeps exactly the price', pg_temp.net_collected(o4) = 120000000, pg_temp.net_collected(o4)::text);

  -- ── F1-e: two packages; the surplus on package A is held and the cron
  --    charges nothing more on package B while it is held.
  PERFORM pg_temp.seed(o5, '[{"tt":"45220f01-0000-4000-8000-000000000030","due":"2027-01-13T08:00Z","amt":30000000},
                            {"tt":"45220f01-0000-4000-8000-000000000031","due":"2027-02-10T08:00Z","amt":30000000}]', 'paystack');
  PERFORM public.issue_4522_begin_flex_payment(o5, 40000000, 60000000, 'race-key-0006', 'pay_link');
  -- package A's row was collected by another path before the flexible payment landed
  PERFORM pg_temp.collect(pg_temp.row_id(o5, 1), 'ps_row_a');
  PERFORM pg_temp.collect(pg_temp.flex_id(o5, 'race-key-0006'), 'ps_flex_o5');
  v := public.issue_4522_settle_flex_payment(pg_temp.flex_id(o5, 'race-key-0006'));
  PERFORM pg_temp.check('F1-e only package B''s share is applied', (v->>'heldMinor')::bigint = 20000000
    AND (v->>'remainingMinor')::bigint = 10000000, v::text);
  PERFORM pg_temp.check('F1-e the cron never charges while money is held',
    public.claim_order_installment_for_charge(pg_temp.row_id(o5, 2))->>'reason' = 'overpayment_held'
    AND public.issue_3645_begin_installment_attempt(pg_temp.row_id(o5, 2), 'auto_card', 0, true, now())->>'reason' = 'overpayment_held');
END
$t$;

-- ── F2: an abandoned flexible payment ─────────────────────────────────────
DO $t$
DECLARE
  o6 uuid := '45220f01-0000-4000-8000-0000000000b6';
  o7 uuid := '45220f01-0000-4000-8000-0000000000b7';
  o8 uuid := '45220f01-0000-4000-8000-0000000000b8';
  o9 uuid := '45220f01-0000-4000-8000-0000000000b9';
  rows3 jsonb := '[{"tt":"45220f01-0000-4000-8000-000000000030","due":"2026-10-01T08:00Z","amt":30000000},
                   {"tt":"45220f01-0000-4000-8000-000000000030","due":"2026-11-01T08:00Z","amt":30000000},
                   {"tt":"45220f01-0000-4000-8000-000000000030","due":"2027-02-10T08:00Z","amt":30000000}]';
  v jsonb; v_old uuid; v_txt text;
BEGIN
  PERFORM pg_temp.check('F2 the reclaim window is the instalment reconcile''s 15 minutes',
    public.issue_4522_flex_reclaim_window() = interval '15 minutes');

  -- A buyer opened "Pay ₦50,000" 20 minutes ago and closed the sheet.
  PERFORM pg_temp.seed(o6, rows3, 'stripe');
  PERFORM public.issue_4522_begin_flex_payment(o6, 5000000, 90000000, 'abandon-key-01', 'auto_card', now() - interval '20 minutes');
  v_old := pg_temp.flex_id(o6, 'abandon-key-01');
  UPDATE public.order_installments SET stripe_payment_intent_id = 'pi_flex_abandoned' WHERE id = v_old;
  PERFORM pg_temp.check('F2 balance no longer shows it in flight', NOT (public.issue_4522_balance(o6)->>'paymentInFlight')::boolean);
  v := public.claim_order_installment_for_charge(pg_temp.row_id(o6, 1));
  PERFORM pg_temp.check('F2 the cron claims the overdue row', (v->>'ok')::boolean, v::text);
  v := public.issue_4522_begin_flex_payment(o6, 90000000, 90000000, 'abandon-key-02', 'auto_card');
  PERFORM pg_temp.check('F2 a new payment starts and names the released PaymentIntent',
    v->'released'->0->>'stripePaymentIntentId' = 'pi_flex_abandoned' AND NOT (v->>'replayed')::boolean, v::text);
  PERFORM pg_temp.check('F2 the abandoned row is closed, not cancelled',
    (SELECT status = 'superseded' AND failure_reason = 'flex_expired' FROM public.order_installments WHERE id = v_old));
  -- A fresh flexible payment still blocks the cron.
  PERFORM pg_temp.check('F2 a fresh flexible payment still blocks the cron',
    public.claim_order_installment_for_charge(pg_temp.row_id(o6, 2))->>'reason' = 'flex_payment_in_flight');

  -- Rollover is not blocked by an abandoned payment; the sweep releases it.
  PERFORM pg_temp.seed(o7, rows3, 'paystack');
  PERFORM public.issue_4522_begin_flex_payment(o7, 5000000, 90000000, 'abandon-key-03', 'pay_link', now() - interval '1 hour');
  UPDATE public.order_installments SET status = 'failed', retry_count = 2, failed_at = now(), failure_reason = 'declined'
   WHERE id = pg_temp.row_id(o7, 1);
  v := public.issue_3645_count_installment_failure(pg_temp.row_id(o7, 1), 'declined');
  PERFORM pg_temp.check('F2 rollover proceeds past an abandoned payment', (v->>'rolled_over')::boolean, v::text);
  v := public.issue_4522_sweep_stale_flex(now(), 100);
  PERFORM pg_temp.check('F2 the sweep releases it',
    EXISTS (SELECT 1 FROM jsonb_array_elements(v) r WHERE r->>'orderId' = o7::text), v::text);
  PERFORM pg_temp.check('F2 nothing open is left for the order',
    NOT EXISTS (SELECT 1 FROM public.order_installments WHERE order_id = o7 AND kind = 'flex' AND status IN ('scheduled', 'failed')));

  -- Late success for a released payment, nothing else paid: it settles.
  PERFORM pg_temp.seed(o8, rows3, 'stripe');
  PERFORM public.issue_4522_begin_flex_payment(o8, 30000000, 90000000, 'abandon-key-04', 'auto_card', now() - interval '30 minutes');
  v_old := pg_temp.flex_id(o8, 'abandon-key-04');
  PERFORM public.issue_4522_sweep_stale_flex(now(), 100);
  PERFORM pg_temp.check('F2 late webhook matches no open row', pg_temp.collect(v_old, 'pi_flex_late') = 0);
  v := public.issue_4522_record_late_collection(v_old, 30000000, 'pi_flex_late', 'ch_flex_late');
  PERFORM pg_temp.check('F2 the late payment is collected and settled', (v->>'ok')::boolean AND v->>'outcome' = 'flex_collected'
    AND (v->'settle'->>'remainingMinor')::bigint = 60000000 AND (v->'settle'->>'heldMinor')::bigint = 0, v::text);
  v := public.issue_4522_record_late_collection(v_old, 30000000, 'pi_flex_late', 'ch_flex_late');
  PERFORM pg_temp.check('F2 replay is a no-op', v->>'outcome' = 'already_collected', v::text);
  PERFORM pg_temp.check('F2 settled exactly once',
    (SELECT count(*) FROM public.order_balance_events WHERE trigger_installment_id = v_old) = 1);

  -- Late success after the buyer already paid everything with a new payment,
  -- in both webhook orders: never double-collected (the extra is held).
  PERFORM pg_temp.seed(o9, rows3, 'stripe');
  PERFORM public.issue_4522_begin_flex_payment(o9, 30000000, 90000000, 'abandon-key-05', 'auto_card', now() - interval '30 minutes');
  v_old := pg_temp.flex_id(o9, 'abandon-key-05');
  v := public.issue_4522_begin_flex_payment(o9, 90000000, 90000000, 'abandon-key-06', 'auto_card');
  -- order 1: the old payment's late success lands while the new one is open
  v := public.issue_4522_record_late_collection(v_old, 30000000, 'pi_old_late');
  PERFORM pg_temp.check('F2 old payment settles first', (v->'settle'->>'remainingMinor')::bigint = 60000000, v::text);
  PERFORM pg_temp.collect(pg_temp.flex_id(o9, 'abandon-key-06'), 'pi_new');
  v := public.issue_4522_settle_flex_payment(pg_temp.flex_id(o9, 'abandon-key-06'));
  PERFORM pg_temp.check('F2 the new payment''s extra is held', (v->>'heldMinor')::bigint = 30000000
    AND (v->>'paidInFull')::boolean, v::text);
  PERFORM pg_temp.check('F2 buyer keeps exactly the price', pg_temp.net_collected(o9) = 120000000, pg_temp.net_collected(o9)::text);
END
$t$;

-- order 2 of the late success: the new payment settles first.
DO $t$
DECLARE
  o10 uuid := '45220f01-0000-4000-8000-0000000000ba';
  v jsonb; v_old uuid;
BEGIN
  PERFORM pg_temp.seed(o10, '[{"tt":"45220f01-0000-4000-8000-000000000030","due":"2027-01-13T08:00Z","amt":45000000},
                             {"tt":"45220f01-0000-4000-8000-000000000030","due":"2027-02-10T08:00Z","amt":45000000}]', 'stripe');
  PERFORM public.issue_4522_begin_flex_payment(o10, 30000000, 90000000, 'abandon-key-07', 'auto_card', now() - interval '30 minutes');
  v_old := pg_temp.flex_id(o10, 'abandon-key-07');
  PERFORM public.issue_4522_begin_flex_payment(o10, 90000000, 90000000, 'abandon-key-08', 'auto_card');
  PERFORM pg_temp.collect(pg_temp.flex_id(o10, 'abandon-key-08'), 'pi_new_first');
  v := public.issue_4522_settle_flex_payment(pg_temp.flex_id(o10, 'abandon-key-08'));
  PERFORM pg_temp.check('F2 order 2: the new payment pays in full', (v->>'paidInFull')::boolean AND (v->>'heldMinor')::bigint = 0, v::text);
  v := public.issue_4522_record_late_collection(v_old, 30000000, 'pi_old_after');
  PERFORM pg_temp.check('F2 order 2: the old payment is collected and wholly held',
    (v->>'ok')::boolean AND (v->'settle'->>'heldMinor')::bigint = 30000000, v::text);
  PERFORM pg_temp.check('F2 order 2: buyer keeps exactly the price', pg_temp.net_collected(o10) = 120000000,
    pg_temp.net_collected(o10)::text);
END
$t$;

ROLLBACK;
