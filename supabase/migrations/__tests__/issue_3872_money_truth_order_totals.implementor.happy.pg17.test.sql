-- Issue #3872 PR 1 (money truth) — explicit order totals and breakdown on every
-- ticket path, through the REAL create-session, attempt claim and finalize RPCs
-- (PG17).
--
-- MINGLA-INVARIANT: I-3872-ORDER-TOTALS-REACH-THE-ORDER | issue #3872 | Finalize copies the session's explicit totals and pricing breakdown to the order, and a later provider record of the charged amount reconciles both without ever overwriting reconciled totals.
--
-- Proves:
--   1. Paystack (paid): the totals and breakdown the edge writes at create land on
--      the order through biz_ticket_checkout_finalize (F2: Paystack orders had a
--      null breakdown), and the verified provider amount marks them reconciled.
--   2. Free: zero totals and a breakdown reach the order.
--   3. Hosted Stripe tax added by the provider after create is reconciled onto the
--      session and an already-finalized order (whichever path finalized first).
--   4. A provider amount below the computed subtotal and fees is refused, and the
--      identity constraint refuses totals that do not add up.
--   5. Copy never overwrites totals already on the order.
-- Every assertion fails before 20271107003872_issue_3872_money_truth.sql (the
-- columns, the copy and the provider-total function do not exist).

\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.i3872_event(p_tag text, p_paid boolean, OUT o_event uuid, OUT o_tt uuid)
LANGUAGE plpgsql AS $$
DECLARE v_user uuid := gen_random_uuid(); v_brand uuid := gen_random_uuid();
BEGIN
  o_event := gen_random_uuid();
  INSERT INTO auth.users(id) VALUES (v_user);
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  IF p_paid THEN
    INSERT INTO public.brands(id, account_id, name, slug, payment_provider, default_currency)
    VALUES (v_brand, v_user, 'i3872 ' || p_tag, 'i3872-' || p_tag || '-' || v_brand, 'paystack', 'NGN');
  ELSE
    INSERT INTO public.brands(id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i3872 ' || p_tag, 'i3872-' || p_tag || '-' || v_brand);
  END IF;
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone)
  VALUES (o_event, v_brand, 'i3872 ' || p_tag, 'i3872-' || p_tag || '-' || o_event,
          'event', 'draft', 'draft', 'UTC');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (o_event, now() + interval '7 days', now() + interval '7 days 4 hours', 'UTC', true);
  IF p_paid THEN
    INSERT INTO public.ticket_types(event_id, name, price_cents, currency, is_free, quantity_total,
      min_purchase_qty, available_online, available_in_person, display_order)
    VALUES (o_event, 'Paid entry', 500000, 'NGN', false, 100, 1, true, true, 0)
    RETURNING id INTO o_tt;
    UPDATE public.events SET status='scheduled', visibility='public', published_at=now()
     WHERE id = o_event;
  ELSE
    INSERT INTO public.ticket_types(event_id, name, price_cents, is_free, quantity_total,
      min_purchase_qty, available_online, available_in_person, display_order)
    VALUES (o_event, 'Free entry', 0, true, 100, 1, true, true, 0)
    RETURNING id INTO o_tt;
    PERFORM set_config('mingla.publish_free_only', 'on', true);
    UPDATE public.events SET status='scheduled', visibility='public', published_at=now()
     WHERE id = o_event;
    PERFORM set_config('mingla.publish_free_only', '', true);
  END IF;
END $$;

