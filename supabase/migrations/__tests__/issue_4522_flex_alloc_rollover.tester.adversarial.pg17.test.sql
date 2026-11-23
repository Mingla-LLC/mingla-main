-- MINGLA-INVARIANT: I-4522-FLEX-NO-UNPAYABLE-REMAINDER | issue #4522 | A flexible payment either pays the whole remaining balance or leaves at least the provider's minimum charge owing (refused by name otherwise, and quoted as maxPartialMinor); re-spread, rollover, short collection and add-on removal never leave a row the provider cannot charge; a whole balance below the provider's minimum is never charged or dunned but settled once by waiver, at most the minimum less one minor unit, audited and never paid out.
-- MINGLA-INVARIANT: I-4522-14 | issue #4522 | A flexible payment of any allowed amount (from the minimum up to the remaining balance less the provider's minimum, or the whole balance) allocates exactly across packages (largest remainder, never more than a package owes); a client key replays only its own request; a missed payment that cannot be placed in its own package flags the booking at risk and the failure count always persists; a failure for a superseded row is a no-op; count_installment_failure locks event, order, then rows.
\set ON_ERROR_STOP on

-- Rework after the #4522 tester FAIL (F4, F8, F9, F10). Rolled back.

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
  ('45220f02-0000-4000-8000-000000000001', 'alloc-host@example.test'),
  ('45220f02-0000-4000-8000-000000000002', 'alloc-buyer@example.test');
INSERT INTO public.creator_accounts(id, email) VALUES ('45220f02-0000-4000-8000-000000000001', 'alloc-host@example.test');
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES ('45220f02-0000-4000-8000-000000000002', '+2348000000072');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country)
VALUES ('45220f02-0000-4000-8000-000000000010', '45220f02-0000-4000-8000-000000000001', 'Alloc brand', 'alloc-brand-4522', 'NGN', 'paystack', 'NG');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency)
VALUES ('45220f02-0000-4000-8000-000000000020', '45220f02-0000-4000-8000-000000000010',
        '45220f02-0000-4000-8000-000000000001', 'Alloc trip', 'alloc-trip-4522', 'trip', 'scheduled', 'public', 'Africa/Lagos', 'NGN');
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
VALUES ('45220f02-0000-4000-8000-000000000020', '2027-03-12T09:00Z', '2027-03-19T09:00Z', 'Africa/Lagos', true);
INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total, is_unlimited, min_purchase_qty, available_online, available_in_person)
VALUES ('45220f02-0000-4000-8000-000000000030', '45220f02-0000-4000-8000-000000000020', 'A', 120000000, 'NGN', false, 20, false, 1, true, false),
       ('45220f02-0000-4000-8000-000000000031', '45220f02-0000-4000-8000-000000000020', 'B', 120000000, 'NGN', false, 20, false, 1, true, false),
       ('45220f02-0000-4000-8000-000000000032', '45220f02-0000-4000-8000-000000000020', 'C', 120000000, 'NGN', false, 20, false, 1, true, false);

CREATE FUNCTION pg_temp.seed(p_order uuid, p_rows jsonb, p_flex boolean, p_min bigint) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source, installment_plan_root, payment_plan_terms)
  VALUES (p_order, '45220f02-0000-4000-8000-000000000020', '45220f02-0000-4000-8000-000000000002',
    'alloc-buyer@example.test', 'Alloc Buyer', '+2348000000072', 30000000, 'NGN', 'online_card', 'paid',
    'online_checkout', true,
    jsonb_build_object('v', 2, 'flex_enabled', p_flex, 'min_payment_minor', p_min, 'auto_adjust', true,
      'deposit_minor', 30000000, 'time_zone', 'Africa/Lagos'));
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, plan_bound_at, buyer_total_cents, planned_application_fee_cents, ticket_type_id)
  SELECT p_order, o::int, (r->>'amt')::bigint, 'NGN', (r->>'due')::timestamptz, 'scheduled', 'paystack', 'pay_link',
         now(), (r->>'amt')::bigint * 102 / 100, (r->>'amt')::bigint * 45 / 1000, (r->>'tt')::uuid
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY a(r, o);
END $$;

-- ── F8: three packages owing 10,000 / 10,000 / 100; every amount from the
--    minimum to the remaining 20,100 allocates exactly, never over a package.
--    #3645: the minimum is the host's (100) or the provider floor (₦100 =
--    10,000 on Paystack), whichever is larger, so every amount under the floor
--    is refused by name and every amount from it upward allocates exactly.
SELECT pg_temp.seed('45220f02-0000-4000-8000-0000000000c1',
  '[{"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-02-10T08:00Z","amt":10000},
    {"tt":"45220f02-0000-4000-8000-000000000031","due":"2027-02-10T08:00Z","amt":10000},
    {"tt":"45220f02-0000-4000-8000-000000000032","due":"2027-02-10T08:00Z","amt":100}]', true, 100);

