-- #4522 X-2: a v2 trip plan bought on buyer web (the #3859 contract path) freezes its plan terms with or without add-ons.
-- MINGLA-INVARIANT: I-4522-CONTRACT-PLAN-TERMS | issue #4522 | Every order finalized on a v2 plan through the buyer-web contract path carries v2 plan terms (v 2, deposit, flexible settings), whether or not add-ons ride the plan, in USD and NGN, with the add-on switches off or on.
--
-- The buyer-web path, call for call (supabase/functions/ticket-checkout-create):
-- quote (issue_3872_ticket_quote) -> session created paying in full
-- (biz_ticket_checkout_create_session, choice 'full') -> the database's plan
-- for the session (issue_4522_checkout_v2_plan) -> the schedule the edge builds
-- from it -> issue_3859_bind_checkout_contract -> the real finalize
-- (issue_1930_ticket_checkout_finalize_base) -> the order, its rows and the
-- balance the balance page reads (issue_4522_balance). Earlier suites created
-- plan sessions with choice 'installments' (the legacy path, which writes the
-- terms at create) and never bound a no-add-on v2 contract session.
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION public.issue_4522_plan_v2_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$ SELECT true $fn$;
CREATE OR REPLACE FUNCTION public.issue_3645_paystack_installments_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$ SELECT true $fn$;

-- Two trips 200 days out: a v2 package (USD 1,200 / NGN 1,200,000; 25%
-- deposit, 3 payments, last 30 days before departure, any amount allowed with a
-- smallest payment of USD 90 / NGN 90,000) and a USD 45 / NGN 45,000 add-on.
CREATE FUNCTION pg_temp.fixture(p_n integer, p_currency text, p_provider text, p_tz text) RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE
  v_owner uuid := ('45220000-0000-4000-8c00-00000000000' || p_n)::uuid;
  v_brand uuid := ('45220000-0000-4000-8c01-00000000000' || p_n)::uuid;
  v_event uuid := ('45220000-0000-4000-8c02-00000000000' || p_n)::uuid;
  v_tt uuid := ('45220000-0000-4000-8c03-00000000000' || p_n)::uuid;
  v_addon uuid := ('45220000-0000-4000-8c04-00000000000' || p_n)::uuid;
  v_major bigint := (CASE p_n WHEN 2 THEN 100000 ELSE 100 END); -- NGN: thousands of naira
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'x2-owner-' || p_n || '@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'x2-owner-' || p_n || '@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country,
    pricing_region, pricing_currency)
  VALUES (v_brand, v_owner, 'X2 brand ' || p_n, 'x2-brand-4522-' || p_n, p_currency, p_provider,
    CASE p_currency WHEN 'NGN' THEN 'NG' ELSE 'US' END, CASE p_currency WHEN 'NGN' THEN 'NG' ELSE 'US' END, p_currency);
  IF p_provider = 'stripe' THEN
    INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, charges_enabled, payouts_enabled, country, default_currency)
    VALUES (v_brand, 'acct_x2_' || p_n, true, true, 'US', lower(p_currency));
  END IF;
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency, refund_policy)
  VALUES (v_event, v_brand, v_owner, 'X2 trip ' || p_n, 'x2-trip-4522-' || p_n, 'trip', 'scheduled', 'public', p_tz, p_currency,
    '{"kind":"standard","tiers":[{"days_before_start":30,"refund_pct":100}],"deposit_non_refundable":true}'::jsonb);
  -- A trip date is its stored calendar date (UTC midnight, #4420).
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_event, date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '200 days',
    date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '204 days 23 hours 59 minutes', p_tz, true);
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total, is_unlimited,
    min_purchase_qty, max_purchase_qty, available_online, available_in_person)
  VALUES (v_tt, v_event, 'Plan package', 1200 * v_major, p_currency, false, 50, false, 1, 10, true, false);
  INSERT INTO public.trip_pricing_tiers(event_id, ticket_type_id, tier_name, tier_metadata)
  VALUES (v_event, v_tt, 'Plan package', jsonb_build_object('payment_plan', jsonb_build_object(
    'v', 2, 'deposit', jsonb_build_object('mode', 'percent', 'pct', 25), 'count', 3,
    'final_due_days_before_start', 30, 'auto_adjust', true,
    'flex', jsonb_build_object('enabled', true, 'min_payment_minor', 90 * v_major))));
  INSERT INTO public.ticket_add_ons(id, ticket_type_id, name, price_cents, quantity_total, is_unlimited, max_per_ticket)
  VALUES (v_addon, v_tt, 'Airport transfer', 45 * v_major, NULL, true, 2);