-- The breakdown the edge's buildPricingBreakdown produces for a Paystack NG event
-- passing the Mingla fee (1.5%) and the service fee (3%), VAT absorbed.
CREATE FUNCTION pg_temp.i3872_ng_breakdown(p_base bigint) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'region','NG','currency','NGN','tax_behavior','exclusive','tax_basis','config_vat',
    'switches', jsonb_build_object('pass_tax',false,'pass_mingla_fee',true,'pass_service_fee',true),
    'base_cents', p_base,
    'buyer_subtotal_cents', p_base + round(p_base*0.015) + round(p_base*0.03),
    'buyer_total_cents', p_base + round(p_base*0.015) + round(p_base*0.03),
    'components', jsonb_build_object('mingla_fee_cents',round(p_base*0.015),
      'service_fee_cents',round(p_base*0.03),'tax_cents',0),
    'passed', jsonb_build_object('mingla_fee_cents',round(p_base*0.015),
      'service_fee_cents',round(p_base*0.03),'tax_cents',0),
    'absorbed', jsonb_build_object('mingla_fee_cents',0,'service_fee_cents',0,'tax_cents',0),
    'application_fee_amount_cents', round(p_base*0.015),
    'connected_account_payout_cents', p_base + round(p_base*0.03),
    'stripe_tax_calculation_id', NULL,
    'effective_take_rate_bps', 150, 'take_rate_source', 'platform_default')
$$;

-- 1. Paystack paid path, end to end through the real RPCs.
DO $paid$
DECLARE
  v_ev record; v_session jsonb; v_sid uuid; v_claim jsonb; v_fin jsonb; v_rec jsonb;
  v_order public.orders%ROWTYPE; v_bd jsonb := pg_temp.i3872_ng_breakdown(500000);