DO $t$
DECLARE
  o uuid := '45220f02-0000-4000-8000-0000000000c1';
  v_amount bigint;
  v jsonb;
  v_bad integer := 0;
  v_tested integer := 0;
  v_refused integer := 0;
  v_unpayable integer := 0;
  v_min bigint := (public.issue_4522_balance('45220f02-0000-4000-8000-0000000000c1')->>'minPaymentMinor')::bigint;
  v_first text;
BEGIN
  PERFORM pg_temp.check('F8 the minimum is the provider floor', v_min = 10000, COALESCE(v_min::text, 'null'));
  FOR v_amount IN SELECT a FROM generate_series(100, 20100) a
                   WHERE a % 97 = 0 OR a % 41 = 0
                      OR a IN (100, 101, 199, 9999, 10000, 10001, 10099, 10100, 10101, 20098, 20099, 20100, 10050, 10051) LOOP
    IF v_amount < v_min THEN
      IF pg_temp.raised(format($$SELECT public.issue_4522_begin_flex_payment(%L, %s, 20100, %L, 'pay_link')$$,
           o, v_amount, 'alloc-' || v_amount)) = '22023:flex_amount_below_minimum' THEN
        v_refused := v_refused + 1;
      ELSE
        v_bad := v_bad + 1;
        v_first := COALESCE(v_first, v_amount::text || ' under the floor was not refused');
      END IF;
      CONTINUE;
    END IF;
    -- T4-3: short of the whole 20,100 it must leave at least the ₦100 floor (10,000).
    IF v_amount < 20100 AND 20100 - v_amount < 10000 THEN
      IF pg_temp.raised(format($$SELECT public.issue_4522_begin_flex_payment(%L, %s, 20100, %L, 'pay_link')$$,
           o, v_amount, 'alloc-' || v_amount)) = '22023:flex_amount_leaves_unpayable_remainder' THEN
        v_unpayable := v_unpayable + 1;
      ELSE
        v_bad := v_bad + 1;
        v_first := COALESCE(v_first, v_amount::text || ' leaving an unchargeable remainder was not refused');
      END IF;
      CONTINUE;
    END IF;
    BEGIN
      v := public.issue_4522_begin_flex_payment(o, v_amount, 20100, 'alloc-' || v_amount, 'pay_link');
      v_tested := v_tested + 1;
      IF (SELECT sum((e->>'net_minor')::bigint + (e->>'addon_minor')::bigint)
            FROM public.order_installments oi, jsonb_array_elements(oi.line_allocation) e
           WHERE oi.id = (v->>'installmentId')::uuid) <> v_amount
         OR EXISTS (SELECT 1 FROM public.order_installments oi, jsonb_array_elements(oi.line_allocation) e
                     WHERE oi.id = (v->>'installmentId')::uuid
                       AND (e->>'net_minor')::bigint + (e->>'addon_minor')::bigint >
                           (SELECT sum(amount_cents) FROM public.order_installments s
                             WHERE s.order_id = o AND s.kind = 'scheduled'
                               AND s.ticket_type_id = (e->>'ticket_type_id')::uuid)) THEN
        v_bad := v_bad + 1;
        v_first := COALESCE(v_first, v_amount::text);
      END IF;
      RAISE EXCEPTION 'undo' USING ERRCODE = 'P0099';
    EXCEPTION
      WHEN SQLSTATE 'P0099' THEN NULL;
      WHEN OTHERS THEN
        v_bad := v_bad + 1;
        v_first := COALESCE(v_first, v_amount::text || ' ' || SQLERRM);
    END;
  END LOOP;
  PERFORM pg_temp.check('F8 every allowed amount allocates exactly (' || v_tested || ' tested, ' || v_refused
      || ' under the floor refused, ' || v_unpayable || ' leaving under the floor refused)',
    v_bad = 0 AND v_tested >= 10 AND v_refused > 100 AND v_unpayable > 100,
    'first bad: ' || COALESCE(v_first, '-') || ' bad=' || v_bad);
  -- The tester's case: 20,099 of 20,100 would leave 1 kobo, which the provider cannot charge (T4-3).
  PERFORM pg_temp.check('F8 the tester case (20,099 of 20,100) is refused by name',
    pg_temp.raised(format($$SELECT public.issue_4522_begin_flex_payment(%L, 20099, 20100, 'alloc-tester-20099', 'pay_link')$$, o))
      = '22023:flex_amount_leaves_unpayable_remainder');
  v := public.issue_4522_begin_flex_payment(o, 10100, 20100, 'alloc-tester-20099', 'pay_link');
  PERFORM pg_temp.check('F8 the largest partial (10,100, leaving the 10,000 floor) is accepted',
    (v->>'amountMinor')::bigint = 10100, v::text);

  -- ── F10: a client key replays only its own request.
  v := public.issue_4522_begin_flex_payment(o, 10100, 20100, 'alloc-tester-20099', 'pay_link');
  PERFORM pg_temp.check('F10 same key, same request replays', (v->>'replayed')::boolean, v::text);
  PERFORM pg_temp.check('F10 same key, other amount is refused',
    pg_temp.raised(format($$SELECT public.issue_4522_begin_flex_payment(%L, 1000, 1, 'alloc-tester-20099', 'pay_link')$$, o))
      = 'PT409:flex_client_key_reused');
  PERFORM pg_temp.check('F10 same key, other method is refused',
    pg_temp.raised(format($$SELECT public.issue_4522_begin_flex_payment(%L, 10100, 20100, 'alloc-tester-20099', 'auto_card')$$, o))
      = 'PT409:flex_client_key_reused');
  PERFORM pg_temp.check('F10 the original payment is untouched',
    (SELECT amount_cents = 10100 AND status = 'scheduled' AND collection_method = 'pay_link'
       FROM public.order_installments WHERE order_id = o AND flex_client_key = 'alloc-tester-20099'));
