-- MINGLA-INVARIANT: I-4522-7 | issue #4522 | A trip package never carries both plan shapes: tier_metadata holds installments (legacy) or payment_plan (v2), and a v2 plan is refused while issue_4522_plan_v2_enabled() is false.
\set ON_ERROR_STOP on

-- Issue #4522 slice 1 (M1, 20281120054522): the v2 plan model, the switch,
-- the validator, the publish guard, the refund-policy keys and the new
-- order_installments / orders / session columns. Runs after the full chain.
-- The switch is flipped ON only inside this transaction (rolled back).

BEGIN;

SELECT set_config('request.jwt.claim.sub', '45220001-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO auth.users(id) VALUES ('45220001-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES ('45220001-0000-4000-8000-000000000001');
INSERT INTO public.brands(id, account_id, name, slug, default_currency)
VALUES ('45220001-0000-4000-8000-000000000010', '45220001-0000-4000-8000-000000000001',
        'Issue 4522 plans', 'issue-4522-plans', 'USD');

CREATE FUNCTION pg_temp.rev(p_event uuid) RETURNS timestamptz
LANGUAGE sql AS $$ SELECT updated_at FROM public.events WHERE id = p_event $$;

CREATE FUNCTION pg_temp.raised(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;

CREATE FUNCTION pg_temp.v2(p_extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('payment_plan', jsonb_build_object(
    'v', 2,
    'deposit', jsonb_build_object('mode', 'percent', 'pct', 25),
    'count', 3,
    'final_due_days_before_start', 30,
    'auto_adjust', true,
    'flex', jsonb_build_object('enabled', false),
    'custom_amounts_minor', NULL) || p_extra)
$$;

DO $$
DECLARE
  v_raised text;
  v_case record;
BEGIN
  -- S1-01 the switch ships off and only service_role may call it.
  IF public.issue_4522_plan_v2_enabled() IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'S1-01 the v2 switch must ship false';
  END IF;
  IF has_function_privilege('anon', 'public.issue_4522_plan_v2_enabled()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_4522_plan_v2_enabled()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.issue_4522_plan_v2_enabled()', 'EXECUTE') THEN
    RAISE EXCEPTION 'S1-01 switch grants are wrong';
  END IF;

  -- S1-02 SC-1: a v2 plan is refused while the switch is off.
  v_raised := pg_temp.raised(format('SELECT public.biz_validate_trip_installment_schedule(%L::jsonb)', pg_temp.v2()));
  IF v_raised IS DISTINCT FROM 'P0001:payment_plan_v2_unavailable' THEN
    RAISE EXCEPTION 'S1-02 expected payment_plan_v2_unavailable, got %', v_raised;
  END IF;

  -- S1-03 SC-1: both shapes on one package is a conflict (even with the switch off).
  v_raised := pg_temp.raised(format('SELECT public.biz_validate_trip_installment_schedule(%L::jsonb)',
    pg_temp.v2() || '{"installments":{"deposit_pct":50,"installments":[{"ordinal":1,"pct":50,"days_after_booking":10}]}}'::jsonb));
  IF v_raised IS DISTINCT FROM '22023:payment_plan_shape_conflict' THEN
    RAISE EXCEPTION 'S1-03 expected payment_plan_shape_conflict, got %', v_raised;
  END IF;

  -- S1-04 legacy v1 checks are unchanged.
  PERFORM public.biz_validate_trip_installment_schedule(
    '{"installments":{"deposit_pct":50,"installments":[{"ordinal":1,"pct":50,"days_after_booking":10}]}}');
  PERFORM public.biz_validate_trip_installment_schedule('{}');
  PERFORM public.biz_validate_trip_installment_schedule('{"payment_plan":null}');
  v_raised := pg_temp.raised($q$SELECT public.biz_validate_trip_installment_schedule(
    '{"installments":{"deposit_pct":50,"installments":[{"ordinal":1,"pct":40,"days_after_booking":10}]}}')$q$);
  IF v_raised IS DISTINCT FROM '22023:installment_pct_sum_mismatch' THEN
    RAISE EXCEPTION 'S1-04 v1 refusal changed: %', v_raised;
  END IF;
END $$;

-- The switch goes ON for the rest of this transaction only.
CREATE OR REPLACE FUNCTION public.issue_4522_plan_v2_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$ SELECT true $fn$;

DO $$
DECLARE
  v_raised text;
  v_case record;
BEGIN
  -- S1-05 SC-1: with the switch on, a well-formed plan validates.
  PERFORM public.biz_validate_trip_installment_schedule(pg_temp.v2());
  PERFORM public.biz_validate_trip_installment_schedule(pg_temp.v2(
    '{"deposit":{"mode":"amount","amount_minor":25000},"count":4,"flex":{"enabled":true,"min_payment_minor":5000},"custom_amounts_minor":[100,200,300]}'));

  -- S1-06 every shape refusal names its code with 22023.
  FOR v_case IN SELECT * FROM (VALUES
    ('{"v":1}', 'plan_version_invalid'),
    ('{"surprise":true}', 'plan_version_invalid'),
    ('{"auto_adjust":"yes"}', 'plan_version_invalid'),
    ('{"deposit":{"mode":"percent","pct":0}}', 'plan_deposit_invalid'),
    ('{"deposit":{"mode":"percent","pct":101}}', 'plan_deposit_invalid'),
    ('{"deposit":{"mode":"amount","amount_minor":99}}', 'plan_deposit_invalid'),
    ('{"deposit":{"mode":"amount","amount_minor":100.5}}', 'plan_deposit_invalid'),
    ('{"deposit":{"mode":"fraction","pct":10}}', 'plan_deposit_invalid'),
    ('{"count":0}', 'plan_count_out_of_range'),
    ('{"count":13}', 'plan_count_out_of_range'),
    ('{"count":2.5}', 'plan_count_out_of_range'),
    ('{"final_due_days_before_start":-1}', 'plan_final_due_out_of_range'),
    ('{"final_due_days_before_start":181}', 'plan_final_due_out_of_range'),
    ('{"flex":{"enabled":true}}', 'plan_flex_min_invalid'),
    ('{"flex":{"enabled":true,"min_payment_minor":50}}', 'plan_flex_min_invalid'),
    ('{"flex":{"enabled":"yes"}}', 'plan_flex_min_invalid'),
    ('{"custom_amounts_minor":[100]}', 'plan_custom_amounts_invalid'),
    ('{"custom_amounts_minor":[100,99]}', 'plan_custom_amounts_invalid'),
    ('{"custom_amounts_minor":[100,100.5]}', 'plan_custom_amounts_invalid')
  ) c(extra, code) LOOP
    v_raised := pg_temp.raised(format('SELECT public.biz_validate_trip_installment_schedule(%L::jsonb)',
      pg_temp.v2(v_case.extra::jsonb)));
    IF v_raised IS DISTINCT FROM '22023:' || v_case.code THEN
      RAISE EXCEPTION 'S1-06 % expected %, got %', v_case.extra, v_case.code, v_raised;
    END IF;
  END LOOP;

  -- S1-07 the plan must fit the package price.
  PERFORM public.biz_validate_trip_plan_against_price(pg_temp.v2(), 120000);
  PERFORM public.biz_validate_trip_plan_against_price('{}', 0);
  FOR v_case IN SELECT * FROM (VALUES
    ('{"deposit":{"mode":"amount","amount_minor":130000}}', 120000, 'plan_deposit_invalid'),
    ('{"custom_amounts_minor":[45000,45000]}', 120000, 'plan_custom_amounts_exceed_balance'),
    ('{"flex":{"enabled":true,"min_payment_minor":90001}}', 120000, 'plan_flex_min_above_balance')
  ) c(extra, price, code) LOOP
    v_raised := pg_temp.raised(format('SELECT public.biz_validate_trip_plan_against_price(%L::jsonb, %s)',
      pg_temp.v2(v_case.extra::jsonb), v_case.price));
    IF v_raised IS DISTINCT FROM '22023:' || v_case.code THEN
      RAISE EXCEPTION 'S1-07 % expected %, got %', v_case.extra, v_case.code, v_raised;
    END IF;
  END LOOP;
  PERFORM public.biz_validate_trip_plan_against_price(
    pg_temp.v2('{"custom_amounts_minor":[44999,45000]}'), 120000);
END $$;

-- Inside this transaction only, Paystack plans are off, so a Paystack brand
-- lacks the trip-plan capability (S1-09).
CREATE OR REPLACE FUNCTION public.issue_3645_paystack_installments_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$ SELECT false $fn$;

-- S1-08 the draft graph: share_payment_plan copies the first package's plan
-- to every package, and a plan that does not fit a price names that package.
DO $$
DECLARE
  v_brand uuid := '45220001-0000-4000-8000-000000000010';
  g jsonb;
  v_event uuid;
  v_first uuid;
  v_second uuid;
  v_raised text;
  v_meta jsonb;
BEGIN
  g := public.biz_create_trip_draft(v_brand, jsonb_build_object('title', 'Plan trip'),
    '45220001-0000-4000-8000-0000000000a1');
  v_event := (g#>>'{event,id}')::uuid;
  v_first := (g#>>'{tiers,0,ticket_type_id}')::uuid;
  g := public.biz_apply_trip_draft_graph(v_event,
    jsonb_build_object('tiers', jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_first, 'tier_name', 'Shared room', 'price_cents', 120000,
        'tier_metadata', pg_temp.v2()),
      jsonb_build_object('tier_name', 'Private room', 'price_cents', 200000, 'capacity', 10,
        'display_order', 5,
        'tier_metadata', '{"installments":{"deposit_pct":50,"installments":[{"ordinal":1,"pct":50,"days_after_booking":10}]}}'::jsonb)),
      'settings', jsonb_build_object('share_payment_plan', true)),
    pg_temp.rev(v_event), '45220001-0000-4000-8000-0000000000a2');
  SELECT t.ticket_type_id INTO v_second FROM public.trip_pricing_tiers t
   WHERE t.event_id = v_event AND t.ticket_type_id <> v_first;
  IF (SELECT share_payment_plan FROM public.events WHERE id = v_event) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'S1-08 share_payment_plan was not stored';
  END IF;
  SELECT tier_metadata INTO v_meta FROM public.trip_pricing_tiers WHERE ticket_type_id = v_second;
  IF v_meta->'payment_plan' IS DISTINCT FROM pg_temp.v2()->'payment_plan' OR v_meta ? 'installments' THEN
    RAISE EXCEPTION 'S1-08 the shared plan was not copied over the legacy plan: %', v_meta;
  END IF;

  -- An amount deposit above the cheaper package's price names that package.
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(v_event,
      jsonb_build_object('tiers', jsonb_build_array(
        jsonb_build_object('ticket_type_id', v_first, 'tier_metadata',
          pg_temp.v2('{"deposit":{"mode":"amount","amount_minor":150000}}')))),
      pg_temp.rev(v_event), '45220001-0000-4000-8000-0000000000a3');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_raised = PG_EXCEPTION_HINT;
    v_raised := SQLERRM || '|' || v_raised;
  END;
  IF v_raised IS DISTINCT FROM 'plan_deposit_invalid|Shared room' THEN
    RAISE EXCEPTION 'S1-08 expected plan_deposit_invalid naming Shared room, got %', v_raised;
  END IF;

  -- S1-09 publish guard: a v2 plan needs the trip-plan capability like v1.
  UPDATE public.trip_pricing_tiers SET tier_metadata = pg_temp.v2() WHERE event_id = v_event;
  UPDATE public.brands SET payment_provider = 'paystack' WHERE id = v_brand;
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_event, now() + interval '90 days', now() + interval '95 days', 'UTC', true);
  v_raised := pg_temp.raised(format(
    'UPDATE public.events SET status = %L, visibility = %L WHERE id = %L', 'scheduled', 'public', v_event));
  IF v_raised IS DISTINCT FROM 'P0001:installment_capability_unavailable' THEN
    RAISE EXCEPTION 'S1-09 publish guard must refuse a v2 plan without capability, got %', v_raised;
  END IF;
END $$;

-- S1-10 the switch back OFF: the draft graph refuses a v2 plan (SC-1).
CREATE OR REPLACE FUNCTION public.issue_4522_plan_v2_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$ SELECT false $fn$;

DO $$
DECLARE
  g jsonb;
  v_event uuid;
  v_raised text;
BEGIN
  g := public.biz_create_trip_draft('45220001-0000-4000-8000-000000000010',
    jsonb_build_object('title', 'Plan trip two'), '45220001-0000-4000-8000-0000000000b1');
  v_event := (g#>>'{event,id}')::uuid;
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(v_event,
      jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
        'ticket_type_id', (g#>>'{tiers,0,ticket_type_id}')::uuid, 'price_cents', 50000,
        'tier_metadata', pg_temp.v2()))),
      pg_temp.rev(v_event), '45220001-0000-4000-8000-0000000000b2');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLSTATE || ':' || SQLERRM;
  END;
  IF v_raised IS DISTINCT FROM 'P0001:payment_plan_v2_unavailable' THEN
    RAISE EXCEPTION 'S1-10 a v2 save with the switch off must be refused, got %', v_raised;
  END IF;
END $$;

-- S1-11 refund policy keys.
DO $$
DECLARE v_raised text; v_case record;
BEGIN
  PERFORM public.validate_refund_policy('{"kind":"custom","tiers":[],"no_refunds":true}');
  PERFORM public.validate_refund_policy(
    '{"kind":"standard","tiers":[{"days_before_start":30,"refund_pct":100}],"deposit_non_refundable":true}');
  PERFORM public.validate_refund_policy(
    '{"kind":"standard","tiers":[{"days_before_start":30,"refund_pct":100},{"days_before_start":14,"refund_pct":50}]}');
  FOR v_case IN SELECT * FROM (VALUES
    ('{"kind":"custom","tiers":[{"days_before_start":3,"refund_pct":10}],"no_refunds":true}', 'empty tiers ladder'),
    ('{"kind":"custom","tiers":[]}', 'at least 1 tier'),
    ('{"kind":"custom","tiers":[],"no_refunds":"yes"}', 'no_refunds must be a boolean'),
    ('{"kind":"standard","tiers":[{"days_before_start":3,"refund_pct":10}],"deposit_non_refundable":1}', 'deposit_non_refundable must be a boolean')
  ) c(policy, fragment) LOOP
    v_raised := pg_temp.raised(format('SELECT public.validate_refund_policy(%L::jsonb)', v_case.policy));
    IF v_raised IS NULL OR position(v_case.fragment IN v_raised) = 0 THEN
      RAISE EXCEPTION 'S1-11 % expected "%", got %', v_case.policy, v_case.fragment, v_raised;
    END IF;
  END LOOP;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.validate_refund_policy(jsonb)'::regprocedure) <> 'i'
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.validate_refund_policy(jsonb)'::regprocedure
                     AND proconfig @> ARRAY['search_path=public, extensions, pg_temp']) THEN
    RAISE EXCEPTION 'S1-11 validate_refund_policy must stay IMMUTABLE with its #4423 search_path';
  END IF;
