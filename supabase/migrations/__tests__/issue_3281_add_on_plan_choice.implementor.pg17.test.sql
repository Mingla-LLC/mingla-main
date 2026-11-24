-- #3281 S5: add-ons on a trip plan (today / spread) on the #3859 contract path, refunds per choice, and the S1 deferrals.
-- MINGLA-INVARIANT: I-ADDON-PLAN-SUM | issue #3281 | For every order whose add-ons ride a plan, today's charge plus every plan row equals the ticket net plus the add-on total, for both the today and the spread choice.
-- MINGLA-INVARIANT: I-ADDON-PLAN-SWITCH-OFF-IDENTICAL | issue #3281 | With add_on_rollout.plan_enabled off the contract-path planner and bind answer exactly as before, and add-ons never ride a plan.
-- MINGLA-INVARIANT: I-ADDON-SPREAD-REFUND-UNCOLLECTED-FIRST | issue #3281 | Refunding a spread add-on takes it off the open plan rows first and refunds in money only what was collected; a removal is never applied twice for one request.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.raised(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;

-- A trip 200 days out with one v2 package (USD 1,200, 25% deposit, 3 rows, no
-- flex) and a USD 300 add-on, plus a second package for the shared-stock check.
INSERT INTO auth.users(id,email) VALUES('32815000-0000-4000-8500-000000000001','s5-owner@example.test');
INSERT INTO public.creator_accounts(id,email) VALUES('32815000-0000-4000-8500-000000000001','s5-owner@example.test');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,payment_provider,payment_country,pricing_region,pricing_currency)
VALUES('32815000-0000-4000-8500-000000000002','32815000-0000-4000-8500-000000000001','S5 brand','s5-brand-3281','USD','stripe','US','US','USD');
INSERT INTO public.stripe_connect_accounts(brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency)
VALUES('32815000-0000-4000-8500-000000000002','acct_s5',true,true,'US','usd');
INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency)
VALUES('32815000-0000-4000-8500-000000000003','32815000-0000-4000-8500-000000000002','32815000-0000-4000-8500-000000000001',
  'S5 trip','s5-trip-3281','trip','scheduled','public','UTC','USD');
INSERT INTO public.event_dates(id,event_id,start_at,end_at,timezone,is_master)
VALUES('32815000-0000-4000-8500-000000000004','32815000-0000-4000-8500-000000000003',
  date_trunc('day', now()) + interval '200 days 9 hours', date_trunc('day', now()) + interval '207 days 9 hours','UTC',true);
INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,min_purchase_qty,max_purchase_qty,available_online,available_in_person)
VALUES
 ('32815000-0000-4000-8500-000000000011','32815000-0000-4000-8500-000000000003','Plan package',120000,'USD',false,50,false,1,10,true,false),
 ('32815000-0000-4000-8500-000000000012','32815000-0000-4000-8500-000000000003','Day package',40000,'USD',false,50,false,1,10,true,false);
INSERT INTO public.trip_pricing_tiers(event_id,ticket_type_id,tier_name,tier_metadata)
VALUES ('32815000-0000-4000-8500-000000000003','32815000-0000-4000-8500-000000000011','Plan package',
  '{"payment_plan":{"v":2,"deposit":{"mode":"percent","pct":25},"count":3,"final_due_days_before_start":30,"auto_adjust":true,"flex":{"enabled":false}}}');
INSERT INTO public.ticket_add_ons(id,ticket_type_id,name,price_cents,quantity_total,is_unlimited,max_per_ticket)
VALUES ('32815000-0000-4000-8500-000000000021','32815000-0000-4000-8500-000000000011','Airport transfer',30000,NULL,true,2);

