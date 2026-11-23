-- MINGLA-INVARIANT: I-4522-8 | issue #4522 | A superseded instalment row is never money: rollover moves its amount onto later rows and it is never charged, retried, noticed or counted as due.
\set ON_ERROR_STOP on

-- Issue #4522 slice 6 (M3b, 20281202054522): the missed-payment rollover
-- (D-7, after the last retry), the host money screen and Admin balance reads.

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
  SELECT string_agg(ordinal || ':' || amount_cents || ':' || status || ':v' || schedule_version, ','
                    ORDER BY ordinal)
    FROM public.order_installments WHERE order_id = p_order
$$;

INSERT INTO auth.users(id, email) VALUES
  ('45220006-0000-4000-8000-000000000001', 'roll-host@example.test'),
  ('45220006-0000-4000-8000-000000000003', 'roll-admin@example.test');
INSERT INTO public.creator_accounts(id, email) VALUES
  ('45220006-0000-4000-8000-000000000001', 'roll-host@example.test');
INSERT INTO public.admin_users(email, role, status) VALUES ('roll-admin@example.test', 'admin', 'active');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country)
VALUES ('45220006-0000-4000-8000-000000000010', '45220006-0000-4000-8000-000000000001',
        'Rollover brand', 'roll-brand-4522', 'NGN', 'paystack', 'NG');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency)
VALUES ('45220006-0000-4000-8000-000000000020', '45220006-0000-4000-8000-000000000010',
        '45220006-0000-4000-8000-000000000001', 'Rollover trip', 'roll-trip-4522', 'trip', 'scheduled',
        'public', 'Africa/Lagos', 'NGN');
INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total, is_unlimited,
  min_purchase_qty, available_online, available_in_person)
VALUES ('45220006-0000-4000-8000-000000000030', '45220006-0000-4000-8000-000000000020', 'Room',
        120000000, 'NGN', false, 20, false, 1, true, false);

CREATE FUNCTION pg_temp.seed_order(p_order uuid, p_terms jsonb) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source, installment_plan_root, payment_plan_terms)
  VALUES (p_order, '45220006-0000-4000-8000-000000000020', 'roll-buyer@example.test', 'Roll Buyer',
    '+2348000000002', 30000000, 'NGN', 'online_card', 'paid', 'online_checkout', true, p_terms);
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, plan_bound_at, buyer_total_cents, planned_application_fee_cents, ticket_type_id)
  SELECT p_order, g, 30000000, 'NGN', d, 'scheduled', 'paystack', 'pay_link', now(), 30600000, 1350000,
         '45220006-0000-4000-8000-000000000030'
    FROM (VALUES (1, timestamptz '2026-12-17T08:00:00Z'), (2, '2027-01-13T08:00:00Z'), (3, '2027-02-10T08:00:00Z')) v(g, d);
  -- Two retries already used on the first row.
  UPDATE public.order_installments
     SET status = 'failed', failed_at = now(), failure_reason = 'card_declined', retry_count = 2
   WHERE order_id = p_order AND ordinal = 1;
END $$;

SELECT pg_temp.seed_order('45220006-0000-4000-8000-0000000000a1',
  '{"v":2,"auto_adjust":true,"flex_enabled":false}');
SELECT pg_temp.seed_order('45220006-0000-4000-8000-0000000000a2', NULL);
SELECT pg_temp.seed_order('45220006-0000-4000-8000-0000000000a3',
  '{"v":2,"auto_adjust":false,"flex_enabled":false}');

-- A. SC-8: the third failure of row 1 rolls into rows 2 and 3; not at risk.
DO $$
DECLARE v_r jsonb; v_got text;
BEGIN
  v_r := public.issue_3645_count_installment_failure((SELECT id FROM public.order_installments
    WHERE order_id = '45220006-0000-4000-8000-0000000000a1' AND ordinal = 1), 'card_declined');
  v_got := pg_temp.rows('45220006-0000-4000-8000-0000000000a1');
  IF v_got IS DISTINCT FROM '1:30000000:superseded:v0,2:45000000:scheduled:v1,3:45000000:scheduled:v1'
     OR (v_r->>'outcome') <> 'failed' OR NOT COALESCE((v_r->>'rolled_over')::boolean, false)
     OR (SELECT at_risk FROM public.orders WHERE id = '45220006-0000-4000-8000-0000000000a1') IS TRUE THEN
    RAISE EXCEPTION 'A-1 SC-8 rollover is wrong: % / %', v_got, v_r;
  END IF;
  -- Locked prices follow: 102% of the rows, rounded down once.
  IF (SELECT sum(buyer_total_cents) FROM public.order_installments
       WHERE order_id = '45220006-0000-4000-8000-0000000000a1' AND status = 'scheduled') <> 91800000
     OR (SELECT count(*) FROM public.order_balance_events
          WHERE order_id = '45220006-0000-4000-8000-0000000000a1' AND reason = 'missed_rollover') <> 1 THEN
    RAISE EXCEPTION 'A-2 rollover must scale locked prices and record one balance event';
  END IF;
