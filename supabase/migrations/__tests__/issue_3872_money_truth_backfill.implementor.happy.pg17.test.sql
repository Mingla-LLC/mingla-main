-- Issue #3872 PR 1 (money truth) — the operator backfill reconciles existing
-- orders from the provider's own stored records (PG17).
--
-- Fixtures mirror the production shapes found on 19 Oct 2026:
--   A hosted Stripe order on an event passing both fees: total_cents 3000, the
--     stored checkout.session.completed / payment_intent.succeeded /
--     charge.succeeded payloads say 3135 (production order 6d25e937).
--   B Paystack order passing both fees: total_cents and charge.success both
--     6270000 over 6000000 of lines (production order f7595318).
--   C native Stripe order with a pricing_breakdown (production order 7f577d38).
--   D free order.
--   E Stripe order with no stored provider record -> legacy_reconstructed.
--   F Stripe order whose stored PaymentIntent and Checkout amounts disagree ->
--     conflict, left untouched for a human.
-- Proves: dry run changes nothing; apply writes the totals, fills missing
-- breakdowns and one audit row per changed order; a second run is a no-op.

\set ON_ERROR_STOP on

BEGIN;

DO $backfill$
DECLARE
  v_user  uuid := '38720000-0000-4000-8000-0000000b0001';
  v_brand uuid := '38720000-0000-4000-8000-0000000b0002';
  v_event uuid := '38720000-0000-4000-8000-0000000b0003';
  v_ng_brand uuid := '38720000-0000-4000-8000-0000000b0004';
  v_ng_event uuid := '38720000-0000-4000-8000-0000000b0005';
  v_a uuid := '38720000-0000-4000-8000-0000000b00a1';
  v_b uuid := '38720000-0000-4000-8000-0000000b00b1';
  v_c uuid := '38720000-0000-4000-8000-0000000b00c1';
  v_d uuid := '38720000-0000-4000-8000-0000000b00d1';
  v_e uuid := '38720000-0000-4000-8000-0000000b00e1';
  v_f uuid := '38720000-0000-4000-8000-0000000b00f1';
  v_tt uuid;
  v_rows integer;
  v_r record;
  v_o public.orders%ROWTYPE;