END
$t$;

-- ── F4: package A misses its third payment and has no later row of its own
--    (package B does): flagged at risk, the failure is recorded, never raised.
SELECT pg_temp.seed('45220f02-0000-4000-8000-0000000000c2',
  '[{"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-01-10T08:00Z","amt":40000000},
    {"tt":"45220f02-0000-4000-8000-000000000031","due":"2027-02-10T08:00Z","amt":40000000}]', false, NULL);
UPDATE public.order_installments SET retry_count = 2, status = 'failed', failure_reason = 'card_declined', failed_at = now()
 WHERE order_id = '45220f02-0000-4000-8000-0000000000c2' AND ordinal = 1;

DO $t$
DECLARE
  o uuid := '45220f02-0000-4000-8000-0000000000c2';
  v_a uuid := (SELECT id FROM public.order_installments WHERE order_id = '45220f02-0000-4000-8000-0000000000c2' AND ordinal = 1);
  v jsonb; v_txt text;
BEGIN
  v_txt := pg_temp.raised(format($$SELECT public.issue_3645_count_installment_failure(%L, 'card_declined')$$, v_a));
  PERFORM pg_temp.check('F4 third failure never raises', v_txt = 'ok', v_txt);
  v := public.issue_3645_count_installment_failure(v_a, 'card_declined');
  PERFORM pg_temp.check('F4 booking flagged at risk, count persisted',
    (SELECT at_risk FROM public.orders WHERE id = o)
    AND (SELECT retry_count >= 3 AND status = 'failed' FROM public.order_installments WHERE id = v_a), v::text);
  PERFORM pg_temp.check('F4 package B untouched',
    (SELECT amount_cents = 40000000 AND schedule_version = 0 FROM public.order_installments WHERE order_id = o AND ordinal = 2));
  PERFORM pg_temp.check('F4 no rollover recorded',
    NOT EXISTS (SELECT 1 FROM public.order_balance_events WHERE order_id = o));
END
$t$;

-- A rollover whose later row has a charge in flight is undone and flagged,
-- and the failure count still persists.
SELECT pg_temp.seed('45220f02-0000-4000-8000-0000000000c3',
  '[{"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-01-10T08:00Z","amt":30000000},
    {"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-02-10T08:00Z","amt":30000000}]', false, NULL);
DO $t$
DECLARE
  o uuid := '45220f02-0000-4000-8000-0000000000c3';
  v_a uuid := (SELECT id FROM public.order_installments WHERE order_id = '45220f02-0000-4000-8000-0000000000c3' AND ordinal = 1);
  v_b uuid := (SELECT id FROM public.order_installments WHERE order_id = '45220f02-0000-4000-8000-0000000000c3' AND ordinal = 2);
  v jsonb;
BEGIN
  v := public.issue_3645_begin_installment_attempt(v_b, 'pay_link', 0, true, now());
  PERFORM pg_temp.check('F4 later row has an attempt in flight', (v->>'ok')::boolean, v::text);
  UPDATE public.order_installments SET retry_count = 2, status = 'failed', failure_reason = 'card_declined', failed_at = now()
   WHERE id = v_a;
  v := public.issue_3645_count_installment_failure(v_a, 'card_declined');
  PERFORM pg_temp.check('F4 in-flight later row: flagged, not rolled',
    v->>'outcome' = 'at_risk' AND (SELECT at_risk FROM public.orders WHERE id = o)
    AND (SELECT status = 'failed' AND retry_count = 3 FROM public.order_installments WHERE id = v_a), v::text);
END
$t$;

