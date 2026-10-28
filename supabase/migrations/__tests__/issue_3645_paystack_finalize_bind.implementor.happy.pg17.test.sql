-- Issue #3645 — Paystack plan finalize + bind (PG17, BEGIN…ROLLBACK).
--
-- Proves:
--   1. Finalizing a Paystack plan (non-PaymentIntent reference + numeric
--      transaction id) needs no Stripe customer/card and creates provider
--      'paystack', 'pay_link', unbound rows (fail closed until bound).
--   2. A Stripe plan without customer/card still raises
--      installment_plan_finalize_missing_customer_or_pm; with them the rows
--      are 'stripe', 'auto_card', bound.
--   3. Bind copies each later payment's locked price from the session's
--      installment_charge_plan; a reusable card → auto_card + one stored
--      authorization; replay is a no-op; the first authorization wins.
--   4. Bind refuses a plan whose net does not match (installment_charge_plan_mismatch)
--      and a missing plan (installment_charge_plan_missing).
--   5. Without a reusable card the rows stay pay_link; upgrade mode later
--      flips only scheduled rows to auto_card and revokes their links.

BEGIN;

-- The Paystack switch ships false; flip it inside this transaction only so
-- the #3859 session belt admits a Paystack plan session.
CREATE OR REPLACE FUNCTION public.issue_3645_paystack_installments_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $on$ SELECT true $on$;

CREATE FUNCTION pg_temp.i3645_pepper() RETURNS text LANGUAGE sql AS $$
  SELECT 'i3645-test-pepper-0123456789abcdef'::text;
$$;

-- One trip + ticket type per provider.
CREATE FUNCTION pg_temp.i3645_fixture(p_seed text, p_provider text, p_currency text)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tt uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-' || p_seed || '@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, default_currency, pricing_currency)
  VALUES (v_brand, v_owner, 'Brand ' || p_seed, 'issue-3645-fb-' || p_seed, p_provider, p_currency, p_currency);
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_event, v_brand, 'Trip ' || p_seed, 'issue-3645-fb-trip-' || p_seed, 'trip', 'scheduled', 'public', 'UTC', p_currency);
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total,
    min_purchase_qty, available_online, available_in_person, display_order)
  VALUES (v_tt, v_event, 'Package', 1000000, p_currency, false, 100, 1, true, false, 0);
  RETURN jsonb_build_object('brand', v_brand, 'event', v_event, 'tt', v_tt);
END $f$;

CREATE FUNCTION pg_temp.i3645_session(p_fx jsonb, p_currency text, p_with_plan boolean)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.ticket_checkout_sessions(id, event_id, brand_id, buyer_name, buyer_email,
    buyer_phone_e164, currency, subtotal_cents, total_cents, status, idempotency_key, expires_at,
    installment_schedule, installment_charge_plan)
  VALUES (v_id, (p_fx->>'event')::uuid, (p_fx->>'brand')::uuid, 'Plan buyer', 'plan-buyer@example.test',
    '+2348000000000', p_currency, 250000, 250000, 'requires_payment', 'i3645-fb-' || v_id,
    now() + interval '15 minutes',
    jsonb_build_object('fullPriceCents', 1000000, 'depositCents', 250000, 'currency', p_currency,
      'installments', jsonb_build_array(
        jsonb_build_object('ordinal', 1, 'pct', 50, 'amountCents', 500000, 'dueAt', now() + interval '20 days'),
        jsonb_build_object('ordinal', 2, 'pct', 25, 'amountCents', 250000, 'dueAt', now() + interval '50 days'))),
    CASE WHEN p_with_plan THEN jsonb_build_object('currency', 'NGN', 'engineVersion', 1, 'payments', jsonb_build_array(
      jsonb_build_object('ordinal', 1, 'netCents', 500000, 'buyerTotalCents', 541250, 'applicationFeeCents', 22500,
        'taxCents', 2813, 'breakdown', jsonb_build_object('totalCents', 541250)),
      jsonb_build_object('ordinal', 2, 'netCents', 250000, 'buyerTotalCents', 270625, 'applicationFeeCents', 11250,
        'taxCents', 1406, 'breakdown', jsonb_build_object('totalCents', 270625)))) END);
  INSERT INTO public.ticket_checkout_session_items(checkout_session_id, ticket_type_id,
    ticket_name_at_purchase, quantity, unit_price_cents, total_cents)
  VALUES (v_id, (p_fx->>'tt')::uuid, 'Package', 1, 1000000, 1000000);
  RETURN v_id;