BEGIN
  -- Isolate from any orders other suites left in the replayed database (this
  -- transaction rolls back, so nothing outside the suite is changed).
  UPDATE public.orders SET list_subtotal_cents = coalesce(total_cents, 0),
    net_subtotal_cents = coalesce(total_cents, 0), buyer_fees_cents = 0, tax_cents = 0,
    buyer_total_cents = coalesce(total_cents, 0), pricing_source = 'legacy_reconstructed'
   WHERE buyer_total_cents IS NULL;

  INSERT INTO auth.users(id) VALUES (v_user);
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, default_pass_mingla_fee, default_pass_service_fee)
  VALUES (v_brand, v_user, 'i3872 backfill us', 'i3872-backfill-us', 'stripe', 'US', 'USD', 'USD', true, true);
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'i3872 backfill', 'i3872-backfill-us-ev', 'live', 'USD');
  INSERT INTO public.ticket_types(event_id, name, price_cents, currency, is_free, quantity_total,
    min_purchase_qty, available_online, available_in_person, display_order)
  VALUES (v_event, 'GA', 1000, 'USD', false, 100, 1, true, true, 0) RETURNING id INTO v_tt;
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_currency,
    default_currency, default_pass_mingla_fee, default_pass_service_fee)
  VALUES (v_ng_brand, v_user, 'i3872 backfill ng', 'i3872-backfill-ng', 'paystack', 'NGN', 'NGN', true, true);
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_ng_event, v_ng_brand, 'i3872 backfill ng', 'i3872-backfill-ng-ev', 'live', 'NGN');

  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status, payment_method,
    stripe_payment_intent_id, stripe_charge_id, source, buyer_phone_e164,
    stripe_application_fee_amount_cents, pricing_breakdown)
  VALUES
    (v_a, v_event, 3000, 'USD', 'paid', 'online_card', 'pi_3872_bf_a', 'ch_3872_bf_a', 'online_checkout', '+12125550100', 45, NULL),
    (v_b, v_ng_event, 6270000, 'NGN', 'paid', 'online_card', 'mingla_3872_bf_b', '6664932786', 'online_checkout', '+2348012345678', 90000, NULL),
    (v_c, v_event, 1000, 'USD', 'paid', 'online_card', 'pi_3872_bf_c', 'ch_3872_bf_c', 'online_checkout', '+12125550100', 15,
      jsonb_build_object('base_cents', 1000, 'buyer_subtotal_cents', 1000, 'buyer_total_cents', 1000)),
    (v_d, v_event, 0, 'USD', 'paid', 'free', NULL, NULL, 'online_checkout', '+12125550100', 0, NULL),
    (v_e, v_event, 2000, 'USD', 'paid', 'online_card', 'pi_3872_bf_e', 'ch_3872_bf_e', 'online_checkout', '+12125550100', 30, NULL),
    (v_f, v_event, 1000, 'USD', 'paid', 'online_card', 'pi_3872_bf_f', 'ch_3872_bf_f', 'online_checkout', '+12125550100', 15, NULL);
  INSERT INTO public.order_line_items(order_id, ticket_type_id, quantity, unit_price_cents, total_cents)
  SELECT x.id, v_tt, x.q, x.u, x.q * x.u
    FROM (VALUES (v_a, 3, 1000), (v_b, 6, 1000000), (v_c, 1, 1000), (v_e, 2, 1000), (v_f, 1, 1000)) AS x(id, q, u);
  -- A was a hosted Checkout (the session carries the Checkout Session id).
  INSERT INTO public.ticket_checkout_sessions(event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
    currency, subtotal_cents, total_cents, status, idempotency_key, expires_at, order_id,
    stripe_checkout_session_id, stripe_payment_intent_id)
  VALUES (v_event, v_brand, 'Hosted', 'hosted@example.test', '+12125550100', 'USD', 3000, 3000,
    'paid_completed', 'i3872-bf-a', now() + interval '1 hour', v_a, 'cs_3872_bf_a', 'pi_3872_bf_a');

  INSERT INTO public.payment_webhook_events(stripe_event_id, type, payload, provider, provider_event_type)
  VALUES
    ('evt_3872_a1', 'checkout.session.completed', jsonb_build_object('data', jsonb_build_object('object',
      jsonb_build_object('id','cs_3872_bf_a','payment_intent','pi_3872_bf_a','amount_total',3135,
        'total_details', jsonb_build_object('amount_tax',0)))), 'stripe', 'checkout.session.completed'),
    ('evt_3872_a2', 'payment_intent.succeeded', jsonb_build_object('data', jsonb_build_object('object',
      jsonb_build_object('id','pi_3872_bf_a','amount_received',3135))), 'stripe', 'payment_intent.succeeded'),
    ('evt_3872_a3', 'charge.succeeded', jsonb_build_object('data', jsonb_build_object('object',
      jsonb_build_object('id','ch_3872_bf_a','payment_intent','pi_3872_bf_a','amount',3135))), 'stripe', 'charge.succeeded'),
    ('evt_3872_b1', 'charge.success', jsonb_build_object('data', jsonb_build_object(
      'reference','mingla_3872_bf_b','amount',6270000,'fees',104050)), 'paystack', 'charge.success'),
    ('evt_3872_c1', 'payment_intent.succeeded', jsonb_build_object('data', jsonb_build_object('object',
      jsonb_build_object('id','pi_3872_bf_c','amount_received',1000))), 'stripe', 'payment_intent.succeeded'),
    ('evt_3872_f1', 'checkout.session.completed', jsonb_build_object('data', jsonb_build_object('object',
      jsonb_build_object('id','cs_3872_bf_f','payment_intent','pi_3872_bf_f','amount_total',1045))), 'stripe', 'checkout.session.completed'),
    ('evt_3872_f2', 'payment_intent.succeeded', jsonb_build_object('data', jsonb_build_object('object',
      jsonb_build_object('id','pi_3872_bf_f','amount_received',1000))), 'stripe', 'payment_intent.succeeded');

  -- Dry run: reports, changes nothing.
  SELECT count(*) INTO v_rows FROM public.issue_3872_backfill_order_totals(false);
  IF v_rows <> 6 OR EXISTS (SELECT 1 FROM public.orders WHERE id IN (v_a,v_b,v_c,v_d,v_e,v_f)
                              AND buyer_total_cents IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.issue_3872_order_totals_backfill_audit) THEN
    RAISE EXCEPTION 'backfill: dry run must report 6 rows and change nothing (rows %)', v_rows;
  END IF;

  -- Apply.
  FOR v_r IN SELECT * FROM public.issue_3872_backfill_order_totals(true) LOOP
    RAISE NOTICE 'issue_3872 backfill row % % % -> % (% / % / %) % %',
      v_r.path, v_r.order_id, v_r.legacy_total_cents, v_r.provider_total_cents,
      v_r.net_subtotal_cents, v_r.buyer_fees_cents, v_r.tax_cents, v_r.pricing_source, v_r.verdict;
  END LOOP;

  SELECT * INTO v_o FROM public.orders WHERE id = v_a;
  IF v_o.buyer_total_cents <> 3135 OR v_o.net_subtotal_cents <> 3000 OR v_o.buyer_fees_cents <> 135
     OR v_o.tax_cents <> 0 OR v_o.pricing_source <> 'provider_reconciled' OR v_o.pricing_breakdown IS NULL
     OR v_o.total_cents <> 3000 THEN
    RAISE EXCEPTION 'backfill A (hosted F3): got total % net % fees % source %',
      v_o.buyer_total_cents, v_o.net_subtotal_cents, v_o.buyer_fees_cents, v_o.pricing_source;
  END IF;
  SELECT * INTO v_o FROM public.orders WHERE id = v_b;
  IF v_o.buyer_total_cents <> 6270000 OR v_o.net_subtotal_cents <> 6000000 OR v_o.buyer_fees_cents <> 270000
     OR v_o.pricing_source <> 'provider_reconciled' OR v_o.pricing_breakdown IS NULL
     OR v_o.pricing_breakdown->>'region' <> 'NG' THEN
    RAISE EXCEPTION 'backfill B (Paystack F2): got total % net % fees % bd %',
      v_o.buyer_total_cents, v_o.net_subtotal_cents, v_o.buyer_fees_cents, v_o.pricing_breakdown;
  END IF;
  SELECT * INTO v_o FROM public.orders WHERE id = v_c;
  IF v_o.buyer_total_cents <> 1000 OR v_o.pricing_source <> 'provider_reconciled'
     OR v_o.pricing_breakdown->>'reconstructed_by' IS NOT NULL THEN
    RAISE EXCEPTION 'backfill C (native): totals % source %, breakdown must be kept', v_o.buyer_total_cents, v_o.pricing_source;
  END IF;
  SELECT * INTO v_o FROM public.orders WHERE id = v_d;
  IF v_o.buyer_total_cents <> 0 OR v_o.pricing_breakdown IS NULL THEN
    RAISE EXCEPTION 'backfill D (free): got % %', v_o.buyer_total_cents, v_o.pricing_breakdown;
  END IF;
  SELECT * INTO v_o FROM public.orders WHERE id = v_e;
  IF v_o.pricing_source <> 'legacy_reconstructed' OR v_o.buyer_total_cents <> 2090 THEN
    RAISE EXCEPTION 'backfill E (no provider record): expected legacy_reconstructed 2090, got % %',
      v_o.pricing_source, v_o.buyer_total_cents;
  END IF;
  SELECT * INTO v_o FROM public.orders WHERE id = v_f;
  IF v_o.buyer_total_cents IS NOT NULL THEN
    RAISE EXCEPTION 'backfill F (conflicting provider records) must be left for a human';
  END IF;
  IF (SELECT count(*) FROM public.issue_3872_order_totals_backfill_audit) <> 5 THEN
    RAISE EXCEPTION 'backfill: expected 5 audit rows (A-E), got %',
      (SELECT count(*) FROM public.issue_3872_order_totals_backfill_audit);
  END IF;

  -- Idempotent: the second run touches nothing new (only F, still a conflict).
  SELECT count(*) INTO v_rows FROM public.issue_3872_backfill_order_totals(true) WHERE verdict = 'apply';
  IF v_rows <> 0 OR (SELECT count(*) FROM public.issue_3872_order_totals_backfill_audit) <> 5 THEN
    RAISE EXCEPTION 'backfill: second run must be a no-op (applied %)', v_rows;
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_3872_backfill_order_totals(boolean,integer)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.issue_3872_order_totals_backfill_audit', 'SELECT') THEN
    RAISE EXCEPTION 'backfill: operator surfaces must not be reachable by app users';
  END IF;
  RAISE NOTICE 'issue_3872 backfill pass';
END $backfill$;

ROLLBACK;