-- ── F9: a failure for a superseded row is a clean no-op; lock order.
SELECT pg_temp.seed('45220f02-0000-4000-8000-0000000000c4',
  '[{"tt":"45220f02-0000-4000-8000-000000000030","due":"2026-12-17T08:00Z","amt":30000000},
    {"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-01-13T08:00Z","amt":30000000},
    {"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-02-10T08:00Z","amt":30000000}]', false, NULL);
UPDATE public.order_installments SET retry_count = 2, status = 'failed', failure_reason = 'card_declined', failed_at = now()
 WHERE order_id = '45220f02-0000-4000-8000-0000000000c4' AND ordinal = 1;
DO $t$
DECLARE
  o uuid := '45220f02-0000-4000-8000-0000000000c4';
  v_a uuid := (SELECT id FROM public.order_installments WHERE order_id = '45220f02-0000-4000-8000-0000000000c4' AND ordinal = 1);
  v jsonb; v_txt text; v_src text;
BEGIN
  v := public.issue_3645_count_installment_failure(v_a, 'card_declined');
  PERFORM pg_temp.check('F9 third failure rolls over', (v->>'rolled_over')::boolean, v::text);
  v_txt := pg_temp.raised(format($$SELECT public.issue_3645_count_installment_failure(%L, 'card_declined')$$, v_a));
  PERFORM pg_temp.check('F9 replay on the superseded row does not raise', v_txt = 'ok', v_txt);
  v := public.issue_3645_count_installment_failure(v_a, 'card_declined');
  PERFORM pg_temp.check('F9 replay is a no-op', v->>'outcome' = 'noop'
    AND (SELECT status = 'superseded' AND retry_count = 3 FROM public.order_installments WHERE id = v_a)
    AND NOT (SELECT at_risk FROM public.orders WHERE id = o)
    AND (SELECT sum(amount_cents) FROM public.order_installments WHERE order_id = o AND status IN ('scheduled', 'failed')) = 90000000,
    v::text);
  -- Lock order: the event / order / open-row graph is taken before the row.
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.issue_3645_count_installment_failure(uuid,text,timestamptz)'::regprocedure;
  PERFORM pg_temp.check('F9 graph locked before the row',
    strpos(v_src, 'issue_4522_lock_order_graph') > 0
    AND strpos(v_src, 'issue_4522_lock_order_graph') < strpos(v_src, 'FOR UPDATE'));
END
$t$;

-- ── T4-3 (fourth rework): no payment may leave a balance the provider cannot charge.
--    Exhaustive over every amount 1 .. remaining on the Stripe floor (USD 50¢),
--    the Paystack floor (₦100 = 10,000 kobo) and a zero-decimal currency with no
--    verified floor (JPY); the accepted set equals the balance's quote
--    (minPaymentMinor .. maxPartialMinor, or the whole remaining balance).
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency)
VALUES ('45220f02-0000-4000-8000-000000000021', '45220f02-0000-4000-8000-000000000010',
        '45220f02-0000-4000-8000-000000000001', 'Alloc trip USD', 'alloc-trip-4522-usd', 'trip', 'scheduled', 'public', 'UTC', 'USD'),
       ('45220f02-0000-4000-8000-000000000022', '45220f02-0000-4000-8000-000000000010',
        '45220f02-0000-4000-8000-000000000001', 'Alloc trip JPY', 'alloc-trip-4522-jpy', 'trip', 'scheduled', 'public', 'UTC', 'JPY');
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
VALUES ('45220f02-0000-4000-8000-000000000021', '2027-03-12T09:00Z', '2027-03-19T09:00Z', 'UTC', true),
       ('45220f02-0000-4000-8000-000000000022', '2027-03-12T09:00Z', '2027-03-19T09:00Z', 'UTC', true);
