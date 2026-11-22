-- MINGLA-INVARIANT: I-4522-2 | issue #4522 | A rebalance conserves money: open rows after equal open rows before plus any rolled-in row minus the payment, and the latest due date never moves.
-- MINGLA-INVARIANT: I-4522-4 | issue #4522 | An order has at most one open flexible payment; none starts while a planned row has an open charge attempt, and no planned row is claimed while one is open.
\set ON_ERROR_STOP on

-- Issue #4522 slice 5 (M3, 20281125044522): flexible payments, rebalancing,
-- claim guards and balance links. The server switch goes on only inside this
-- transaction (rolled back).

BEGIN;

CREATE FUNCTION pg_temp.raised(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;

CREATE FUNCTION pg_temp.rows(p_order uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT string_agg(to_char(due_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD') || ':' || amount_cents
                    || ':' || status || ':v' || schedule_version, ',' ORDER BY due_at, id)
    FROM public.order_installments WHERE order_id = p_order AND kind = 'scheduled'
$$;

INSERT INTO auth.users(id, email) VALUES
  ('45220005-0000-4000-8000-000000000001', 'flex-host@example.test'),
  ('45220005-0000-4000-8000-000000000002', 'flex-buyer@example.test'),
  ('45220005-0000-4000-8000-000000000003', 'flex-stranger@example.test');
INSERT INTO public.creator_accounts(id, email) VALUES
  ('45220005-0000-4000-8000-000000000001', 'flex-host@example.test');
-- The buyer proved their phone, so the order may name them (#4063).
INSERT INTO public.verified_phone_identities(user_id, phone_e164)
VALUES ('45220005-0000-4000-8000-000000000002', '+2348000000001');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country)
VALUES ('45220005-0000-4000-8000-000000000010', '45220005-0000-4000-8000-000000000001',
        'Flex brand', 'flex-brand-4522', 'NGN', 'paystack', 'NG');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency)
VALUES ('45220005-0000-4000-8000-000000000020', '45220005-0000-4000-8000-000000000010',
        '45220005-0000-4000-8000-000000000001', 'Flex trip', 'flex-trip-4522', 'trip', 'scheduled',
        'public', 'Africa/Lagos', 'NGN');
INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total, is_unlimited,
  min_purchase_qty, available_online, available_in_person)
VALUES ('45220005-0000-4000-8000-000000000030', '45220005-0000-4000-8000-000000000020', 'Shared room',
        120000000, 'NGN', false, 20, false, 1, true, false);

-- The §6.2 / §6.3 order: deposit ₦300,000, then ₦300,000 on 17 Dec, 13 Jan and
-- 10 Feb (09:00 Lagos); smallest flexible payment ₦50,000. Paystack prices
-- are locked at 102% of each row.
CREATE FUNCTION pg_temp.seed_order(p_order uuid, p_flex boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source, installment_plan_root, payment_plan_terms)
  VALUES (p_order, '45220005-0000-4000-8000-000000000020', '45220005-0000-4000-8000-000000000002',
    'flex-buyer@example.test', 'Flex Buyer', '+2348000000001', 30000000, 'NGN', 'online_card', 'paid',
    'online_checkout', true,
    jsonb_build_object('v', 2, 'flex_enabled', p_flex, 'min_payment_minor', CASE WHEN p_flex THEN 5000000 END,
      'auto_adjust', true, 'final_due_at', '2027-02-10T08:00:00Z', 'time_zone', 'Africa/Lagos'));
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, plan_bound_at, buyer_total_cents, planned_application_fee_cents, ticket_type_id)
  SELECT p_order, g, 30000000, 'NGN', d, 'scheduled', 'paystack', 'pay_link', now(), 30600000, 1350000,
         '45220005-0000-4000-8000-000000000030'
    FROM (VALUES (1, timestamptz '2026-12-17T08:00:00Z'), (2, '2027-01-13T08:00:00Z'), (3, '2027-02-10T08:00:00Z')) v(g, d);
END $$;

SELECT pg_temp.seed_order('45220005-0000-4000-8000-0000000000a1', true);
SELECT pg_temp.seed_order('45220005-0000-4000-8000-0000000000a2', true);
SELECT pg_temp.seed_order('45220005-0000-4000-8000-0000000000a3', false);

-- The full chain ends with M5 (switch on). The switch goes OFF here for this
-- transaction only, exactly as a kill-switch migration would write it.
CREATE OR REPLACE FUNCTION public.issue_4522_plan_v2_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$ SELECT false $fn$;