END $$;

-- B. SC-8: the last row has nowhere to go: at risk as today.
DO $$
DECLARE v_r jsonb; v_inst uuid;
BEGIN
  UPDATE public.order_installments SET status = 'failed', failed_at = now(), failure_reason = 'x', retry_count = 2
   WHERE order_id = '45220006-0000-4000-8000-0000000000a1' AND ordinal = 2;
  PERFORM public.issue_3645_count_installment_failure((SELECT id FROM public.order_installments
    WHERE order_id = '45220006-0000-4000-8000-0000000000a1' AND ordinal = 2), 'card_declined');
  IF pg_temp.rows('45220006-0000-4000-8000-0000000000a1')
       IS DISTINCT FROM '1:30000000:superseded:v0,2:45000000:superseded:v1,3:90000000:scheduled:v2' THEN
    RAISE EXCEPTION 'B-1 the second rollover lands on the final row: %', pg_temp.rows('45220006-0000-4000-8000-0000000000a1');
  END IF;
  SELECT id INTO v_inst FROM public.order_installments
   WHERE order_id = '45220006-0000-4000-8000-0000000000a1' AND ordinal = 3;
  UPDATE public.order_installments SET status = 'failed', failed_at = now(), failure_reason = 'x', retry_count = 2
   WHERE id = v_inst;
  v_r := public.issue_3645_count_installment_failure(v_inst, 'card_declined');
  IF v_r->>'outcome' <> 'at_risk'
     OR (SELECT at_risk FROM public.orders WHERE id = '45220006-0000-4000-8000-0000000000a1') IS NOT TRUE
     OR (SELECT status FROM public.order_installments WHERE id = v_inst) <> 'failed' THEN
    RAISE EXCEPTION 'B-2 the final row flags the booking at risk: %', v_r;
  END IF;
END $$;

-- C. Legacy plans and auto-adjust off are flagged exactly as before.
DO $$
DECLARE v_o uuid; v_r jsonb;
BEGIN
  FOREACH v_o IN ARRAY ARRAY['45220006-0000-4000-8000-0000000000a2', '45220006-0000-4000-8000-0000000000a3']::uuid[] LOOP
    v_r := public.issue_3645_count_installment_failure((SELECT id FROM public.order_installments
         WHERE order_id = v_o AND ordinal = 1), 'card_declined');
    IF v_r->>'outcome' <> 'at_risk'
       OR pg_temp.rows(v_o) IS DISTINCT FROM '1:30000000:failed:v0,2:30000000:scheduled:v0,3:30000000:scheduled:v0'
       OR (SELECT at_risk FROM public.orders WHERE id = v_o) IS NOT TRUE THEN
      RAISE EXCEPTION 'C-1 % must be flagged at risk with rows unchanged: %', v_o, pg_temp.rows(v_o);
    END IF;
  END LOOP;
END $$;

-- D. A failed flexible row is closed, not counted toward at risk.
DO $$
DECLARE v_flex uuid; v_r jsonb;
BEGIN
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, plan_bound_at, buyer_total_cents, kind, flex_client_key, line_allocation)
  VALUES ('45220006-0000-4000-8000-0000000000a3', 9, 1000000, 'NGN', now(), 'scheduled', 'paystack', 'pay_link',
    now(), 1020000, 'flex', 'client-key-roll', '[]')
  RETURNING id INTO v_flex;
  UPDATE public.orders SET at_risk = false WHERE id = '45220006-0000-4000-8000-0000000000a3';
  v_r := public.issue_3645_count_installment_failure(v_flex, 'card_declined');
  IF NOT COALESCE((v_r->>'flex_closed')::boolean, false)
     OR (SELECT status FROM public.order_installments WHERE id = v_flex) <> 'superseded'
     OR (SELECT at_risk FROM public.orders WHERE id = '45220006-0000-4000-8000-0000000000a3') IS TRUE THEN
    RAISE EXCEPTION 'D-1 a failed flexible row must close without flagging: %', v_r;
  END IF;