-- p_rows: [{"tt", "due", "amt"}]; Stripe rows for USD/JPY (auto_card), Paystack rows for NGN (pay_link).
CREATE FUNCTION pg_temp.seed43(p_order uuid, p_cur text, p_rows jsonb, p_min bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_stripe boolean := p_cur <> 'NGN';
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source, installment_plan_root, payment_plan_terms,
    stripe_customer_id_on_connected_account, saved_payment_method_id)
  VALUES (p_order, CASE p_cur WHEN 'USD' THEN '45220f02-0000-4000-8000-000000000021'::uuid
                              WHEN 'JPY' THEN '45220f02-0000-4000-8000-000000000022'::uuid
                              ELSE '45220f02-0000-4000-8000-000000000020'::uuid END,
    '45220f02-0000-4000-8000-000000000002', 'alloc-buyer@example.test', 'Alloc Buyer', '+2348000000072', 30000,
    p_cur, 'online_card', 'paid', 'online_checkout', true,
    jsonb_build_object('v', 2, 'flex_enabled', true, 'min_payment_minor', p_min, 'auto_adjust', true, 'deposit_minor', 30000),
    CASE WHEN v_stripe THEN 'cus_43' END, CASE WHEN v_stripe THEN 'pm_43' END);
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, plan_bound_at, buyer_total_cents, ticket_type_id)
  SELECT p_order, o::int, (r->>'amt')::bigint, p_cur, (r->>'due')::timestamptz, 'scheduled',
         CASE WHEN v_stripe THEN 'stripe' ELSE 'paystack' END, CASE WHEN v_stripe THEN 'auto_card' ELSE 'pay_link' END,
         now(), CASE WHEN v_stripe THEN NULL ELSE (r->>'amt')::bigint END, (r->>'tt')::uuid
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY a(r, o);
END $$;
-- Every amount 1..R: accepted ones leave 0 or >= the floor; refusals are named;
-- the accepted set is exactly the quote. Returns 'ok' or the first mismatch.
CREATE FUNCTION pg_temp.exhaust(p_order uuid, p_method text) RETURNS text
LANGUAGE plpgsql AS $x$
DECLARE
  b jsonb := public.issue_4522_balance(p_order);
  v_r bigint := (b->>'remainingMinor')::bigint;
  v_min bigint := (b->>'minPaymentMinor')::bigint;
  v_max bigint := (b->>'maxPartialMinor')::bigint;
  v_floor bigint := (b->>'providerMinimumMinor')::bigint;
  v_a bigint; v_res text; v_quoted boolean; v_ok integer := 0;
BEGIN
  FOR v_a IN 1..v_r LOOP
    v_res := pg_temp.raised(format($$SELECT public.issue_4522_begin_flex_payment(%L, %s, %s, %L, %L)$$,
               p_order, v_a, v_r, 'exhaust-key-' || v_a, p_method));
    v_quoted := v_a = v_r OR (v_max IS NOT NULL AND v_a BETWEEN v_min AND v_max);
    IF v_res = 'ok' THEN
      IF NOT v_quoted OR NOT (v_r - v_a = 0 OR v_r - v_a >= v_floor) THEN
        RETURN v_a || ' accepted, leaving ' || (v_r - v_a) || ' (floor ' || v_floor || ', quoted ' || v_quoted || ')';
      END IF;
      v_ok := v_ok + 1;
    ELSIF v_quoted THEN
      RETURN v_a || ' quoted but refused: ' || v_res;
    ELSIF v_res NOT IN ('22023:flex_amount_below_minimum', '22023:flex_amount_leaves_unpayable_remainder') THEN
      RETURN v_a || ' refused without a name: ' || v_res;
    ELSIF v_res = '22023:flex_amount_leaves_unpayable_remainder' AND NOT (v_a < v_r AND v_r - v_a < v_floor) THEN
      RETURN v_a || ' refused as leaving a remainder it does not leave';
    END IF;
  END LOOP;
  RETURN 'ok:' || v_ok;