-- A. With the switch off nothing starts.
DO $$
DECLARE v_balance jsonb;
BEGIN
  v_balance := public.issue_4522_balance('45220005-0000-4000-8000-0000000000a1');
  IF (v_balance->>'canPayAnyAmount')::boolean IS DISTINCT FROM false
     OR v_balance->>'minPaymentMinor' IS NOT NULL
     OR (v_balance->'nextPayment'->>'amountMinor')::bigint <> 30000000
     OR v_balance->'openRows'->0->>'planLineId' <> '45220005-0000-4000-8000-000000000030' THEN
    RAISE EXCEPTION 'A-1 switch off must keep every buyer entry point inert: %', v_balance;
  END IF;
  IF pg_temp.raised($q$SELECT public.issue_4522_begin_flex_payment('45220005-0000-4000-8000-0000000000a1',
       70000000, 90000000, 'client-key-0001', 'pay_link')$q$)
     IS DISTINCT FROM 'P0001:payment_plan_v2_unavailable' THEN
    RAISE EXCEPTION 'A-2 switch off must refuse flexible payments';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.issue_4522_plan_v2_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$ SELECT true $fn$;

-- B. Refusals, each by name.
DO $$
DECLARE v_case record; v_raised text; v_fixed jsonb;
BEGIN
  FOR v_case IN SELECT * FROM (VALUES
    ('a3', 70000000, 90000000, 'P0001:plan_not_flexible'),
    ('a1', 70000000, 89000000, 'PT409:balance_changed'),
    ('a1', 0, 90000000, '22023:flex_amount_invalid'),
    ('a1', 90000001, 90000000, '22023:flex_amount_invalid'),
    ('a1', 4999999, 90000000, '22023:flex_amount_below_minimum')
  ) c(o, amt, expected, code) LOOP
    v_raised := pg_temp.raised(format('SELECT public.issue_4522_begin_flex_payment(%L, %s, %s, %L, %L)',
      '45220005-0000-4000-8000-0000000000' || v_case.o, v_case.amt, v_case.expected, 'client-key-b', 'pay_link'));
    IF v_raised IS DISTINCT FROM v_case.code THEN
      RAISE EXCEPTION 'B-1 % % expected %, got %', v_case.o, v_case.amt, v_case.code, v_raised;
    END IF;
  END LOOP;
  UPDATE public.orders SET payment_status = 'pending' WHERE id = '45220005-0000-4000-8000-0000000000a2';
  IF pg_temp.raised($q$SELECT public.issue_4522_begin_flex_payment('45220005-0000-4000-8000-0000000000a2',
       70000000, 90000000, 'client-key-b2', 'pay_link')$q$) IS DISTINCT FROM 'P0001:deposit_not_paid' THEN
    RAISE EXCEPTION 'B-2 an unpaid deposit must refuse';
  END IF;
  UPDATE public.orders SET payment_status = 'paid' WHERE id = '45220005-0000-4000-8000-0000000000a2';

  -- Fixed v2 plans still let the buyer pay the next due date or the full
  -- balance. Only an arbitrary third amount is refused as plan_not_flexible.
  v_fixed := public.issue_4522_begin_flex_payment(
    '45220005-0000-4000-8000-0000000000a3', 30000000, 90000000,
    'client-fixed-next', 'pay_link');
  PERFORM public.issue_4522_close_failed_flex((v_fixed->>'installmentId')::uuid);
  v_fixed := public.issue_4522_begin_flex_payment(
    '45220005-0000-4000-8000-0000000000a3', 90000000, 90000000,
    'client-fixed-full', 'pay_link');
  PERFORM public.issue_4522_close_failed_flex((v_fixed->>'installmentId')::uuid);
END $$;