END $$;

-- S1-12 order_installments: superseded, flex and the one-open-flex index.
DO $$
DECLARE
  v_order uuid := gen_random_uuid();
  v_event uuid := (SELECT id FROM public.events WHERE brand_id = '45220001-0000-4000-8000-000000000010' LIMIT 1);
  v_row uuid;
  v_raised text;
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, currency,
    payment_method, payment_status, source, installment_plan_root)
  VALUES (v_order, v_event, 'b@example.test', 'Buyer', '+15555550101', 1000, 'USD', 'online_card', 'paid',
    'online_checkout', true);
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider, collection_method)
  VALUES (v_order, 1, 3000, 'USD', now() + interval '30 days', 'scheduled', 'stripe', 'auto_card')
  RETURNING id INTO v_row;
  IF (SELECT kind || ':' || schedule_version || ':' || addon_portion_minor
        FROM public.order_installments WHERE id = v_row) IS DISTINCT FROM 'scheduled:0:0' THEN
    RAISE EXCEPTION 'S1-12 defaults are wrong';
  END IF;
  v_raised := pg_temp.raised(format('UPDATE public.order_installments SET status = %L WHERE id = %L', 'superseded', v_row));
  IF v_raised NOT LIKE '23514:%superseded_at_status_consistent%' THEN
    RAISE EXCEPTION 'S1-12 superseded without superseded_at must fail, got %', v_raised;
  END IF;
  UPDATE public.order_installments SET status = 'superseded', superseded_at = now() WHERE id = v_row;
  v_raised := pg_temp.raised(format('UPDATE public.order_installments SET addon_portion_minor = 3001 WHERE id = %L', v_row));
  IF v_raised NOT LIKE '23514:%addon_portion_check%' THEN
    RAISE EXCEPTION 'S1-12 an add-on portion above the amount must fail, got %', v_raised;
  END IF;
  v_raised := pg_temp.raised(format(
    'INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider, collection_method, kind)
     VALUES (%L, 2, 500, %L, now(), %L, %L, %L, %L)', v_order, 'USD', 'scheduled', 'stripe', 'auto_card', 'flex'));
  IF v_raised NOT LIKE '23514:%flex_has_allocation%' THEN
    RAISE EXCEPTION 'S1-12 a flex row without line_allocation must fail, got %', v_raised;
  END IF;
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider,
    collection_method, kind, line_allocation)
  VALUES (v_order, 2, 500, 'USD', now(), 'scheduled', 'stripe', 'auto_card', 'flex', '[]');
  v_raised := pg_temp.raised(format(
    'INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status, provider, collection_method, kind, line_allocation)
     VALUES (%L, 3, 500, %L, now(), %L, %L, %L, %L, %L)', v_order, 'USD', 'scheduled', 'stripe', 'auto_card', 'flex', '[]'));
  IF v_raised NOT LIKE '23505:%uq_order_one_open_flex%' THEN
    RAISE EXCEPTION 'S1-12 a second open flex row must fail, got %', v_raised;
  END IF;
  v_raised := pg_temp.raised(format('UPDATE public.orders SET addon_payment_mode = %L WHERE id = %L', 'later', v_order));
  IF v_raised NOT LIKE '23514:%addon_payment_mode%' THEN
    RAISE EXCEPTION 'S1-12 an unknown add-on payment mode must fail, got %', v_raised;
  END IF;
END $$;

-- S1-13 the audit and link tables are service-role only.
DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['public.order_balance_events', 'public.order_balance_links'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_table::regclass) THEN
      RAISE EXCEPTION 'S1-13 % must have RLS on', v_table;
    END IF;
    IF has_table_privilege('anon', v_table, 'SELECT') OR has_table_privilege('authenticated', v_table, 'SELECT')
       OR has_table_privilege('authenticated', v_table, 'INSERT')
       OR NOT has_table_privilege('service_role', v_table, 'SELECT') THEN
      RAISE EXCEPTION 'S1-13 % grants are wrong', v_table;
    END IF;
  END LOOP;
  IF has_table_privilege('service_role', 'public.order_balance_events', 'UPDATE') THEN
    RAISE EXCEPTION 'S1-13 the balance audit must be insert-only for service_role';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE v_raised text;
BEGIN
  BEGIN
    PERFORM 1 FROM public.order_balance_events;
  EXCEPTION WHEN insufficient_privilege THEN v_raised := 'denied';
  END;
  IF v_raised IS DISTINCT FROM 'denied' THEN
    RAISE EXCEPTION 'S1-13 authenticated must not read order_balance_events';
  END IF;
END $$;
RESET ROLE;

ROLLBACK;