END $x$;
-- pg_temp.raised rolls nothing back by itself: each accepted begin opened a
-- flexible row. The probe below runs each amount in its own subtransaction.
CREATE OR REPLACE FUNCTION pg_temp.raised(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0099';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN RETURN 'ok';
  END;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;

SELECT pg_temp.seed43('45220f02-0000-4000-8000-0000000000d1', 'USD',
  '[{"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-01-10T08:00Z","amt":515},
    {"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-02-10T08:00Z","amt":515}]', 100);
SELECT pg_temp.seed43('45220f02-0000-4000-8000-0000000000d2', 'USD',
  '[{"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-01-10T08:00Z","amt":30000},
    {"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-02-10T08:00Z","amt":30000}]', 1000);
SELECT pg_temp.seed43('45220f02-0000-4000-8000-0000000000d3', 'NGN',
  '[{"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-01-10T08:00Z","amt":6000},
    {"tt":"45220f02-0000-4000-8000-000000000031","due":"2027-02-10T08:00Z","amt":14100}]', 100);
SELECT pg_temp.seed43('45220f02-0000-4000-8000-0000000000d4', 'JPY',
  '[{"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-01-10T08:00Z","amt":700},
    {"tt":"45220f02-0000-4000-8000-000000000031","due":"2027-02-10T08:00Z","amt":300}]', 100);
SELECT pg_temp.seed43('45220f02-0000-4000-8000-0000000000d5', 'USD',
  '[{"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-01-10T08:00Z","amt":1030}]', 1000);

DO $t$
DECLARE b jsonb; v text;
BEGIN
  b := public.issue_4522_balance('45220f02-0000-4000-8000-0000000000d1');
  PERFORM pg_temp.check('T4-3 USD $10.30 owing, minimum $1: the quote is $1.00 .. $9.80 or the whole $10.30',
    (b->>'minPaymentMinor')::bigint = 100 AND (b->>'maxPartialMinor')::bigint = 980
    AND (b->>'providerMinimumMinor')::bigint = 50, b::text);
  v := pg_temp.exhaust('45220f02-0000-4000-8000-0000000000d1', 'auto_card');
  PERFORM pg_temp.check('T4-3 USD every amount 1..1,030: ' || v, v = 'ok:882', v);
  b := public.issue_4522_balance('45220f02-0000-4000-8000-0000000000d5');
  PERFORM pg_temp.check('T4-3 the tester''s $10.30 with a $10 minimum: only the whole balance (no partial quoted)',
    b->'maxPartialMinor' = 'null'::jsonb AND (b->>'minPaymentMinor')::bigint = 1000, b::text);
  PERFORM pg_temp.check('T4-3 ... $10.00 is refused by name (it would leave 30¢)',
    pg_temp.raised($$SELECT public.issue_4522_begin_flex_payment('45220f02-0000-4000-8000-0000000000d5', 1000, 1030, 'f1-key-1000', 'auto_card')$$)
      = '22023:flex_amount_leaves_unpayable_remainder');
  PERFORM pg_temp.check('T4-3 $599.99 of $600.00 is refused by name (it would leave 1¢)',
    pg_temp.raised($$SELECT public.issue_4522_begin_flex_payment('45220f02-0000-4000-8000-0000000000d2', 59999, 60000, 'f2-key-59999', 'auto_card')$$)
      = '22023:flex_amount_leaves_unpayable_remainder');
  PERFORM pg_temp.check('T4-3 $599.50 of $600.00 (leaves exactly 50¢) is accepted',
    pg_temp.raised($$SELECT public.issue_4522_begin_flex_payment('45220f02-0000-4000-8000-0000000000d2', 59950, 60000, 'f2-key-59950', 'auto_card')$$) = 'ok');
  b := public.issue_4522_balance('45220f02-0000-4000-8000-0000000000d3');
  v := pg_temp.exhaust('45220f02-0000-4000-8000-0000000000d3', 'pay_link');
  PERFORM pg_temp.check('T4-3 NGN (₦100 floor) every amount 1..20,100: ' || v || ' ' || b::text,
    v = 'ok:102' AND (b->>'maxPartialMinor')::bigint = 10100 AND (b->>'minPaymentMinor')::bigint = 10000, v);
  b := public.issue_4522_balance('45220f02-0000-4000-8000-0000000000d4');
  v := pg_temp.exhaust('45220f02-0000-4000-8000-0000000000d4', 'auto_card');
  PERFORM pg_temp.check('T4-3 JPY (zero-decimal, no verified floor) every amount 1..1,000: ' || v,
    v = 'ok:901' AND (b->>'maxPartialMinor')::bigint = 1000 AND (b->>'providerMinimumMinor')::bigint = 0, v || ' ' || b::text);
END
$t$;

-- A whole balance below the provider's minimum: never charged, settled once by waiver.
SELECT pg_temp.seed43('45220f02-0000-4000-8000-0000000000d6', 'USD',
  '[{"tt":"45220f02-0000-4000-8000-000000000030","due":"2026-01-10T08:00Z","amt":30}]', 1000);
SELECT pg_temp.seed43('45220f02-0000-4000-8000-0000000000d7', 'NGN',
  '[{"tt":"45220f02-0000-4000-8000-000000000030","due":"2026-01-10T08:00Z","amt":9999}]', 100);
SELECT pg_temp.seed43('45220f02-0000-4000-8000-0000000000d8', 'USD',
  '[{"tt":"45220f02-0000-4000-8000-000000000030","due":"2026-01-10T08:00Z","amt":30},
    {"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-02-10T08:00Z","amt":30000}]', 1000);
DO $t$
DECLARE
  v jsonb; b jsonb;
  r6 uuid := (SELECT id FROM public.order_installments WHERE order_id = '45220f02-0000-4000-8000-0000000000d6');
  r7 uuid := (SELECT id FROM public.order_installments WHERE order_id = '45220f02-0000-4000-8000-0000000000d7');
  r8 uuid := (SELECT id FROM public.order_installments WHERE order_id = '45220f02-0000-4000-8000-0000000000d8' AND ordinal = 1);
BEGIN
  UPDATE public.orders SET at_risk = true, at_risk_since = now() WHERE id = '45220f02-0000-4000-8000-0000000000d6';
  UPDATE public.order_installments SET status = 'failed', retry_count = 1, failure_reason = 'amount_too_small', failed_at = now() WHERE id = r6;
  v := public.claim_order_installment_for_charge(r6);
  PERFORM pg_temp.check('T4-3 Stripe: a 30¢ balance is never sent to the provider; it is settled by waiver',
    v->>'reason' = 'waived_below_provider_minimum' AND NOT (v->>'ok')::boolean, v::text);
  b := public.issue_4522_balance('45220f02-0000-4000-8000-0000000000d6');
  PERFORM pg_temp.check('T4-3 ... paid in full, waived 30¢ counted as settled, at risk cleared, never paid out',
    (b->>'remainingMinor')::bigint = 0 AND (b->>'waivedMinor')::bigint = 30 AND (b->>'paidMinor')::bigint = (b->>'totalMinor')::bigint
    AND NOT (SELECT at_risk FROM public.orders WHERE id = '45220f02-0000-4000-8000-0000000000d6')
    AND (SELECT status = 'superseded' AND failure_reason = 'waived_below_provider_minimum' AND payout_accounting_state IS DISTINCT FROM 'ready'
           FROM public.order_installments WHERE id = r6)
    AND (SELECT count(*) FROM public.audit_log
          WHERE target_type = 'order_installment' AND target_id = r6::text
            AND action = 'tr3.installment_waived_below_provider_minimum' AND (after->>'amount_minor')::bigint = 30) = 1, b::text);
  v := public.claim_order_installment_for_charge(r6);
  PERFORM pg_temp.check('T4-3 ... once: a second claim finds nothing to charge', v->>'reason' = 'installment_not_chargeable', v::text);
  v := public.issue_3645_begin_installment_attempt(r7, 'pay_link', 0, true, now());
  PERFORM pg_temp.check('T4-3 Paystack: ₦99.99 is never sent either; settled by waiver (strictly below ₦100)',
    v->>'reason' = 'waived_below_provider_minimum'
    AND (public.issue_4522_balance('45220f02-0000-4000-8000-0000000000d7')->>'waivedMinor')::bigint = 9999, v::text);
  v := public.claim_order_installment_for_charge(r8);
  PERFORM pg_temp.check('T4-3 a 30¢ row while $300 is still owed: not charged, not failed, not waived (it waits)',
    v->>'reason' = 'below_provider_minimum'
    AND (SELECT status FROM public.order_installments WHERE id = r8) = 'scheduled'
    AND (public.issue_4522_balance('45220f02-0000-4000-8000-0000000000d8')->>'waivedMinor')::bigint = 0, v::text);
END
$t$;

-- T5-6: never written off while a flexible payment is open (its charge can
-- still land and pay the balance).
SELECT pg_temp.seed43('45220f02-0000-4000-8000-0000000000da', 'USD',
  '[{"tt":"45220f02-0000-4000-8000-000000000030","due":"2026-01-10T08:00Z","amt":30}]', 1000);
DO $t$
DECLARE
  o uuid := '45220f02-0000-4000-8000-0000000000da';
  r uuid := (SELECT id FROM public.order_installments WHERE order_id = '45220f02-0000-4000-8000-0000000000da');
  w bigint;
BEGIN
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, kind, flex_client_key, line_allocation, plan_bound_at)
  VALUES (o, 2, 30, 'USD', now(), 'scheduled', 'stripe', 'auto_card', 'flex', 't56-open-flex', '[]'::jsonb, now());
  w := public.issue_4522_waive_unchargeable_remainder(o, 'charge_claim');
  PERFORM pg_temp.check('T5-6 a 30¢ balance with a flexible payment open is not written off',
    w = 0 AND (SELECT status FROM public.order_installments WHERE id = r) = 'scheduled'
    AND (public.issue_4522_balance(o)->>'waivedMinor')::bigint = 0, w::text);
  UPDATE public.order_installments SET status = 'superseded', superseded_at = now()
   WHERE order_id = o AND kind = 'flex';
  w := public.issue_4522_waive_unchargeable_remainder(o, 'charge_claim');
  PERFORM pg_temp.check('T5-6 ... once it is closed, the same balance is written off',
    w = 30 AND (SELECT failure_reason FROM public.order_installments WHERE id = r) = 'waived_below_provider_minimum', w::text);