-- C. SC-5 / I-4522-4: one open flexible payment per order; the same key replays.
DO $$
DECLARE v_first jsonb; v_again jsonb; v_raised text; v_row record;
BEGIN
  v_first := public.issue_4522_begin_flex_payment('45220005-0000-4000-8000-0000000000a1',
    70000000, 90000000, 'client-key-0001', 'pay_link');
  v_again := public.issue_4522_begin_flex_payment('45220005-0000-4000-8000-0000000000a1',
    70000000, 90000000, 'client-key-0001', 'pay_link');
  IF v_again->>'installmentId' <> v_first->>'installmentId' OR NOT (v_again->>'replayed')::boolean THEN
    RAISE EXCEPTION 'C-1 the same key must replay the same row: % / %', v_first, v_again;
  END IF;
  v_raised := pg_temp.raised($q$SELECT public.issue_4522_begin_flex_payment('45220005-0000-4000-8000-0000000000a1',
    70000000, 90000000, 'client-key-0002', 'pay_link')$q$);
  IF v_raised IS DISTINCT FROM 'PT409:balance_payment_in_flight' THEN
    RAISE EXCEPTION 'C-2 a second key while one is open must be PT409, got %', v_raised;
  END IF;
  SELECT * INTO v_row FROM public.order_installments WHERE id = (v_first->>'installmentId')::uuid;
  IF v_row.kind <> 'flex' OR v_row.amount_cents <> 70000000 OR v_row.buyer_total_cents <> 71400000
     OR v_row.planned_application_fee_cents <> 3150000 OR v_row.ordinal <> 4
     OR v_row.line_allocation <> '[{"net_minor": 70000000, "addon_minor": 0, "ticket_type_id": "45220005-0000-4000-8000-000000000030"}]'::jsonb THEN
    RAISE EXCEPTION 'C-3 the flexible row is wrong: %', row_to_json(v_row);
  END IF;

  -- SC-6: no planned row is claimed while it is open, and no attempt is made.
  IF public.claim_order_installment_for_charge((SELECT id FROM public.order_installments
       WHERE order_id = '45220005-0000-4000-8000-0000000000a1' AND ordinal = 1))->>'reason'
       IS DISTINCT FROM 'flex_payment_in_flight'
     OR public.issue_3645_begin_installment_attempt((SELECT id FROM public.order_installments
       WHERE order_id = '45220005-0000-4000-8000-0000000000a1' AND ordinal = 1), 'pay_link', 0)->>'reason'
       IS DISTINCT FROM 'flex_payment_in_flight'
     OR EXISTS (SELECT 1 FROM public.order_installment_charge_attempts a JOIN public.order_installments oi
                  ON oi.id = a.installment_id
                 WHERE oi.order_id = '45220005-0000-4000-8000-0000000000a1' AND oi.kind = 'scheduled')
     OR public.claim_order_installment_for_charge(v_row.id)->>'reason' IS DISTINCT FROM 'flex_not_cron_chargeable' THEN
    RAISE EXCEPTION 'C-4 SC-6 claim guards failed';
  END IF;
  -- The flexible row may start its own Paystack attempt.
  IF (public.issue_3645_begin_installment_attempt(v_row.id, 'pay_link', 0)->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'C-5 the flexible row must be able to start its own attempt';
  END IF;
  -- And no flexible payment starts while a planned row has an open attempt.
  UPDATE public.order_installments SET in_flight_attempt_id = NULL WHERE id = v_row.id;
  PERFORM public.issue_4522_close_failed_flex(v_row.id);
END $$;

-- D. SC-7: ₦700,000 paid → ₦66,666 / ₦66,666 / ₦66,668, version 1; settle replays once.
DO $$
DECLARE v_flex jsonb; v_s jsonb; v_s2 jsonb; v_bt bigint; v_got text;
BEGIN
  v_flex := public.issue_4522_begin_flex_payment('45220005-0000-4000-8000-0000000000a1',
    70000000, 90000000, 'client-key-0003', 'pay_link');
  UPDATE public.order_installments
     SET status = 'collected', collected_at = now(), stripe_payment_intent_id = 'ps_4522_d'
   WHERE id = (v_flex->>'installmentId')::uuid;
  v_s := public.issue_4522_settle_flex_payment((v_flex->>'installmentId')::uuid);
  v_s2 := public.issue_4522_settle_flex_payment((v_flex->>'installmentId')::uuid);
  v_got := pg_temp.rows('45220005-0000-4000-8000-0000000000a1');
  IF v_got IS DISTINCT FROM '2026-12-17:6666600:scheduled:v1,2027-01-13:6666600:scheduled:v1,2027-02-10:6666800:scheduled:v1' THEN
    RAISE EXCEPTION 'D-1 SC-7 rows after ₦700,000: %', v_got;
  END IF;
  IF (v_s->>'remainingMinor')::bigint <> 20000000 OR NOT (v_s2->>'replayed')::boolean
     OR (SELECT count(*) FROM public.order_balance_events
          WHERE trigger_installment_id = (v_flex->>'installmentId')::uuid) <> 1 THEN
    RAISE EXCEPTION 'D-2 SC-10 settle must rebalance exactly once: % / %', v_s, v_s2;
  END IF;
  -- Locked prices scale by the order's ratio (102%), rounded down once.
  SELECT sum(buyer_total_cents) INTO v_bt FROM public.order_installments
   WHERE order_id = '45220005-0000-4000-8000-0000000000a1' AND kind = 'scheduled' AND status = 'scheduled';
  IF v_bt <> 20400000 OR EXISTS (SELECT 1 FROM public.order_installments
       WHERE order_id = '45220005-0000-4000-8000-0000000000a1' AND kind = 'scheduled'
         AND status = 'scheduled' AND (buyer_total_cents < amount_cents OR pre_charge_notice_sent_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'D-3 locked prices must scale with the rows (got %)', v_bt;
  END IF;
END $$;

-- E. SC-7: leaving ₦40,000 (₦860,000 paid of ₦900,000; spec §6.3 example) →
--    one ₦40,000 row on 10 Feb (under the ₦50,000 minimum: it is the balance),
--    the two earlier rows superseded.
DO $$
DECLARE v_flex jsonb; v_got text;
BEGIN
  v_flex := public.issue_4522_begin_flex_payment('45220005-0000-4000-8000-0000000000a2',
    86000000, 90000000, 'client-key-0004', 'pay_link');
  UPDATE public.order_installments
     SET status = 'collected', collected_at = now(), stripe_payment_intent_id = 'ps_4522_e'
   WHERE id = (v_flex->>'installmentId')::uuid;
  PERFORM public.issue_4522_settle_flex_payment((v_flex->>'installmentId')::uuid);
  v_got := pg_temp.rows('45220005-0000-4000-8000-0000000000a2');
  IF v_got IS DISTINCT FROM '2026-12-17:30000000:superseded:v0,2027-01-13:30000000:superseded:v0,2027-02-10:4000000:scheduled:v1' THEN
    RAISE EXCEPTION 'E-1 SC-7 rows leaving ₦40,000: %', v_got;
  END IF;
END $$;

-- F. Paid in full: rows superseded, balance link revoked, paidInFull.
DO $$
DECLARE v_flex jsonb; v_s jsonb; v_link jsonb;
BEGIN
  v_link := public.issue_4522_issue_balance_link('45220005-0000-4000-8000-0000000000a2', decode(repeat('ab', 32), 'hex'));
  IF NOT (v_link->>'ok')::boolean
     OR public.issue_4522_resolve_balance_link(decode(repeat('ab', 32), 'hex'))->>'state' <> 'payable' THEN
    RAISE EXCEPTION 'F-1 a balance link must resolve as payable: %', v_link;
  END IF;
  v_flex := public.issue_4522_begin_flex_payment('45220005-0000-4000-8000-0000000000a2',
    4000000, 4000000, 'client-key-0005', 'pay_link');
  UPDATE public.order_installments
     SET status = 'collected', collected_at = now(), stripe_payment_intent_id = 'ps_4522_f'
   WHERE id = (v_flex->>'installmentId')::uuid;
  v_s := public.issue_4522_settle_flex_payment((v_flex->>'installmentId')::uuid);
  IF NOT (v_s->>'paidInFull')::boolean
     OR public.issue_4522_resolve_balance_link(decode(repeat('ab', 32), 'hex'))->>'state' <> 'paid'
     OR (public.issue_4522_balance('45220005-0000-4000-8000-0000000000a2')->>'remainingMinor')::bigint <> 0
     OR (public.issue_4522_issue_balance_link('45220005-0000-4000-8000-0000000000a2',
           decode(repeat('cd', 32), 'hex'))->>'reason') <> 'paid_in_full' THEN
    RAISE EXCEPTION 'F-2 paid in full must close the balance: %', v_s;
  END IF;
END $$;

-- G. The balance RPC: buyer and brand members only.
DO $$
DECLARE v_b jsonb; v_raised text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '45220005-0000-4000-8000-000000000002', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"45220005-0000-4000-8000-000000000002","role":"authenticated"}', true);
  v_b := public.biz_trip_order_balance('45220005-0000-4000-8000-0000000000a1');
  IF (v_b->>'remainingMinor')::bigint <> 20000000 OR v_b->>'viewer' <> 'buyer'
     OR (v_b->>'canPayAnyAmount')::boolean IS NOT TRUE OR (v_b->>'minPaymentMinor')::bigint <> 5000000 THEN
    RAISE EXCEPTION 'G-1 buyer balance is wrong: %', v_b;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '45220005-0000-4000-8000-000000000003', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"45220005-0000-4000-8000-000000000003","role":"authenticated"}', true);
  v_raised := pg_temp.raised($q$SELECT public.biz_trip_order_balance('45220005-0000-4000-8000-0000000000a1')$q$);
  IF v_raised IS DISTINCT FROM 'P0001:balance_not_found' THEN
    RAISE EXCEPTION 'G-2 a stranger must get balance_not_found, got %', v_raised;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '45220005-0000-4000-8000-000000000001', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"45220005-0000-4000-8000-000000000001","role":"authenticated"}', true);
  IF public.biz_trip_order_balance('45220005-0000-4000-8000-0000000000a1')->>'viewer' <> 'host' THEN
    RAISE EXCEPTION 'G-3 the brand owner reads it as host';
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_4522_begin_flex_payment(uuid,bigint,bigint,text,text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.biz_trip_order_balance(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.issue_4522_rebalance_order(uuid,text,uuid,uuid,jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G-4 grants are wrong';
  END IF;
END $$;

-- H. A planned row's open attempt blocks a flexible payment.
DO $$
DECLARE v_inst uuid;
BEGIN
  DELETE FROM public.order_balance_events WHERE order_id = '45220005-0000-4000-8000-0000000000a3';
  UPDATE public.orders SET payment_plan_terms = payment_plan_terms || '{"flex_enabled": true, "min_payment_minor": 100}'
   WHERE id = '45220005-0000-4000-8000-0000000000a3';
  SELECT id INTO v_inst FROM public.order_installments
   WHERE order_id = '45220005-0000-4000-8000-0000000000a3' AND ordinal = 1;
  PERFORM public.issue_3645_begin_installment_attempt(v_inst, 'pay_link', 0);
  IF pg_temp.raised($q$SELECT public.issue_4522_begin_flex_payment('45220005-0000-4000-8000-0000000000a3',
       1000000, 90000000, 'client-key-0006', 'pay_link')$q$) IS DISTINCT FROM 'PT409:balance_payment_in_flight' THEN
    RAISE EXCEPTION 'H-1 an open planned attempt must block a flexible payment';
  END IF;
END $$;

-- I. #3645 provider floor (issue_3355_provider_minimum_charge_minor): a host
--    minimum below the provider's (₦1 here, Paystack's is ₦100) never lets a
--    flexible payment, or a re-spread row, fall under what the provider charges.
SELECT pg_temp.seed_order('45220005-0000-4000-8000-0000000000b1', true);
UPDATE public.orders SET payment_plan_terms = payment_plan_terms || '{"min_payment_minor": 100}'
 WHERE id = '45220005-0000-4000-8000-0000000000b1';
DO $$
DECLARE v_balance jsonb; v_raised text;
BEGIN
  v_balance := public.issue_4522_balance('45220005-0000-4000-8000-0000000000b1');
  IF (v_balance->>'minPaymentMinor')::bigint IS DISTINCT FROM 10000 THEN
    RAISE EXCEPTION 'I-1 the quoted minimum must be the provider floor, not ₦1: %', v_balance->>'minPaymentMinor';
  END IF;
  v_raised := pg_temp.raised($q$SELECT public.issue_4522_begin_flex_payment('45220005-0000-4000-8000-0000000000b1',
       9999, 90000000, 'client-key-floor1', 'pay_link')$q$);
  IF v_raised IS DISTINCT FROM '22023:flex_amount_below_minimum' THEN
    RAISE EXCEPTION 'I-2 a payment under the provider floor must be refused before any row, got %', v_raised;
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_installments
              WHERE order_id = '45220005-0000-4000-8000-0000000000b1' AND kind = 'flex') THEN
    RAISE EXCEPTION 'I-3 a refused payment must leave no flexible row';
  END IF;
  -- ₦150 left over three dates: ₦50 rows clear the host's ₦1 minimum but not
  -- the provider's ₦100, so the re-spread keeps one row (the latest date).
  PERFORM public.issue_4522_rebalance_order('45220005-0000-4000-8000-0000000000b1', 'host_adjust', NULL, NULL,
    '[{"ticket_type_id":"45220005-0000-4000-8000-000000000030","net_minor":89985000,"addon_minor":0}]'::jsonb);
  IF pg_temp.rows('45220005-0000-4000-8000-0000000000b1') IS DISTINCT FROM
     '2026-12-17:30000000:superseded:v0,2027-01-13:30000000:superseded:v0,2027-02-10:15000:scheduled:v1' THEN
    RAISE EXCEPTION 'I-4 a re-spread must not split under the provider floor: %',
      pg_temp.rows('45220005-0000-4000-8000-0000000000b1');
  END IF;
END $$;

ROLLBACK;