END $f$;

DO $test$
DECLARE
  v_ps jsonb := pg_temp.i3645_fixture('ps', 'paystack', 'NGN');
  v_st jsonb := pg_temp.i3645_fixture('st', 'stripe', 'USD');
  v_sess uuid;
  v_sess2 uuid;
  v_res jsonb;
  v_order uuid;
  v_order2 uuid;
  v_msg text;
  v_count integer;
  v_auth jsonb := jsonb_build_object('authorization_code', 'AUTH_bindtest01', 'reusable', true,
    'channel', 'card', 'card_type', 'visa', 'last4', '4081', 'exp_month', '12', 'exp_year', '2030',
    'bank', 'TEST BANK', 'signature', 'SIG_test', 'customer_code', 'CUS_test',
    'authorization_email', 'plan-buyer@example.test', 'source_reference', 'mingla_dep');
BEGIN
  -- 1. Paystack finalize without customer/card.
  v_sess := pg_temp.i3645_session(v_ps, 'NGN', true);
  v_res := public.issue_1930_ticket_checkout_finalize_base(v_sess, 'mingla_' || v_sess, '4200001', 'card',
    pg_temp.i3645_pepper(), NULL, NULL, true);
  v_order := (v_res->>'orderId')::uuid;
  IF (v_res->>'installmentPlanRoot')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'fb_1_plan_root_expected_%', v_res;
  END IF;
  SELECT count(*) INTO v_count FROM public.order_installments
   WHERE order_id = v_order AND provider = 'paystack' AND collection_method = 'pay_link'
     AND plan_bound_at IS NULL AND buyer_total_cents IS NULL AND status = 'scheduled';
  IF v_count <> 2 THEN RAISE EXCEPTION 'fb_1_expected_2_unbound_paystack_rows_got_%', v_count; END IF;

  -- An unbound Paystack row is never chargeable.
  v_res := public.issue_3645_begin_installment_attempt(
    (SELECT id FROM public.order_installments WHERE order_id = v_order AND ordinal = 1), 'pay_link', 0);
  IF v_res->>'reason' IS DISTINCT FROM 'plan_not_bound' THEN
    RAISE EXCEPTION 'fb_1_unbound_must_refuse_%', v_res;
  END IF;

  -- 2. Stripe guard unchanged.
  v_sess2 := pg_temp.i3645_session(v_st, 'USD', false);
  BEGIN
    PERFORM public.issue_1930_ticket_checkout_finalize_base(v_sess2, 'pi_3645stripeplan', 'ch_3645stripeplan',
      'card', pg_temp.i3645_pepper(), NULL, NULL, true);
    RAISE EXCEPTION 'fb_2_stripe_guard_missing';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg <> 'installment_plan_finalize_missing_customer_or_pm' THEN RAISE; END IF;
  END;
  v_res := public.issue_1930_ticket_checkout_finalize_base(v_sess2, 'pi_3645stripeplan', 'ch_3645stripeplan',
    'card', pg_temp.i3645_pepper(), 'cus_3645', 'pm_3645', true);
  v_order2 := (v_res->>'orderId')::uuid;
  SELECT count(*) INTO v_count FROM public.order_installments
   WHERE order_id = v_order2 AND provider = 'stripe' AND collection_method = 'auto_card'
     AND plan_bound_at IS NOT NULL AND buyer_total_cents IS NULL;
  IF v_count <> 2 THEN RAISE EXCEPTION 'fb_2_expected_2_bound_stripe_rows_got_%', v_count; END IF;
  -- Bind refuses a Stripe plan.
  BEGIN
    PERFORM public.issue_3645_paystack_plan_bind(v_order2, NULL);
    RAISE EXCEPTION 'fb_2_bind_accepted_stripe';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg <> 'not_paystack_plan' THEN RAISE; END IF;
  END;

  -- 4a. Mismatched net refuses (nothing bound).
  UPDATE public.ticket_checkout_sessions
     SET installment_charge_plan = jsonb_set(installment_charge_plan, '{payments,0,netCents}', '499999')
   WHERE id = v_sess;
  BEGIN
    PERFORM public.issue_3645_paystack_plan_bind(v_order, v_auth);
    RAISE EXCEPTION 'fb_4_mismatch_accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg <> 'installment_charge_plan_mismatch' THEN RAISE; END IF;
  END;
  UPDATE public.ticket_checkout_sessions
     SET installment_charge_plan = jsonb_set(installment_charge_plan, '{payments,0,netCents}', '500000')
   WHERE id = v_sess;

  -- 3. Bind with a reusable card.
  v_res := public.issue_3645_paystack_plan_bind(v_order, v_auth);
  IF (v_res->>'bound_count')::integer <> 2 OR v_res->>'collection_method' <> 'auto_card' THEN
    RAISE EXCEPTION 'fb_3_bind_result_%', v_res;
  END IF;
  IF v_res::text LIKE '%AUTH_%' OR v_res::text LIKE '%plan-buyer%' THEN
    RAISE EXCEPTION 'fb_3_bind_result_leaks_card_details';
  END IF;
  SELECT count(*) INTO v_count FROM public.order_installments
   WHERE order_id = v_order AND collection_method = 'auto_card' AND plan_bound_at IS NOT NULL
     AND ((ordinal = 1 AND buyer_total_cents = 541250 AND planned_application_fee_cents = 22500)
       OR (ordinal = 2 AND buyer_total_cents = 270625 AND planned_application_fee_cents = 11250))
     AND pricing_breakdown IS NOT NULL;
  IF v_count <> 2 THEN RAISE EXCEPTION 'fb_3_prices_not_locked_%', v_count; END IF;
  SELECT count(*) INTO v_count FROM private.order_payment_authorizations
   WHERE order_id = v_order AND reusable AND authorization_email = 'plan-buyer@example.test' AND last4 = '4081';
  IF v_count <> 1 THEN RAISE EXCEPTION 'fb_3_authorization_not_stored_%', v_count; END IF;
  -- The charge function returns it for an auto_card row.
  SELECT count(*) INTO v_count FROM public.issue_3645_installment_authorization_for_charge(
    (SELECT id FROM public.order_installments WHERE order_id = v_order AND ordinal = 1));
  IF v_count <> 1 THEN RAISE EXCEPTION 'fb_3_charge_authorization_missing'; END IF;

  -- Replay is a no-op; a second authorization never replaces the first.
  v_res := public.issue_3645_paystack_plan_bind(v_order,
    jsonb_set(v_auth, '{authorization_code}', '"AUTH_secondcard"'));
  IF (v_res->>'replayed')::boolean IS NOT TRUE OR (v_res->>'bound_count')::integer <> 0 THEN
    RAISE EXCEPTION 'fb_3_replay_%', v_res;
  END IF;
  IF (SELECT authorization_code FROM private.order_payment_authorizations WHERE order_id = v_order) <> 'AUTH_bindtest01' THEN
    RAISE EXCEPTION 'fb_3_first_authorization_must_win';
  END IF;