END
$t$;

-- The traveler pays a whole balance below the minimum: settled by waiver, no charge.
SELECT pg_temp.seed43('45220f02-0000-4000-8000-0000000000d9', 'USD',
  '[{"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-01-10T08:00Z","amt":30}]', 1000);
DO $t$
DECLARE v jsonb;
BEGIN
  v := public.issue_4522_begin_flex_payment('45220f02-0000-4000-8000-0000000000d9', 30, 30, 'whole-key-30', 'auto_card');
  PERFORM pg_temp.check('T4-3 paying a 30¢ whole balance: no charge is begun; it is settled by waiver',
    (v->>'waived')::boolean AND (v->>'waivedMinor')::bigint = 30 AND v->>'installmentId' IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.order_installments WHERE order_id = '45220f02-0000-4000-8000-0000000000d9' AND kind = 'flex')
    AND (public.issue_4522_balance('45220f02-0000-4000-8000-0000000000d9')->>'remainingMinor')::bigint = 0, v::text);
END
$t$;

-- Re-spread, short collection and add-on removal never create a row below the floor.
SELECT pg_temp.seed43('45220f02-0000-4000-8000-0000000000e1', 'USD',
  '[{"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-01-10T08:00Z","amt":5000},
    {"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-02-10T08:00Z","amt":5000},
    {"tt":"45220f02-0000-4000-8000-000000000031","due":"2027-03-10T08:00Z","amt":30},
    {"tt":"45220f02-0000-4000-8000-000000000031","due":"2027-04-10T08:00Z","amt":30}]', 100);