END $f$;
SELECT pg_temp.fixture(1, 'USD', 'stripe', 'America/New_York');
SELECT pg_temp.fixture(2, 'NGN', 'paystack', 'Africa/Lagos');

-- The cart lines as buyer web sends them (one traveler, plan chosen).
CREATE FUNCTION pg_temp.lines(p_n integer, p_mode text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object(
      'ticketTypeId', ('45220000-0000-4000-8c03-00000000000' || p_n)::uuid, 'quantity', 1,
      'paymentPlanChoice', 'installments')
    || CASE WHEN p_mode IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
         'addOns', jsonb_build_array(jsonb_build_object(
           'addOnId', ('45220000-0000-4000-8c04-00000000000' || p_n)::uuid, 'quantity', 1)),
         'addonPaymentMode', p_mode) END)
$$;

-- One buyer-web checkout through every server step. p_mode: NULL (no add-on),
-- 'today' or 'spread'. Returns the outcome: 'order:<id>' or 'refused:<why>'.
CREATE FUNCTION pg_temp.buy(p_n integer, p_mode text, p_tag text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE
  v_event uuid := ('45220000-0000-4000-8c02-00000000000' || p_n)::uuid;
  v_attempt uuid := gen_random_uuid();
  v_key text;
  v_lines jsonb := pg_temp.lines(p_n, p_mode);
  v_q jsonb;
  v_s jsonb;
  v_session uuid;
  v_plan jsonb;
  v_extras bigint;
  v_on_plan boolean;
  v_addon_sched bigint;
  v_due bigint;
  v_full bigint;
  v_schedule jsonb;
  v_paystack boolean := p_n = 2;
  v_pi text := CASE WHEN p_n = 2 THEN 'x2ref' || replace(v_attempt::text, '-', '') ELSE 'pi_x2' || replace(v_attempt::text, '-', '') END;
BEGIN
  v_key := 'ticket_checkout:v2:' || v_event::text || ':' || v_attempt::text;
  -- 1. The quote the Review & pay screen shows.
  BEGIN
    v_q := public.issue_3872_ticket_quote(v_event, v_lines, NULL, NULL, NULL, NULL, 'installments', NULL,
      p_tag || '@example.test', '+15555550977', NULL, NULL, false);
  EXCEPTION WHEN OTHERS THEN
    RETURN 'refused:' || SQLERRM;
  END;
  IF (v_q#>>'{installmentSchedule,planVersion}') IS DISTINCT FROM '2' THEN
    RETURN 'refused:quote_not_v2 ' || v_q::text;
  END IF;
  -- 2. The contract session is created paying in full (the edge's choice on v2).
  v_s := public.biz_ticket_checkout_create_session(v_event, NULL, 'Buyer ' || p_tag, p_tag || '@example.test',
    '+15555550977', false, v_lines, v_key, now() + interval '15 minutes', 0, 'full',
    NULL, NULL, NULL, NULL, NULL, NULL);
  v_session := (v_s->>'checkoutSessionId')::uuid;
  -- 3. The database plans the session (issue_4522_checkout_v2_plan).
  v_plan := public.issue_4522_checkout_v2_plan(v_session, v_lines);
  -- 4. The schedule the edge builds from that plan (index.ts, contract path).
  SELECT COALESCE(sum(total_cents), 0) INTO v_extras
    FROM public.ticket_checkout_session_add_on_items WHERE checkout_session_id = v_session;
  v_on_plan := COALESCE((v_plan->>'addOnsOnPlan')::boolean, false);
  IF v_extras > 0 AND NOT v_on_plan
     AND jsonb_array_length(COALESCE(v_plan#>'{installmentSchedule,installments}', '[]'::jsonb)) > 0 THEN
    RETURN 'refused:extras_not_on_installments';
  END IF;
  v_addon_sched := CASE WHEN v_on_plan THEN (v_plan->>'addonScheduledCents')::bigint ELSE 0 END;
  v_due := (v_plan->>'dueTodayNetCents')::bigint + v_extras - v_addon_sched;
  SELECT COALESCE(sum(total_cents), 0) + v_extras INTO v_full
    FROM public.ticket_checkout_session_items WHERE checkout_session_id = v_session;
  v_schedule := jsonb_build_object(
    'fullPriceCents', v_full,
    'depositCents', CASE WHEN v_on_plan THEN v_due ELSE (v_plan->>'dueTodayNetCents')::bigint END,
    'currency', trim((SELECT currency FROM public.events WHERE id = v_event)),
    'installments', (SELECT jsonb_agg(jsonb_build_object(
        'ordinal', (e->>'ordinal')::integer, 'amountCents', (e->>'amountCents')::bigint,
        'pct', (e->>'pct')::numeric, 'dueAt', e->>'dueAt', 'sourceTicketTypeId', e->>'sourceTicketTypeId',
        'sourceOrdinal', (e->>'ordinal')::integer, 'addonPortionCents', (e->>'addonPortionCents')::bigint)
        ORDER BY (e->>'ordinal')::integer)
        FROM jsonb_array_elements(v_plan#>'{installmentSchedule,installments}') e),
    'planVersion', 2, 'availability', v_plan->'availability', 'countOffered', v_plan->'countOffered',
    'countGiven', v_plan->'countGiven', 'finalDueAt', v_plan->'finalDueAt');
  -- 5. Bind.
  PERFORM public.issue_3859_bind_checkout_contract(v_session, v_event, v_key, v_attempt, repeat('b', 64),
    v_lines, v_due::integer, v_full::integer, v_schedule);
  -- 6. The provider paid (fake ids), then the real finalize.
  UPDATE public.ticket_checkout_sessions SET stripe_payment_intent_id = v_pi WHERE id = v_session;
  RETURN 'order:' || (public.issue_1930_ticket_checkout_finalize_base(v_session, v_pi,
    CASE WHEN v_paystack THEN '4522' || (floor(random() * 1000000))::bigint::text ELSE 'ch_x2' || p_tag END,
    'card', 'x2-test-pepper-0123456789abcdef0123456789ab',
    CASE WHEN v_paystack THEN NULL ELSE 'cus_x2' END, CASE WHEN v_paystack THEN NULL ELSE 'pm_x2' END, true)->>'orderId');
END $f$;

-- Every v2 fact an order must carry, whatever rode the plan.
CREATE FUNCTION pg_temp.assert_v2(p_label text, p_order uuid, p_n integer, p_mode text) RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE
  v_o public.orders;
  v_b jsonb;
  v_major bigint := (CASE p_n WHEN 2 THEN 100000 ELSE 100 END); -- NGN: thousands of naira
  v_rows bigint;
  v_today bigint;
BEGIN
  SELECT * INTO v_o FROM public.orders WHERE id = p_order;
  v_b := public.issue_4522_balance(p_order);
  SELECT COALESCE(sum(amount_cents), 0) INTO v_rows FROM public.order_installments WHERE order_id = p_order;
  v_today := CASE p_mode WHEN 'today' THEN (300 + 45) * v_major ELSE 300 * v_major END;
  IF v_o.payment_plan_terms IS NULL
     OR (v_o.payment_plan_terms->>'v') IS DISTINCT FROM '2'
     -- the package deposit; a today add-on is charged with it but is not deposit
     OR (v_o.payment_plan_terms->>'deposit_minor')::bigint IS DISTINCT FROM 300 * v_major
     OR (v_o.payment_plan_terms->>'flex_enabled') IS DISTINCT FROM 'true'
     OR (v_o.payment_plan_terms->>'min_payment_minor')::bigint IS DISTINCT FROM 90 * v_major
     OR (v_o.payment_plan_terms->>'count_given') IS DISTINCT FROM '3'
     OR (v_o.payment_plan_terms->>'deposit_non_refundable') IS DISTINCT FROM 'true'
     OR (v_o.payment_plan_terms->>'time_zone') IS DISTINCT FROM (CASE p_n WHEN 1 THEN 'America/New_York' ELSE 'Africa/Lagos' END)
     OR v_o.addon_payment_mode IS DISTINCT FROM p_mode
     OR v_o.installment_plan_root IS NOT TRUE
     OR v_o.total_cents <> v_today THEN
    RAISE EXCEPTION '% : the order must carry the v2 terms, got terms % mode % total %',
      p_label, v_o.payment_plan_terms, v_o.addon_payment_mode, v_o.total_cents;
  END IF;
  IF (SELECT count(*) FROM public.order_installments
       WHERE order_id = p_order AND kind = 'scheduled' AND schedule_version = 0 AND status = 'scheduled'
         AND ticket_type_id = ('45220000-0000-4000-8c03-00000000000' || p_n)::uuid
         AND provider = (CASE p_n WHEN 1 THEN 'stripe' ELSE 'paystack' END)) <> 3
     OR v_today + v_rows <> (1200 + (CASE WHEN p_mode IS NULL THEN 0 ELSE 45 END)) * v_major
     OR (SELECT sum(addon_portion_minor) FROM public.order_installments WHERE order_id = p_order)
        <> (CASE p_mode WHEN 'spread' THEN 45 * v_major ELSE 0 END) THEN
    RAISE EXCEPTION '% : the rows must be three v2 scheduled rows that conserve money (rows %)', p_label, v_rows;
  END IF;
  -- The balance page's read: the balance, and "pay any amount" as the host set it.
  IF v_b IS NULL OR (v_b->>'remainingMinor')::bigint <> v_rows
     OR (v_b->>'canPayAnyAmount')::boolean IS NOT TRUE
     OR (v_b->>'minPaymentMinor')::bigint <> 90 * v_major
     OR (v_b->'terms'->>'v') IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION '% : the balance must be payable as a v2 plan, got %', p_label, v_b;
  END IF;
END $f$;

-------------------------------------------------------------------------------
-- A. Add-on switches OFF (the shipping default): the plan without an add-on is a
--    v2 order; an add-on cannot ride the plan, so that cart is refused, as before.
-------------------------------------------------------------------------------
UPDATE public.add_on_rollout SET multi_link_enabled = false, free_parent_enabled = false,
  plan_enabled = false, rsvp_enabled = false;
DO $$
DECLARE v_n integer; v_out text; v_mode text;
BEGIN
  FOREACH v_n IN ARRAY ARRAY[1, 2] LOOP
    v_out := pg_temp.buy(v_n, NULL, 'off-none-' || v_n);
    IF v_out NOT LIKE 'order:%' THEN RAISE EXCEPTION 'A-1 % no add-on: expected an order, got %', v_n, v_out; END IF;
    PERFORM pg_temp.assert_v2('A-1 ' || v_n || ' no add-on, switches off', substr(v_out, 7)::uuid, v_n, NULL);
    FOREACH v_mode IN ARRAY ARRAY['today', 'spread'] LOOP
      v_out := pg_temp.buy(v_n, v_mode, 'off-' || v_mode || '-' || v_n);
      IF v_out IS DISTINCT FROM 'refused:extras_not_on_installments' THEN
        RAISE EXCEPTION 'A-2 % % switches off: add-ons cannot ride a plan, got %', v_n, v_mode, v_out;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-------------------------------------------------------------------------------
-- B. Add-on switches ON: no add-on, add-on paid today, add-on spread over the
--    plan, in USD and NGN: every order is a v2 order.
-------------------------------------------------------------------------------
UPDATE public.add_on_rollout SET multi_link_enabled = true, free_parent_enabled = true,
  plan_enabled = true, rsvp_enabled = true;
DO $$
DECLARE v_n integer; v_out text; v_mode text;
BEGIN
  FOREACH v_n IN ARRAY ARRAY[1, 2] LOOP
    FOREACH v_mode IN ARRAY ARRAY['none', 'today', 'spread'] LOOP
      v_out := pg_temp.buy(v_n, NULLIF(v_mode, 'none'), 'on-' || v_mode || '-' || v_n);
      IF v_out NOT LIKE 'order:%' THEN RAISE EXCEPTION 'B-1 % %: expected an order, got %', v_n, v_mode, v_out; END IF;
      PERFORM pg_temp.assert_v2('B-1 ' || v_n || ' ' || v_mode || ', switches on', substr(v_out, 7)::uuid, v_n,
        NULLIF(v_mode, 'none'));
    END LOOP;
  END LOOP;
END $$;

-------------------------------------------------------------------------------
-- C. The bind trusts only the database's plan: a no-add-on v2 schedule that
--    moves money between rows, or claims v2 for a cart the database does not
--    plan as v2, is refused and nothing is frozen.
-------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.raised(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;
DO $$
DECLARE
  v_event uuid := '45220000-0000-4000-8c02-000000000001';
  v_attempt uuid := gen_random_uuid();
  v_key text := 'ticket_checkout:v2:45220000-0000-4000-8c02-000000000001:' || v_attempt::text;
  v_lines jsonb := pg_temp.lines(1, NULL);
  v_session uuid;
  v_plan jsonb;
  v_sched jsonb;
  v_raised text;
BEGIN
  v_session := (public.biz_ticket_checkout_create_session(v_event, NULL, 'Buyer C', 'c@example.test',
    '+15555550977', false, v_lines, v_key, now() + interval '15 minutes', 0, 'full',
    NULL, NULL, NULL, NULL, NULL, NULL)->>'checkoutSessionId')::uuid;
  v_plan := public.issue_4522_checkout_v2_plan(v_session, v_lines);
  v_sched := jsonb_build_object('fullPriceCents', 120000, 'depositCents', 30000, 'currency', 'USD',
    'installments', v_plan#>'{installmentSchedule,installments}', 'planVersion', 2);
  v_sched := jsonb_set(jsonb_set(v_sched, '{installments,0,amountCents}', '30100'),
    '{installments,1,amountCents}', '29900');
  v_raised := pg_temp.raised(format('SELECT public.issue_3859_bind_checkout_contract(%L, %L, %L, %L, %L, %L::jsonb, 30000, 120000, %L::jsonb)',
    v_session, v_event, v_key, v_attempt, repeat('c', 64), v_lines, v_sched));
  IF v_raised IS DISTINCT FROM 'P0001:checkout_quote_invalid'
     OR (SELECT payment_plan_terms FROM public.ticket_checkout_sessions WHERE id = v_session) IS NOT NULL
     OR (SELECT checkout_contract_version FROM public.ticket_checkout_sessions WHERE id = v_session) IS NOT NULL THEN
    RAISE EXCEPTION 'C-1 a moved no-add-on row must be refused before anything is frozen, got %', v_raised;
  END IF;
  -- Pay in full on the same cart: no schedule, no terms (unchanged).
  PERFORM public.issue_3859_bind_checkout_contract(v_session, v_event, v_key, v_attempt, repeat('c', 64),
    jsonb_set(v_lines, '{0,paymentPlanChoice}', '"full"'), 120000, 120000, NULL);
  IF (SELECT payment_plan_terms FROM public.ticket_checkout_sessions WHERE id = v_session) IS NOT NULL THEN
    RAISE EXCEPTION 'C-2 a pay-in-full contract session carries no plan terms';
  END IF;
END $$;

-- D. E-3: a changed cart closes the checkout it was handed. The old session is
--    revoked under finalize's locks, queued for the revocation worker and
--    audited once; a payment that still lands on it finalizes into the
--    existing reversal, never a second order. Token-proved; a paid one stays.
DO $$
DECLARE
  v_event uuid := '45220000-0000-4000-8c02-000000000001';
  v_lines jsonb := pg_temp.lines(1, NULL);
  v_session uuid;
  v_paid uuid;
  v_r jsonb;
  v_orders_before bigint;
BEGIN
  v_session := (public.biz_ticket_checkout_create_session(v_event, NULL, 'Buyer D', 'd@example.test',
    '+15555550978', false, v_lines, 'ticket_checkout:v2:e3:' || gen_random_uuid()::text,
    now() + interval '15 minutes', 0, 'full', NULL, NULL, NULL, NULL, NULL, NULL)->>'checkoutSessionId')::uuid;
  UPDATE public.ticket_checkout_sessions
     SET buyer_status_token_hash = encode(sha256('tok-d'::bytea), 'hex'), status = 'awaiting_web_redirect'
   WHERE id = v_session;
  -- Someone else's token changes nothing.
  v_r := public.issue_4522_supersede_checkout_session(v_session, v_event, encode(sha256('other'::bytea), 'hex'));
  IF v_r->>'outcome' <> 'not_found'
     OR (SELECT revoked_at FROM public.ticket_checkout_sessions WHERE id = v_session) IS NOT NULL THEN
    RAISE EXCEPTION 'D-1 a wrong token must change nothing: %', v_r;
  END IF;
  v_r := public.issue_4522_supersede_checkout_session(v_session, v_event, encode(sha256('tok-d'::bytea), 'hex'));
  IF v_r->>'outcome' <> 'superseded'
     OR NOT EXISTS (SELECT 1 FROM public.ticket_checkout_sessions WHERE id = v_session
                     AND revoked_at IS NOT NULL AND revoked_reason = 'superseded_by_new_checkout'
                     AND status = 'failed' AND reversal_state = 'neutralization_pending'
                     AND idempotency_key LIKE '%:revoked:' || v_session::text)
     OR (SELECT count(*) FROM public.checkout_sale_revocation_outbox
          WHERE subject_id = v_session AND reason = 'superseded_by_new_checkout' AND state = 'queued') <> 1
     OR (SELECT count(*) FROM public.audit_log
          WHERE target_id = v_session::text AND action = 'ticket_checkout.superseded') <> 1 THEN
    RAISE EXCEPTION 'D-2 the held session must be revoked, queued and audited once: %', v_r;
  END IF;
  -- Again: nothing more (one audit, one outbox row).
  v_r := public.issue_4522_supersede_checkout_session(v_session, v_event, encode(sha256('tok-d'::bytea), 'hex'));
  IF v_r->>'outcome' <> 'closed'
     OR (SELECT count(*) FROM public.audit_log WHERE target_id = v_session::text AND action = 'ticket_checkout.superseded') <> 1 THEN
    RAISE EXCEPTION 'D-3 a second close changes nothing: %', v_r;
  END IF;
  -- The old page is paid anyway: the real finalize reverses it, no order.
  SELECT count(*) INTO v_orders_before FROM public.orders WHERE event_id = v_event;
  v_r := public.biz_ticket_checkout_finalize(v_session, 'pi_e3late', 'ch_e3late', 'card',
    'x2-test-pepper-0123456789abcdef0123456789ab', 'cus_e3', 'pm_e3', false);
  IF v_r->>'outcome' <> 'paid_reversal_pending'
     OR (SELECT order_id FROM public.ticket_checkout_sessions WHERE id = v_session) IS NOT NULL
     OR (SELECT count(*) FROM public.orders WHERE event_id = v_event) <> v_orders_before THEN
    RAISE EXCEPTION 'D-4 a late payment on a superseded checkout is reversed, never an order: %', v_r;
  END IF;
  -- A checkout that was already paid is never closed.
  v_paid := (regexp_replace(pg_temp.buy(1, NULL, 'd2'), '^order:', ''))::uuid;
  SELECT id INTO v_session FROM public.ticket_checkout_sessions WHERE order_id = v_paid;
  UPDATE public.ticket_checkout_sessions SET buyer_status_token_hash = encode(sha256('tok-d2'::bytea), 'hex')
   WHERE id = v_session;
  v_r := public.issue_4522_supersede_checkout_session(v_session, v_event, encode(sha256('tok-d2'::bytea), 'hex'));
  IF v_r->>'outcome' <> 'paid' OR (v_r->>'orderId')::uuid <> v_paid
     OR (SELECT revoked_at FROM public.ticket_checkout_sessions WHERE id = v_session) IS NOT NULL THEN
    RAISE EXCEPTION 'D-5 a paid checkout answers paid and stays: %', v_r;
  END IF;
END $$;

ROLLBACK;