-- One contract-path checkout (#3859 v2): the session is created paying in full
-- (as the edge does), then planned and bound. Returns the session id.
CREATE FUNCTION pg_temp.contract_session(p_attempt uuid, p_email text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_s jsonb;
BEGIN
  v_s := public.biz_ticket_checkout_create_session('32815000-0000-4000-8500-000000000003', NULL, 'Buyer', p_email,
    '+15555550911', false,
    '[{"ticketTypeId":"32815000-0000-4000-8500-000000000011","quantity":1,"paymentPlanChoice":"installments",
       "addOns":[{"addOnId":"32815000-0000-4000-8500-000000000021","quantity":2}]}]',
    'ticket_checkout:v2:32815000-0000-4000-8500-000000000003:' || p_attempt::text,
    now() + interval '15 minutes', 0, 'full', NULL, NULL, NULL, NULL, NULL, NULL);
  RETURN (v_s->>'checkoutSessionId')::uuid;
END $$;

CREATE FUNCTION pg_temp.plan_lines(p_mode text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object(
    'ticketTypeId','32815000-0000-4000-8500-000000000011','quantity',1,'paymentPlanChoice','installments',
    'addOns',jsonb_build_array(jsonb_build_object('addOnId','32815000-0000-4000-8500-000000000021','quantity',2)))
    || CASE WHEN p_mode IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('addonPaymentMode', p_mode) END)
$$;

-- The schedule the edge passes to the bind, built from the database's plan.
CREATE FUNCTION pg_temp.edge_schedule(p_plan jsonb, p_due_today bigint) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_object('fullPriceCents', 180000, 'depositCents', p_due_today, 'currency', 'USD',
    'installments', p_plan->'installmentSchedule'->'installments', 'planVersion', 2,
    'availability', p_plan->'availability', 'countOffered', p_plan->'countOffered',
    'countGiven', p_plan->'countGiven', 'finalDueAt', p_plan->'finalDueAt')
$$;

CREATE FUNCTION pg_temp.bind(p_session uuid, p_attempt uuid, p_mode text, p_due_today bigint, p_schedule jsonb) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.issue_3859_bind_checkout_contract(p_session, '32815000-0000-4000-8500-000000000003',
    'ticket_checkout:v2:32815000-0000-4000-8500-000000000003:' || p_attempt::text, p_attempt,
    repeat('a', 64), pg_temp.plan_lines(p_mode), p_due_today::integer, 180000, p_schedule)
$$;

-------------------------------------------------------------------------------
-- A. Switch off (I-ADDON-PLAN-SWITCH-OFF-IDENTICAL): the contract planner is the
--    pre-S5 call exactly, and the bind still refuses add-ons on a plan.
-------------------------------------------------------------------------------
DO $$
DECLARE
  v_session uuid := pg_temp.contract_session('32815000-0000-4000-8500-0000000000a1', 'a@example.test');
  v_plan jsonb;
  v_items jsonb;
  v_raised text;
BEGIN
  IF public.issue_3281_add_on_switch('plan_enabled') THEN
    RAISE EXCEPTION 'A-0 plan_enabled must start off';
  END IF;
  IF (SELECT total_cents FROM public.ticket_checkout_sessions WHERE id = v_session) <> 180000
     OR (SELECT plan_choice FROM public.ticket_checkout_session_add_on_items WHERE checkout_session_id = v_session) IS NOT NULL THEN
    RAISE EXCEPTION 'A-1 the contract session holds the add-ons paid in full';
  END IF;
  v_plan := public.issue_4522_checkout_v2_plan(v_session, pg_temp.plan_lines('spread'));
  SELECT jsonb_agg(jsonb_build_object('ticketTypeId', i.ticket_type_id, 'quantity', i.quantity,
           'totalCents', i.total_cents, 'listUnitPriceCents', COALESCE(i.list_unit_price_cents, i.unit_price_cents),
           'paymentPlanChoice', 'installments') ORDER BY i.created_at, i.id)
    INTO v_items FROM public.ticket_checkout_session_items i WHERE i.checkout_session_id = v_session;
  IF v_plan IS DISTINCT FROM public.issue_4522_plan_cart_v2('32815000-0000-4000-8500-000000000003', v_items, 'full',
       (SELECT created_at FROM public.ticket_checkout_sessions WHERE id = v_session), NULL, NULL)
     OR v_plan ? 'addOnsOnPlan' OR (v_plan->>'addonScheduledCents')::bigint <> 0 THEN
    RAISE EXCEPTION 'A-2 switch off: the contract planner must answer as before, got %', v_plan;
  END IF;
  v_raised := pg_temp.raised(format('SELECT pg_temp.bind(%L, %L, %L, %s, pg_temp.edge_schedule(%L::jsonb, %s))',
    v_session, '32815000-0000-4000-8500-0000000000a1', 'spread', 30000, v_plan, 30000));
  IF v_raised IS DISTINCT FROM 'P0001:checkout_quote_invalid' THEN
    RAISE EXCEPTION 'A-3 switch off: add-ons on a plan are refused at bind, got %', v_raised;
  END IF;
  -- A non-spread order's add-on lines come back from the split untouched.
  IF public.issue_3281_add_on_plan_split('32815000-0000-4000-8500-0000000000ff',
       '[{"order_add_on_line_item_id":"32815000-0000-4000-8500-0000000000fe","quantity":1,"amount_cents":5}]')
     IS DISTINCT FROM '[{"order_add_on_line_item_id":"32815000-0000-4000-8500-0000000000fe","quantity":1,"amount_cents":5}]'::jsonb THEN
    RAISE EXCEPTION 'A-4 a non-spread split must be the identity';
  END IF;