BEGIN
  SELECT * INTO v_ev FROM pg_temp.i3872_event('paid', true);
  v_session := public.biz_ticket_checkout_create_session(
    v_ev.o_event, NULL, 'Paying Guest', 'i3872-paid@tester.test', '+2348012345678', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', v_ev.o_tt, 'quantity', 1)),
    'i3872-paid-key', now() + interval '15 minutes', 0, 'auto');
  v_sid := (v_session->>'checkoutSessionId')::uuid;
  v_claim := public.issue_1930_claim_ticket_provider_attempt(
    v_sid, v_ev.o_event, 'paystack', 'paystack_redirect', 'i3872-fingerprint');
  IF v_claim->>'outcome' <> 'fresh_claim' THEN
    RAISE EXCEPTION 'paid: fixture claim failed: %', v_claim;
  END IF;
  -- What ticket-checkout-create's Paystack arm persists (reference, fee, the
  -- all-in total) and, since #3872, the explicit totals from psBreakdown.
  UPDATE public.ticket_checkout_sessions
     SET stripe_payment_intent_id = 'mingla_' || v_sid,
         stripe_application_fee_amount_cents = 7500,
         total_cents = 522500,
         status = 'awaiting_web_redirect',
         list_subtotal_cents = 500000, discount_cents = 0, net_subtotal_cents = 500000,
         buyer_fees_cents = 22500, tax_cents = 0, buyer_total_cents = 522500,
         pricing_source = 'computed_at_checkout', pricing_breakdown = v_bd
   WHERE id = v_sid AND order_id IS NULL;
  PERFORM public.issue_1930_commit_ticket_provider_attempt(
    (v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint,
    NULL, NULL, 'mingla_' || v_sid, 'i3872-continuation');

  -- paystackWebhookRouter: record the verified amount, then finalize.
  v_rec := public.issue_3872_record_ticket_provider_total(v_sid, 'paystack', 522500, NULL);
  IF v_rec->>'outcome' <> 'reconciled' OR (v_rec->>'changed')::boolean THEN
    RAISE EXCEPTION 'paid: provider total should reconcile unchanged: %', v_rec;
  END IF;
  v_fin := public.biz_ticket_checkout_finalize(
    v_sid, 'mingla_' || v_sid, '987654321', 'card', 'issue-3872-pepper-0123456789abcdef', NULL, NULL, false);
  IF v_fin->>'outcome' <> 'finalized' THEN
    RAISE EXCEPTION 'paid: finalize did not finalize: %', v_fin;
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = (v_fin->>'orderId')::uuid;
  IF v_order.pricing_breakdown IS NULL THEN
    RAISE EXCEPTION 'paid F2: the Paystack order has no pricing_breakdown';
  END IF;
  IF v_order.buyer_total_cents IS DISTINCT FROM 522500
     OR v_order.net_subtotal_cents IS DISTINCT FROM 500000
     OR v_order.buyer_fees_cents IS DISTINCT FROM 22500
     OR v_order.tax_cents IS DISTINCT FROM 0
     OR v_order.pricing_source IS DISTINCT FROM 'provider_reconciled' THEN
    RAISE EXCEPTION 'paid F3: order totals not copied: total % net % fees % tax % source %',
      v_order.buyer_total_cents, v_order.net_subtotal_cents, v_order.buyer_fees_cents,
      v_order.tax_cents, v_order.pricing_source;
  END IF;
  IF v_order.total_cents <> 522500 THEN
    RAISE EXCEPTION 'paid: orders.total_cents must keep its legacy Paystack meaning, got %', v_order.total_cents;
  END IF;
  RAISE NOTICE 'issue_3872 order_totals paid pass';
END $paid$;

-- 2. Free path.
DO $free$
DECLARE v_ev record; v_session jsonb; v_sid uuid; v_fin jsonb; v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_ev FROM pg_temp.i3872_event('free', false);
  v_session := public.biz_ticket_checkout_create_session(
    v_ev.o_event, NULL, 'Free Guest', 'i3872-free@tester.test', '+14155550150', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', v_ev.o_tt, 'quantity', 1)),
    'i3872-free-key', now() + interval '15 minutes', 0, 'auto');
  v_sid := (v_session->>'checkoutSessionId')::uuid;
  UPDATE public.ticket_checkout_sessions
     SET list_subtotal_cents = 0, discount_cents = 0, net_subtotal_cents = 0,
         buyer_fees_cents = 0, tax_cents = 0, buyer_total_cents = 0,
         pricing_source = 'computed_at_checkout',
         pricing_breakdown = jsonb_build_object('base_cents',0,'buyer_subtotal_cents',0,'buyer_total_cents',0)
   WHERE id = v_sid AND order_id IS NULL;
  IF NOT public.issue_1930_ticket_session_authorized(v_sid, v_ev.o_event) THEN
    RAISE EXCEPTION 'free: fixture session not authorized';
  END IF;
  v_fin := public.biz_ticket_checkout_finalize(v_sid, NULL, NULL, 'free',
    'issue-3872-pepper-0123456789abcdef', NULL, NULL, false);
  SELECT * INTO v_order FROM public.orders WHERE id = (v_fin->>'orderId')::uuid;
  IF v_order.id IS NULL OR v_order.pricing_breakdown IS NULL
     OR v_order.buyer_total_cents IS DISTINCT FROM 0
     OR v_order.pricing_source IS DISTINCT FROM 'computed_at_checkout' THEN
    RAISE EXCEPTION 'free: zero totals / breakdown not on the order: %', v_fin;
  END IF;
  RAISE NOTICE 'issue_3872 order_totals free pass';
END $free$;

-- 3. Provider-added tax is reconciled onto the session and an existing order;
-- 4. a short provider amount is refused; 5. copy never overwrites.
DO $reconcile$
DECLARE
  v_ev record; v_session jsonb; v_sid uuid; v_claim jsonb; v_fin jsonb; v_rec jsonb;
  v_order public.orders%ROWTYPE; v_bd jsonb := pg_temp.i3872_ng_breakdown(500000);
BEGIN
  SELECT * INTO v_ev FROM pg_temp.i3872_event('tax', true);
  v_session := public.biz_ticket_checkout_create_session(
    v_ev.o_event, NULL, 'Taxed Guest', 'i3872-tax@tester.test', '+2348012345679', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', v_ev.o_tt, 'quantity', 1)),
    'i3872-tax-key', now() + interval '15 minutes', 0, 'auto');
  v_sid := (v_session->>'checkoutSessionId')::uuid;
  v_claim := public.issue_1930_claim_ticket_provider_attempt(
    v_sid, v_ev.o_event, 'paystack', 'paystack_redirect', 'i3872-fingerprint-tax');
  UPDATE public.ticket_checkout_sessions
     SET stripe_payment_intent_id = 'mingla_' || v_sid, stripe_application_fee_amount_cents = 7500,
         total_cents = 522500, status = 'awaiting_web_redirect',
         list_subtotal_cents = 500000, discount_cents = 0, net_subtotal_cents = 500000,
         buyer_fees_cents = 22500, tax_cents = 0, buyer_total_cents = 522500,
         pricing_source = 'computed_at_checkout', pricing_breakdown = v_bd
   WHERE id = v_sid;
  PERFORM public.issue_1930_commit_ticket_provider_attempt(
    (v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint,
    NULL, NULL, 'mingla_' || v_sid, 'i3872-continuation-tax');
  -- Another path (confirm / reconcile sweep) finalizes before the webhook runs.
  v_fin := public.biz_ticket_checkout_finalize(
    v_sid, 'mingla_' || v_sid, '987654322', 'card', 'issue-3872-pepper-0123456789abcdef', NULL, NULL, false);
  SELECT * INTO v_order FROM public.orders WHERE id = (v_fin->>'orderId')::uuid;
  IF v_order.buyer_total_cents <> 522500 OR v_order.pricing_source <> 'computed_at_checkout' THEN
    RAISE EXCEPTION 'reconcile: copy at finalize missing: % %', v_order.buyer_total_cents, v_order.pricing_source;
  END IF;

  -- 4. A provider amount below subtotal + fees is refused and changes nothing.
  v_rec := public.issue_3872_record_ticket_provider_total(v_sid, 'stripe', 500000, NULL);
  IF v_rec->>'outcome' <> 'mismatch' THEN
    RAISE EXCEPTION 'reconcile: short provider amount must be refused: %', v_rec;
  END IF;

  -- 3. The provider added 2000 tax on top (exclusive automatic tax).
  v_rec := public.issue_3872_record_ticket_provider_total(v_sid, 'stripe', 524500, 2000);
  SELECT * INTO v_order FROM public.orders WHERE id = (v_fin->>'orderId')::uuid;
  IF v_rec->>'outcome' <> 'reconciled' OR NOT (v_rec->>'order_updated')::boolean
     OR v_order.buyer_total_cents <> 524500 OR v_order.tax_cents <> 2000
     OR v_order.pricing_source <> 'provider_reconciled'
     OR (v_order.pricing_breakdown->>'buyer_total_cents')::bigint <> 524500
     OR (v_order.pricing_breakdown#>>'{components,tax_cents}')::bigint <> 2000 THEN
    RAISE EXCEPTION 'reconcile: provider tax not reconciled onto the order: % / total % tax % bd %',
      v_rec, v_order.buyer_total_cents, v_order.tax_cents, v_order.pricing_breakdown;
  END IF;
  IF (SELECT buyer_total_cents FROM public.ticket_checkout_sessions WHERE id = v_sid) <> 524500 THEN
    RAISE EXCEPTION 'reconcile: session not reconciled';
  END IF;

  -- 5. A later copy never overwrites reconciled totals.
  PERFORM public.issue_3872_copy_session_totals_to_order(v_sid);
  IF (SELECT buyer_total_cents FROM public.orders WHERE id = v_order.id) <> 524500 THEN
    RAISE EXCEPTION 'reconcile: copy overwrote reconciled totals';
  END IF;

  -- The identity constraint refuses totals that do not add up.
  BEGIN
    UPDATE public.orders SET buyer_fees_cents = buyer_fees_cents + 1 WHERE id = v_order.id;
    RAISE EXCEPTION 'reconcile: identity constraint accepted totals that do not add up';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'issue_3872 order_totals reconcile pass';
END $reconcile$;

-- Privilege shape: the new helpers are service-role only.
DO $grants$
BEGIN
  IF has_function_privilege('anon', 'public.issue_3872_record_ticket_provider_total(uuid,text,bigint,bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3872_record_ticket_provider_total(uuid,text,bigint,bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3872_copy_session_totals_to_order(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.issue_3872_record_ticket_provider_total(uuid,text,bigint,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'grants: #3872 helpers must be service_role only';
  END IF;
END $grants$;

ROLLBACK;