END
$test$;

-- 4b + 5. A non-reusable deposit → pay links; missing plan refuses; upgrade.
DO $test2$
DECLARE
  v_ps jsonb := pg_temp.i3645_fixture('ps2', 'paystack', 'NGN');
  v_sess uuid;
  v_order uuid;
  v_res jsonb;
  v_msg text;
  v_count integer;
  v_inst1 uuid;
  v_inst2 uuid;
BEGIN
  v_sess := pg_temp.i3645_session(v_ps, 'NGN', false);
  v_res := public.issue_1930_ticket_checkout_finalize_base(v_sess, 'mingla_' || v_sess, '4200002', 'card',
    pg_temp.i3645_pepper(), NULL, NULL, true);
  v_order := (v_res->>'orderId')::uuid;
  BEGIN
    PERFORM public.issue_3645_paystack_plan_bind(v_order, NULL);
    RAISE EXCEPTION 'fb_4b_missing_plan_accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg <> 'installment_charge_plan_missing' THEN RAISE; END IF;
  END;
  UPDATE public.ticket_checkout_sessions
     SET installment_charge_plan = jsonb_build_object('currency', 'NGN', 'engineVersion', 1, 'payments', jsonb_build_array(
       jsonb_build_object('ordinal', 1, 'netCents', 500000, 'buyerTotalCents', 541250, 'applicationFeeCents', 22500,
         'taxCents', 2813, 'breakdown', '{}'::jsonb),
       jsonb_build_object('ordinal', 2, 'netCents', 250000, 'buyerTotalCents', 270625, 'applicationFeeCents', 11250,
         'taxCents', 1406, 'breakdown', '{}'::jsonb)))
   WHERE id = v_sess;
  -- Bank transfer: no reusable card.
  v_res := public.issue_3645_paystack_plan_bind(v_order, jsonb_build_object('reusable', false, 'channel', 'bank_transfer',
    'authorization_code', 'AUTH_notreusable', 'authorization_email', 'plan-buyer@example.test', 'source_reference', 'x'));
  IF v_res->>'collection_method' <> 'pay_link' THEN RAISE EXCEPTION 'fb_5_expected_pay_link_%', v_res; END IF;
  IF EXISTS (SELECT 1 FROM private.order_payment_authorizations WHERE order_id = v_order) THEN
    RAISE EXCEPTION 'fb_5_non_reusable_authorization_stored';
  END IF;
  SELECT id INTO v_inst1 FROM public.order_installments WHERE order_id = v_order AND ordinal = 1;
  SELECT id INTO v_inst2 FROM public.order_installments WHERE order_id = v_order AND ordinal = 2;
  -- Instalment 1 failed (unpaid link); instalment 2 scheduled with a live link.
  UPDATE public.order_installments SET status = 'failed', failed_at = now(), failure_reason = 'pay_link_unpaid',
    retry_count = 1 WHERE id = v_inst1;
  PERFORM public.issue_3645_issue_pay_link(v_inst2, 'pay', decode(repeat('11', 32), 'hex'));

  -- Upgrade: a later payment paid by a reusable card.
  v_res := public.issue_3645_paystack_plan_bind(v_order, jsonb_build_object('reusable', true, 'channel', 'card',
    'authorization_code', 'AUTH_upgrade01', 'authorization_email', 'plan-buyer@example.test',
    'source_reference', 'mingla-inst-x', 'last4', '4081'), true);
  IF (v_res->>'upgraded_count')::integer <> 1 THEN RAISE EXCEPTION 'fb_5_upgrade_count_%', v_res; END IF;
  IF (SELECT collection_method FROM public.order_installments WHERE id = v_inst1) <> 'pay_link' THEN
    RAISE EXCEPTION 'fb_5_failed_row_must_stay_pay_link';
  END IF;
  IF (SELECT collection_method FROM public.order_installments WHERE id = v_inst2) <> 'auto_card' THEN
    RAISE EXCEPTION 'fb_5_scheduled_row_must_upgrade';
  END IF;
  SELECT count(*) INTO v_count FROM public.order_installment_pay_links
   WHERE installment_id = v_inst2 AND revoked_at IS NULL;
  IF v_count <> 0 THEN RAISE EXCEPTION 'fb_5_upgraded_row_link_still_live'; END IF;
  -- A second upgrade never replaces the stored card.
  v_res := public.issue_3645_paystack_plan_bind(v_order, jsonb_build_object('reusable', true, 'channel', 'card',
    'authorization_code', 'AUTH_upgrade02', 'authorization_email', 'plan-buyer@example.test',
    'source_reference', 'mingla-inst-y'), true);
  IF v_res->>'reason' <> 'authorization_exists' THEN RAISE EXCEPTION 'fb_5_second_upgrade_%', v_res; END IF;
END
$test2$;

ROLLBACK;