END $$;

-- E. Host money screen and Admin reads.
DO $$
DECLARE v_list jsonb; v_old jsonb;
BEGIN
  -- A pay-in-full order on the same trip has no plan balance.
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source, installment_plan_root)
  VALUES ('45220006-0000-4000-8000-0000000000a4', '45220006-0000-4000-8000-000000000020',
    'roll-full@example.test', 'Roll Full', '+2348000000003', 120000000, 'NGN', 'online_card', 'paid',
    'online_checkout', false);
  PERFORM set_config('request.jwt.claim.sub', '45220006-0000-4000-8000-000000000001', true);
  v_list := public.biz_trip_event_balances('45220006-0000-4000-8000-000000000020');
  -- E-5: every plan order (the two v2 orders and the older plan), never the
  -- pay-in-full one.
  IF jsonb_array_length(v_list) <> 3
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) b
                 WHERE b->>'orderId' = '45220006-0000-4000-8000-0000000000a4') THEN
    RAISE EXCEPTION 'E-1 the host sees every plan order and no pay-in-full order, got %', jsonb_array_length(v_list);
  END IF;
  IF (SELECT string_agg(b->>'orderId' || '=' || (b->>'planVersion'), ',' ORDER BY b->>'orderId')
        FROM jsonb_array_elements(v_list) b)
     IS DISTINCT FROM '45220006-0000-4000-8000-0000000000a1=2,45220006-0000-4000-8000-0000000000a2=1,45220006-0000-4000-8000-0000000000a3=2' THEN
    RAISE EXCEPTION 'E-1b each balance names its plan version: %', v_list;
  END IF;
  -- E-5: the older plan's order stored only its deposit as the total; the
  -- reader gives the truth ($ deposit paid of deposit + every row), and the
  -- Admin reader agrees.
  SELECT b INTO v_old FROM jsonb_array_elements(v_list) b
   WHERE b->>'orderId' = '45220006-0000-4000-8000-0000000000a2';
  IF (v_old->>'paidMinor')::bigint <> 30000000 OR (v_old->>'totalMinor')::bigint <> 120000000
     OR (v_old->>'remainingMinor')::bigint <> 90000000 THEN
    RAISE EXCEPTION 'E-1c the older plan reads paid 30000000 of 120000000, 90000000 left: %', v_old;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '45220006-0000-4000-8000-000000000003', true);
  IF (SELECT (b->>'paidMinor') || '/' || (b->>'totalMinor') || '/' || (b->>'remainingMinor')
        FROM (SELECT public.admin_trip_order_balance('45220006-0000-4000-8000-0000000000a2') b) x)
     IS DISTINCT FROM '30000000/120000000/90000000' THEN
    RAISE EXCEPTION 'E-1d Admin reads the same figures for the older plan';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '45220006-0000-4000-8000-000000000001', true);
  IF pg_temp.raised($q$SELECT public.admin_trip_order_balance('45220006-0000-4000-8000-0000000000a1')$q$)
       NOT LIKE '%not_authorized%' THEN
    RAISE EXCEPTION 'E-2 a non-admin must be refused';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '45220006-0000-4000-8000-000000000003', true);
  IF jsonb_array_length(public.admin_trip_order_balance('45220006-0000-4000-8000-0000000000a1')->'rows') <> 3 THEN
    RAISE EXCEPTION 'E-3 Admin sees every row of the order';
  END IF;
  -- S-13: each row says what it is charged through (no "Provider unknown").
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(
               public.admin_trip_order_balance('45220006-0000-4000-8000-0000000000a1')->'rows') r
              WHERE r->>'provider' IS DISTINCT FROM 'paystack'
                 OR r->>'collectionMethod' IS DISTINCT FROM 'pay_link'
                 OR NOT (r ? 'buyerTotalMinor')) THEN
    RAISE EXCEPTION 'E-3b Admin rows carry provider, collection method and buyer total';
  END IF;
  IF pg_temp.raised($q$SELECT public.biz_trip_event_balances('45220006-0000-4000-8000-000000000020')$q$)
       IS DISTINCT FROM 'P0001:balance_not_found' THEN
    RAISE EXCEPTION 'E-4 a non-member must get balance_not_found';
  END IF;
END $$;

ROLLBACK;