SELECT pg_temp.seed43('45220f02-0000-4000-8000-0000000000e2', 'USD',
  '[{"tt":"45220f02-0000-4000-8000-000000000030","due":"2026-01-10T08:00Z","amt":30000},
    {"tt":"45220f02-0000-4000-8000-000000000030","due":"2027-02-10T08:00Z","amt":30000}]', 1000);
SELECT pg_temp.seed43('45220f02-0000-4000-8000-0000000000e3', 'USD',
  '[{"tt":"45220f02-0000-4000-8000-000000000030","due":"2026-01-10T08:00Z","amt":30000}]', 1000);
DO $t$
DECLARE
  o uuid := '45220f02-0000-4000-8000-0000000000e1';
  v jsonb; v_flex uuid; v_row uuid; v_bad text;
BEGIN
  -- $50 / $50 on package A, 30¢ / 30¢ on package B; pay $50.00: B would be left with 31¢.
  v := public.issue_4522_begin_flex_payment(o, 5000, 10060, 'respread-1', 'auto_card');
  v_flex := (v->>'installmentId')::uuid;
  UPDATE public.order_installments SET status = 'collected', collected_at = now(), stripe_payment_intent_id = 'pi_43_e1'
   WHERE id = v_flex;
  v := public.issue_4522_settle_flex_payment(v_flex);
  SELECT string_agg(amount_cents::text, ',' ORDER BY due_at, id) INTO v_bad FROM public.order_installments
   WHERE order_id = o AND kind = 'scheduled' AND status IN ('scheduled', 'failed') AND amount_cents < 50;
  PERFORM pg_temp.check('T4-3 a re-spread never leaves a row below 50¢ (a small package joins the largest)',
    v_bad IS NULL AND (SELECT sum(amount_cents) FROM public.order_installments
                        WHERE order_id = o AND kind = 'scheduled' AND status IN ('scheduled', 'failed')) = 5060,
    COALESCE(v_bad, '-') || ' ' || v::text);
  -- Short collection of 30¢ on a $300 row: the 30¢ joins the next open row (no 30¢ row).
  v_row := (SELECT id FROM public.order_installments WHERE order_id = '45220f02-0000-4000-8000-0000000000e2' AND ordinal = 1);
  UPDATE public.order_installments SET status = 'collected', collected_at = now(), stripe_payment_intent_id = 'pi_43_e2' WHERE id = v_row;
  v := public.issue_4522_record_short_collection(v_row, 29970, 'pi_43_e2');
  PERFORM pg_temp.check('T4-3 a 30¢ short collection joins the next open row instead of becoming a row',
    (v->>'folded')::boolean AND (v->>'shortMinor')::bigint = 30
    AND (SELECT amount_cents FROM public.order_installments WHERE order_id = '45220f02-0000-4000-8000-0000000000e2' AND ordinal = 2) = 30030
    AND NOT EXISTS (SELECT 1 FROM public.order_installments WHERE order_id = '45220f02-0000-4000-8000-0000000000e2'
                     AND status IN ('scheduled', 'failed') AND amount_cents < 50), v::text);
  -- ... and with no later row, the 30¢ is the whole balance: settled by waiver at once.
  v_row := (SELECT id FROM public.order_installments WHERE order_id = '45220f02-0000-4000-8000-0000000000e3' AND ordinal = 1);
  UPDATE public.order_installments SET status = 'collected', collected_at = now(), stripe_payment_intent_id = 'pi_43_e3' WHERE id = v_row;
  v := public.issue_4522_record_short_collection(v_row, 29970, 'pi_43_e3');
  PERFORM pg_temp.check('T4-3 a 30¢ short on the last row is settled by waiver, never dunned',
    (v->>'waivedMinor')::bigint = 30
    AND (public.issue_4522_balance('45220f02-0000-4000-8000-0000000000e3')->>'remainingMinor')::bigint = 0, v::text);
  PERFORM pg_temp.check('T4-3 the waiver is closed to client roles',
    NOT has_function_privilege('authenticated', 'public.issue_4522_waive_unchargeable_remainder(uuid, text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4522_waive_unchargeable_remainder(uuid, text)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.issue_4522_waive_unchargeable_remainder(uuid, text)', 'EXECUTE'));
END
$t$;

ROLLBACK;