END $$;

UPDATE public.add_on_rollout SET plan_enabled = true, free_parent_enabled = true;

-------------------------------------------------------------------------------
-- B. Switch on: today joins the deposit, spread joins the rows (I-ADDON-PLAN-SUM).
-------------------------------------------------------------------------------
DO $$
DECLARE
  v_mode text;
  v_attempt uuid;
  v_session uuid;
  v_plan jsonb;
  v_due bigint;
  v_bound jsonb;
  v_order uuid;
  v_rows bigint;
  v_addon bigint;
  v_tampered jsonb;
  v_raised text;
BEGIN
  FOREACH v_mode IN ARRAY ARRAY['today', 'spread'] LOOP
    v_attempt := CASE v_mode WHEN 'today' THEN '32815000-0000-4000-8500-0000000000b1'::uuid
                             ELSE '32815000-0000-4000-8500-0000000000b2'::uuid END;
    v_session := pg_temp.contract_session(v_attempt, v_mode || '@example.test');
    v_plan := public.issue_4522_checkout_v2_plan(v_session, pg_temp.plan_lines(v_mode));
    IF (v_plan->>'addOnsOnPlan')::boolean IS NOT TRUE OR (v_plan->>'extrasTotalCents')::bigint <> 60000
       OR v_plan->>'addonPaymentMode' <> v_mode
       OR (v_plan->>'dueTodayNetCents')::bigint <> 30000
       OR (v_plan->>'addonScheduledCents')::bigint <> (CASE v_mode WHEN 'spread' THEN 60000 ELSE 0 END)
       OR jsonb_array_length(v_plan->'installmentSchedule'->'installments') <> 3 THEN
      RAISE EXCEPTION 'B-1 % : the contract planner must plan the add-ons, got %', v_mode, v_plan;
    END IF;
    -- What the edge charges today: the deposit plus every add-on not on the rows.
    v_due := 30000 + 60000 - (v_plan->>'addonScheduledCents')::bigint;

    -- A schedule that moves money between rows is refused even when it sums.
    v_tampered := pg_temp.edge_schedule(v_plan, v_due);
    v_tampered := jsonb_set(jsonb_set(v_tampered, '{installments,0,amountCents}',
      to_jsonb((v_tampered#>>'{installments,0,amountCents}')::bigint + 100)),
      '{installments,1,amountCents}', to_jsonb((v_tampered#>>'{installments,1,amountCents}')::bigint - 100));
    v_raised := pg_temp.raised(format('SELECT pg_temp.bind(%L, %L, %L, %s, %L::jsonb)',
      v_session, v_attempt, v_mode, v_due, v_tampered));
    IF v_raised IS DISTINCT FROM 'P0001:checkout_quote_invalid' THEN
      RAISE EXCEPTION 'B-2 % : a moved row must be refused, got %', v_mode, v_raised;
    END IF;

    v_bound := pg_temp.bind(v_session, v_attempt, v_mode, v_due, pg_temp.edge_schedule(v_plan, v_due));
    IF v_bound->>'outcome' <> 'bound' OR (v_bound->>'totalCents')::bigint <> v_due
       OR (SELECT addon_payment_mode FROM public.ticket_checkout_sessions WHERE id = v_session) <> v_mode
       OR (SELECT payment_plan_terms->>'addon_payment_mode' FROM public.ticket_checkout_sessions WHERE id = v_session) <> v_mode
       OR (SELECT plan_choice FROM public.ticket_checkout_session_add_on_items WHERE checkout_session_id = v_session) <> v_mode THEN
      RAISE EXCEPTION 'B-3 % : the bind must freeze the choice, got %', v_mode, v_bound;
    END IF;

    UPDATE public.ticket_checkout_sessions SET stripe_payment_intent_id = 'pi_s5_' || v_mode WHERE id = v_session;
    v_order := (public.issue_1930_ticket_checkout_finalize_base(v_session, 'pi_s5_' || v_mode, 'ch_s5_' || v_mode, 'card',
      's5-test-pepper-0123456789abcdef0123456789ab', 'cus_s5', 'pm_s5', true)->>'orderId')::uuid;
    SELECT sum(amount_cents), sum(addon_portion_minor) INTO v_rows, v_addon
      FROM public.order_installments WHERE order_id = v_order;
    -- I-ADDON-PLAN-SUM: today's charge + every row = ticket net + add-ons.
    IF (SELECT total_cents FROM public.orders WHERE id = v_order) + v_rows <> 120000 + 60000
       OR v_addon <> (CASE v_mode WHEN 'spread' THEN 60000 ELSE 0 END)
       OR (SELECT addon_payment_mode FROM public.orders WHERE id = v_order) <> v_mode
       OR (SELECT plan_choice FROM public.order_add_on_line_items WHERE order_id = v_order) <> v_mode
       OR (SELECT parent_kind FROM public.order_add_on_line_items WHERE order_id = v_order) <> 'ticket_type' THEN
      RAISE EXCEPTION 'B-4 % : plan sum or stored choice wrong (rows %, add-on %)', v_mode, v_rows, v_addon;
    END IF;
  END LOOP;
END $$;

-------------------------------------------------------------------------------
-- C. Refunds per choice (I-ADDON-SPREAD-REFUND-UNCOLLECTED-FIRST, I-ADDON-REFUND-BOUNDED).
-------------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '32815000-0000-4000-8500-000000000001', false);
DO $$
DECLARE
  v_order uuid := (SELECT order_id FROM public.ticket_checkout_sessions WHERE buyer_email = 'spread@example.test');
  v_item uuid;
  v_line uuid;
  v_one jsonb;
  v_r jsonb;
  v_replay jsonb;
  v_raised text;
  v_door jsonb;
BEGIN
  SELECT id INTO v_item FROM public.order_add_on_line_items WHERE order_id = v_order;
  SELECT id INTO v_line FROM public.order_line_items WHERE order_id = v_order;
  v_one := jsonb_build_array(jsonb_build_object('order_add_on_line_item_id', v_item, 'quantity', 1));

  -- Every ticket back while add-on money is still on open rows: cancel instead.
  v_raised := pg_temp.raised(format('SELECT public.biz_refund_order(%L, %L::jsonb, %L, %L)', v_order,
    jsonb_build_array(jsonb_build_object('order_line_item_id', v_line, 'quantity', 1)),
    'Traveller cannot make it', 's5-all-tickets'));
  IF v_raised IS DISTINCT FROM 'P0001:add_on_plan_open_use_cancel' THEN
    RAISE EXCEPTION 'C-1 returning every ticket of an open spread plan must be refused, got %', v_raised;
  END IF;

  -- The preview: nothing collected yet, so the unit comes off the plan.
  v_r := public.refund_preview(v_order, v_one);
  IF (v_r->>'amount_cents')::bigint <> 0 OR (v_r->>'removed_from_plan_cents')::bigint <> 30000 THEN
    RAISE EXCEPTION 'C-2 the preview must show a plan removal and no money, got %', v_r;
  END IF;

  -- One unit, nothing collected: removed from the rows, no money moves.
  v_r := public.biz_refund_order(v_order, v_one, 'Transfer no longer needed', 's5-spread-1');
  IF (v_r->>'plan_removal_only')::boolean IS NOT TRUE OR (v_r->>'amount_cents')::bigint <> 0
     OR (v_r->>'removed_from_plan_cents')::bigint <> 30000 OR v_r->>'refund_id' IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.refunds WHERE order_id = v_order)
     OR (SELECT sum(addon_portion_minor) FROM public.order_installments
          WHERE order_id = v_order AND status IN ('scheduled', 'failed')) <> 30000
     OR (SELECT count(*) FROM public.order_balance_events WHERE order_id = v_order AND reason = 'addon_removed') <> 1
     OR (SELECT count(*) FROM public.order_add_on_plan_removals WHERE order_id = v_order) <> 1 THEN
    RAISE EXCEPTION 'C-3 a spread unit not yet collected comes off the plan, got %', v_r;
  END IF;
  -- I-ADDON-PLAN-SUM still holds after the removal (one add-on unit fewer).
  IF (SELECT total_cents FROM public.orders WHERE id = v_order)
     + (SELECT sum(amount_cents) FROM public.order_installments WHERE order_id = v_order AND status <> 'superseded')
     <> 120000 + 30000 THEN
    RAISE EXCEPTION 'C-4 the plan must still sum to ticket + remaining add-ons';
  END IF;

  -- Same key: the stored answer, never a second removal. Other body: refused.
  v_replay := public.biz_refund_order(v_order, v_one, 'Transfer no longer needed', 's5-spread-1');
  IF (v_replay->>'idempotent_replay')::boolean IS NOT TRUE
     OR (v_replay - 'idempotent_replay') IS DISTINCT FROM (v_r - 'idempotent_replay')
     OR (SELECT count(*) FROM public.order_add_on_plan_removals WHERE order_id = v_order) <> 1
     OR (SELECT count(*) FROM public.order_balance_events WHERE order_id = v_order AND reason = 'addon_removed') <> 1 THEN
    RAISE EXCEPTION 'C-5 a replay must not remove twice, got %', v_replay;
  END IF;
  v_raised := pg_temp.raised(format('SELECT public.biz_refund_order(%L, %L::jsonb, %L, %L)', v_order,
    jsonb_build_array(jsonb_build_object('order_add_on_line_item_id', v_item, 'quantity', 2)),
    'Transfer no longer needed', 's5-spread-1'));
  IF v_raised IS DISTINCT FROM '23505:idempotency_request_mismatch' THEN
    RAISE EXCEPTION 'C-6 same key, other body must be refused, got %', v_raised;
  END IF;

  -- The door owes one transfer now.
  v_door := public.issue_3281_door_order_extras('32815000-0000-4000-8500-000000000001',
    '32815000-0000-4000-8500-000000000003', ARRAY[v_order]);
  IF (v_door->v_order::text->0->>'quantity')::integer <> 1 THEN
    RAISE EXCEPTION 'C-7 the door must owe one transfer, got %', v_door;
  END IF;

  -- The first row is collected: the last unit is half on the plan, half paid.
  UPDATE public.order_installments SET status = 'collected', collected_at = now(),
         stripe_payment_intent_id = 'pi_s5_row1', stripe_charge_id = 'ch_s5_row1'
   WHERE id = (SELECT id FROM public.order_installments WHERE order_id = v_order
                AND status = 'scheduled' ORDER BY due_at, id LIMIT 1);
  v_r := public.biz_refund_order(v_order, v_one, 'Transfer no longer needed', 's5-spread-2');
  IF (v_r->>'amount_cents')::bigint <> 30000 - (SELECT removed_minor FROM public.order_add_on_plan_removals
                                                 WHERE idempotency_key = 's5-spread-2')
     OR (v_r->>'amount_cents')::bigint <= 0
     OR (SELECT quantity FROM public.order_add_on_plan_removals WHERE idempotency_key = 's5-spread-2') <> 0
     OR (SELECT refund_id FROM public.order_add_on_plan_removals WHERE idempotency_key = 's5-spread-2')
        IS DISTINCT FROM (v_r->>'refund_id')::uuid
     OR (SELECT amount_cents FROM public.refund_add_on_line_items WHERE refund_id = (v_r->>'refund_id')::uuid)
        <> (v_r->>'amount_cents')::integer
     OR (SELECT sum(addon_portion_minor) FROM public.order_installments
          WHERE order_id = v_order AND status IN ('scheduled', 'failed')) <> 0 THEN
    RAISE EXCEPTION 'C-8 a part-paid spread unit refunds only what was collected, got %', v_r;
  END IF;
  -- I-ADDON-REFUND-BOUNDED: money + removals = the line, and nothing is left.
  IF (SELECT sum(amount_cents) FROM public.refund_add_on_line_items WHERE order_add_on_line_item_id = v_item)
     + public.issue_3281_add_on_removed_cents(v_item) <> 60000 THEN
    RAISE EXCEPTION 'C-9 the spread line must be back exactly once';
  END IF;
  v_raised := pg_temp.raised(format('SELECT public.biz_refund_order(%L, %L::jsonb, %L, %L)', v_order, v_one,
    'Transfer no longer needed', 's5-spread-3'));
  IF v_raised NOT LIKE 'P0005:add_on_line_overrefund%' THEN
    RAISE EXCEPTION 'C-10 a third unit must be refused, got %', v_raised;
  END IF;
  IF public.issue_3281_door_order_extras('32815000-0000-4000-8500-000000000001',
       '32815000-0000-4000-8500-000000000003', ARRAY[v_order]) ? v_order::text THEN
    RAISE EXCEPTION 'C-11 the door owes nothing once both units are back';
  END IF;
  -- The admin order view: the choice, and what came off the plan.
  INSERT INTO public.admin_users(email, status) VALUES ('s5-owner@example.test', 'active');
  v_r := public.admin_order_add_on_lines(v_order)->0;
  DELETE FROM public.admin_users WHERE email = 's5-owner@example.test';
  IF v_r->>'plan_choice' IS DISTINCT FROM 'spread' OR (v_r->>'removed_quantity')::integer <> 1
     OR (v_r->>'removed_cents')::bigint <> 60000 - (v_r->>'refunded_cents')::bigint
     OR (v_r->>'refunded_quantity')::integer <> 1 THEN
    RAISE EXCEPTION 'C-12 the admin view must show the spread line and its plan removals, got %', v_r;
  END IF;
END $$;

DO $$
DECLARE
  v_order uuid := (SELECT order_id FROM public.ticket_checkout_sessions WHERE buyer_email = 'today@example.test');
  v_one jsonb;
  v_r jsonb;
BEGIN
  v_one := jsonb_build_array(jsonb_build_object('order_add_on_line_item_id',
    (SELECT id FROM public.order_add_on_line_items WHERE order_id = v_order), 'quantity', 1));
  -- A today add-on was paid with the deposit: an ordinary refund, no removal.
  v_r := public.refund_preview(v_order, v_one);
  IF (v_r->>'amount_cents')::bigint <> 30000 OR v_r ? 'removed_from_plan_cents' THEN
    RAISE EXCEPTION 'D-1 a today add-on previews as an ordinary refund, got %', v_r;
  END IF;
  v_r := public.biz_refund_order(v_order, v_one, 'Transfer no longer needed', 's5-today-1');
  IF (v_r->>'amount_cents')::bigint <> 30000 OR v_r ? 'plan_removal_only'
     OR EXISTS (SELECT 1 FROM public.order_add_on_plan_removals WHERE order_id = v_order)
     OR (SELECT sum(addon_portion_minor) FROM public.order_installments WHERE order_id = v_order) <> 0 THEN
    RAISE EXCEPTION 'D-2 a today add-on refunds from the deposit charge, got %', v_r;
  END IF;
END $$;

-------------------------------------------------------------------------------
-- E. S1 deferrals.
-------------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid := '32815000-0000-4000-8500-000000000003';
  v_shuttle uuid := '32815000-0000-4000-8500-000000000022';
  v_s jsonb;
  v_session uuid;
  v_order uuid;
BEGIN
  -- finalize copies the parent the session held an add-on with.
  v_s := public.biz_ticket_checkout_create_session(v_event, NULL, 'Buyer', 'parent@example.test', '+15555550912', false,
    '[{"ticketTypeId":"32815000-0000-4000-8500-000000000012","quantity":1}]',
    'ticket_checkout:' || v_event::text || ':s5-parent', now() + interval '15 minutes', 0, 'full',
    NULL, NULL, NULL, NULL, NULL, NULL);
  v_session := (v_s->>'checkoutSessionId')::uuid;
  INSERT INTO public.ticket_checkout_session_add_on_items(checkout_session_id, ticket_add_on_id, ticket_type_id,
    add_on_name_at_purchase, ticket_type_name_at_purchase, quantity, unit_price_cents, total_cents, parent_kind)
  VALUES (v_session, '32815000-0000-4000-8500-000000000021', NULL, 'Airport transfer', 'RSVP', 1, 0, 0, 'rsvp');
  v_order := (public.issue_1930_ticket_checkout_finalize_base(v_session, 'pi_s5_parent', 'ch_s5_parent', 'card',
    's5-test-pepper-0123456789abcdef0123456789ab')->>'orderId')::uuid;
  IF (SELECT parent_kind FROM public.order_add_on_line_items WHERE order_id = v_order) <> 'rsvp' THEN
    RAISE EXCEPTION 'E-1 finalize must copy parent_kind';
  END IF;

  -- One add-on held with two tickets is one stock count (multi-link on).
  UPDATE public.add_on_rollout SET multi_link_enabled = true;
  INSERT INTO public.ticket_add_ons(id, event_id, name, price_cents, quantity_total, is_unlimited, max_per_ticket)
  VALUES (v_shuttle, v_event, 'Shuttle', 1000, 3, false, 1);
  INSERT INTO public.ticket_add_on_links(add_on_id, event_id, target_kind, ticket_type_id) VALUES
    (v_shuttle, v_event, 'ticket_type', '32815000-0000-4000-8500-000000000011'),
    (v_shuttle, v_event, 'ticket_type', '32815000-0000-4000-8500-000000000012');
  v_s := public.biz_ticket_checkout_create_session(v_event, NULL, 'Buyer', 'shuttle@example.test', '+15555550913', false,
    '[{"ticketTypeId":"32815000-0000-4000-8500-000000000011","quantity":1,"addOns":[{"addOnId":"32815000-0000-4000-8500-000000000022","quantity":1}]},
      {"ticketTypeId":"32815000-0000-4000-8500-000000000012","quantity":1,"addOns":[{"addOnId":"32815000-0000-4000-8500-000000000022","quantity":1}]}]',
    'ticket_checkout:' || v_event::text || ':s5-shuttle', now() + interval '15 minutes', 0, 'full',
    NULL, NULL, NULL, NULL, NULL, NULL);
  v_session := (v_s->>'checkoutSessionId')::uuid;
  IF (SELECT count(*) FROM public.ticket_checkout_session_add_on_items WHERE checkout_session_id = v_session) <> 2
     OR NOT public.issue_1930_ticket_session_authorized(v_session, v_event) THEN
    RAISE EXCEPTION 'E-2 two holds of one add-on within stock are authorized';
  END IF;
  UPDATE public.ticket_add_ons SET quantity_total = 1 WHERE id = v_shuttle;
  IF public.issue_1930_ticket_session_authorized(v_session, v_event) THEN
    RAISE EXCEPTION 'E-3 two holds of one add-on are summed against its stock';
  END IF;
END $$;

SELECT set_config('request.jwt.claim.sub', '', false);
DO $$
DECLARE
  v_event uuid := '32815000-0000-4000-8500-000000000031';
  v_ticket uuid := '32815000-0000-4000-8500-000000000032';
  v_tote uuid := '32815000-0000-4000-8500-000000000033';
  v_bag uuid;
BEGIN
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency)
  VALUES(v_event,'32815000-0000-4000-8500-000000000002','32815000-0000-4000-8500-000000000001',
    'S5 days','s5-days-3281','event','scheduled','public','UTC','USD');
  INSERT INTO public.event_dates(id,event_id,start_at,end_at,timezone,is_master,occurrence_key) VALUES
    ('32815000-0000-4000-8500-000000000034',v_event,now()+interval '10 days',now()+interval '10 days 2 hours','UTC',true,'d1'),
    ('32815000-0000-4000-8500-000000000035',v_event,now()+interval '11 days',now()+interval '11 days 2 hours','UTC',false,'d2');
  INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person)
  VALUES (v_ticket,v_event,'Pass',1000,'USD',false,10,false,1,5,true,false);
  -- An add-on known only through its link (no ticket_type_id), as after S8.
  INSERT INTO public.ticket_add_ons(id, event_id, name, price_cents, quantity_total, is_unlimited, max_per_ticket, valid_occurrence_keys)
  VALUES (v_tote, v_event, 'Tote', 500, NULL, true, 1, ARRAY['d1','d2']);
  INSERT INTO public.ticket_add_on_links(add_on_id, event_id, target_kind, ticket_type_id)
  VALUES (v_tote, v_event, 'ticket_type', v_ticket);
  UPDATE public.event_dates SET occurrence_key = 'd3' WHERE id = '32815000-0000-4000-8500-000000000035';
  PERFORM public.issue_3281_strip_removed_days(v_event);
  IF (SELECT valid_occurrence_keys FROM public.ticket_add_ons WHERE id = v_tote) IS DISTINCT FROM ARRAY['d1'] THEN
    RAISE EXCEPTION 'E-4 a removed day comes off a link-only add-on, got %',
      (SELECT valid_occurrence_keys FROM public.ticket_add_ons WHERE id = v_tote);
  END IF;

  -- publish writes the owner and the link itself: without the TRANSITIONAL
  -- bridge (as after S8) a published extra still belongs to its offering.
  ALTER TABLE public.ticket_add_ons DISABLE TRIGGER tg_3281_add_on_legacy_ticket_bridge_before;
  ALTER TABLE public.ticket_add_ons DISABLE TRIGGER tg_3281_add_on_legacy_ticket_bridge_after;
  PERFORM public.issue_3281_publish_tier_extras(v_ticket,
    '{"isFree":false,"extras":[{"id":"bag","name":"Bag","priceGbp":5,"isUnlimited":true,"maxPerTicket":1}]}',
    'single', '[]'::jsonb, NULL);
  ALTER TABLE public.ticket_add_ons ENABLE TRIGGER tg_3281_add_on_legacy_ticket_bridge_before;
  ALTER TABLE public.ticket_add_ons ENABLE TRIGGER tg_3281_add_on_legacy_ticket_bridge_after;
  SELECT id INTO v_bag FROM public.ticket_add_ons WHERE event_id = v_event AND name = 'Bag';
  IF v_bag IS NULL OR NOT EXISTS (SELECT 1 FROM public.ticket_add_on_links
                                   WHERE add_on_id = v_bag AND ticket_type_id = v_ticket AND target_kind = 'ticket_type') THEN
    RAISE EXCEPTION 'E-5 publish must write the owner and the link';
  END IF;
END $$;

-------------------------------------------------------------------------------
-- F. Access: the ledger and every new function are service_role only.
-------------------------------------------------------------------------------
DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.order_add_on_plan_removals', 'SELECT')
     OR has_table_privilege('anon', 'public.order_add_on_plan_removals', 'SELECT')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.order_add_on_plan_removals'::regclass)
     OR has_function_privilege('authenticated', 'public.issue_3281_apply_plan_removals(uuid,jsonb,uuid,text,uuid,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3281_add_on_plan_split(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3281_add_on_removed_qty(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3281_order_has_open_spread(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.biz_refund_order(uuid,jsonb,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_4522_checkout_v2_plan(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'F-1 grants are wrong';
  END IF;
END $$;

ROLLBACK;
