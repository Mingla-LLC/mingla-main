-- MINGLA-INVARIANT: I-4522-14 | issue #4522 | A flexible payment of any amount from the minimum up to the remaining balance allocates exactly across packages (largest remainder, never more than a package owes); a client key replays only its own request; a missed payment that cannot be placed in its own package flags the booking at risk and the failure count always persists; a failure for a superseded row is a no-op; count_installment_failure locks event, order, then rows.
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
  v_first text;
BEGIN
  FOR v_amount IN SELECT a FROM generate_series(100, 20100) a
                   WHERE a % 97 = 0 OR a IN (100, 101, 199, 20098, 20099, 20100, 10050, 10051) LOOP
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
  PERFORM pg_temp.check('F8 every amount allocates exactly (' || v_tested || ' tested)', v_bad = 0 AND v_tested > 200,
    'first bad: ' || COALESCE(v_first, '-') || ' bad=' || v_bad);
  -- The tester's case: 20,099 of 20,100 across 10,000 / 10,000 / 100.
  v := public.issue_4522_begin_flex_payment(o, 20099, 20100, 'alloc-tester-20099', 'pay_link');
  PERFORM pg_temp.check('F8 the tester case is accepted', (v->>'amountMinor')::bigint = 20099, v::text);

  -- ── F10: a client key replays only its own request.
  v := public.issue_4522_begin_flex_payment(o, 20099, 20100, 'alloc-tester-20099', 'pay_link');
  PERFORM pg_temp.check('F10 same key, same request replays', (v->>'replayed')::boolean, v::text);
  PERFORM pg_temp.check('F10 same key, other amount is refused',
    pg_temp.raised(format($$SELECT public.issue_4522_begin_flex_payment(%L, 1000, 1, 'alloc-tester-20099', 'pay_link')$$, o))
      = 'PT409:flex_client_key_reused');
  PERFORM pg_temp.check('F10 same key, other method is refused',
    pg_temp.raised(format($$SELECT public.issue_4522_begin_flex_payment(%L, 20099, 20100, 'alloc-tester-20099', 'auto_card')$$, o))
      = 'PT409:flex_client_key_reused');
  PERFORM pg_temp.check('F10 the original payment is untouched',
    (SELECT amount_cents = 20099 AND status = 'scheduled' AND collection_method = 'pay_link'
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

ROLLBACK;
