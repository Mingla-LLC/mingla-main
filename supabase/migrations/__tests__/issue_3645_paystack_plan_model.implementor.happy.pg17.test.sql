-- Issue #3645 — Paystack payment plans: data model (PG17, BEGIN…ROLLBACK).
--
-- Proves:
--   1. Paystack instalments must be NGN; Stripe rows are always auto_card.
--   2. provider is immutable after insert.
--   3. refunded_amount_cents never exceeds the charged amount.
--   4. A bound Paystack row always has its locked price.
--   5. Collecting / cancelling an instalment revokes its live pay link.
--   6. Saved card details are unreadable by anon/authenticated; the charge
--      function is service_role only; the attempts view hides the reference.
--   7. One unresolved attempt per instalment (partial unique index).
--   8. The readiness switch ships false.
--   9. The webhook inbox keeps only the masked card reference.

BEGIN;

DO $test$
DECLARE
  v_owner  constant uuid := '36450100-0000-4000-8000-000000000001';
  v_brand  constant uuid := '36450100-0000-4000-8000-000000000002';
  v_event  constant uuid := '36450100-0000-4000-8000-000000000003';
  v_order  constant uuid := '36450100-0000-4000-8000-000000000004';
  v_inst   constant uuid := '36450100-0000-4000-8000-000000000005';
  v_inst2  constant uuid := '36450100-0000-4000-8000-000000000006';
  v_ok boolean;
  v_count integer;
  v_reason text;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-3645-model@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency)
  VALUES (v_brand, v_owner, 'Model Brand', 'issue-3645-model', 'paystack', 'NG', 'NGN', 'NGN');
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'Model Trip', 'issue-3645-model-trip', 'scheduled', 'NGN');
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source, installment_plan_root)
  VALUES (v_order, v_event, 250000, 'NGN', 'paid', 'mingla_model_dep', '1001', 'legacy', true);

  -- 1a. Paystack must be NGN.
  BEGIN
    INSERT INTO public.order_installments(id, order_id, ordinal, amount_cents, currency, due_at, provider, collection_method)
    VALUES (gen_random_uuid(), v_order, 9, 1000, 'USD', now() + interval '10 days', 'paystack', 'pay_link');
    RAISE EXCEPTION 'model_1a_expected_ngn_check';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- 1b. Stripe rows are always auto_card.
  BEGIN
    INSERT INTO public.order_installments(id, order_id, ordinal, amount_cents, currency, due_at, provider, collection_method)
    VALUES (gen_random_uuid(), v_order, 9, 1000, 'NGN', now() + interval '10 days', 'stripe', 'pay_link');
    RAISE EXCEPTION 'model_1b_expected_stripe_auto_card_check';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.order_installments(id, order_id, ordinal, amount_cents, currency, due_at,
    provider, collection_method)
  VALUES (v_inst, v_order, 1, 750000, 'NGN', now() + interval '10 days', 'paystack', 'pay_link'),
         (v_inst2, v_order, 2, 750000, 'NGN', now() + interval '40 days', 'paystack', 'pay_link');

  -- 2. provider immutable.
  BEGIN
    UPDATE public.order_installments SET provider = 'stripe', collection_method = 'auto_card' WHERE id = v_inst;
    RAISE EXCEPTION 'model_2_expected_provider_immutable';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_reason = MESSAGE_TEXT;
    IF v_reason <> 'installment_provider_immutable' THEN RAISE; END IF;
  END;

  -- 4. Bound Paystack row needs its price.
  BEGIN
    UPDATE public.order_installments SET plan_bound_at = now() WHERE id = v_inst;
    RAISE EXCEPTION 'model_4_expected_bound_price_check';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.order_installments
     SET buyer_total_cents = 780000, planned_application_fee_cents = 30000, plan_bound_at = now()
   WHERE id IN (v_inst, v_inst2);
  -- buyer total can never be below the net.
  BEGIN
    UPDATE public.order_installments SET buyer_total_cents = 700000 WHERE id = v_inst;
    RAISE EXCEPTION 'model_4b_expected_buyer_total_check';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 3. refunded within charged (charged = buyer_total_cents).
  BEGIN
    UPDATE public.order_installments SET refunded_amount_cents = 780001 WHERE id = v_inst;
    RAISE EXCEPTION 'model_3_expected_refund_bound_check';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 5. Revoke links on collect / cancel.
  INSERT INTO public.order_installment_pay_links(installment_id, purpose, token_hash, expires_at)
  VALUES (v_inst, 'pay', decode(repeat('ab', 32), 'hex'), now() + interval '30 days'),
         (v_inst2, 'pay', decode(repeat('cd', 32), 'hex'), now() + interval '30 days');
  -- One live link per instalment.
  BEGIN
    INSERT INTO public.order_installment_pay_links(installment_id, purpose, token_hash, expires_at)
    VALUES (v_inst, 'pay', decode(repeat('ef', 32), 'hex'), now() + interval '30 days');
    RAISE EXCEPTION 'model_5_expected_one_live_link';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  UPDATE public.order_installments
     SET status = 'collected', collected_at = now(), stripe_payment_intent_id = 'mingla-inst-' || v_inst || '-l1'
   WHERE id = v_inst;
  UPDATE public.order_installments
     SET status = 'cancelled', cancelled_at = now()
   WHERE id = v_inst2;
  SELECT count(*) INTO v_count FROM public.order_installment_pay_links
   WHERE revoked_at IS NULL AND installment_id IN (v_inst, v_inst2);
  IF v_count <> 0 THEN RAISE EXCEPTION 'model_5_links_not_revoked_%', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.order_installment_pay_links
   WHERE revoked_reason IN ('installment_collected', 'installment_cancelled');
  IF v_count <> 2 THEN RAISE EXCEPTION 'model_5_revoked_reason_%', v_count; END IF;

  -- 7. One unresolved attempt per instalment.
  INSERT INTO public.order_installment_charge_attempts(installment_id, provider, attempt_no, method, reference,
    amount_cents, application_fee_cents)
  VALUES (v_inst2, 'paystack', 1, 'pay_link', 'mingla-inst-' || v_inst2 || '-l1', 780000, 30000);
  BEGIN
    INSERT INTO public.order_installment_charge_attempts(installment_id, provider, attempt_no, method, reference,
      amount_cents, application_fee_cents)
    VALUES (v_inst2, 'paystack', 2, 'pay_link', 'mingla-inst-' || v_inst2 || '-l2', 780000, 30000);
    RAISE EXCEPTION 'model_7_expected_one_open_attempt';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- Reference shape is enforced (hyphens only).
  BEGIN
    INSERT INTO public.order_installment_charge_attempts(installment_id, provider, attempt_no, method, reference,
      amount_cents, application_fee_cents, state)
    VALUES (v_inst2, 'paystack', 3, 'pay_link', 'mingla_inst_' || v_inst2, 780000, 30000, 'failed');
    RAISE EXCEPTION 'model_7b_expected_reference_check';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 8. Switch ships false.
  IF public.issue_3645_paystack_installments_enabled() IS NOT FALSE THEN
    RAISE EXCEPTION 'model_8_switch_must_ship_false';
  END IF;
END
$test$;

-- 6. Privacy: grants checked as the real roles.
DO $grants$
BEGIN
  IF has_table_privilege('anon', 'private.order_payment_authorizations', 'SELECT')
     OR has_table_privilege('authenticated', 'private.order_payment_authorizations', 'SELECT')
     OR has_table_privilege('service_role', 'private.order_payment_authorizations', 'SELECT') THEN
    RAISE EXCEPTION 'model_6_authorizations_table_readable_by_api_role';
  END IF;
  IF has_function_privilege('anon', 'public.issue_3645_installment_authorization_for_charge(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3645_installment_authorization_for_charge(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'model_6_charge_authorization_function_exposed';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.issue_3645_installment_authorization_for_charge(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'model_6_service_role_lost_charge_authorization';
  END IF;
  IF has_column_privilege('authenticated', 'public.order_installment_charge_attempts', 'reference', 'SELECT')
     OR has_column_privilege('authenticated', 'public.order_installment_charge_attempts', 'approval_url', 'SELECT')
     OR has_column_privilege('authenticated', 'public.order_installment_charge_attempts', 'gateway_response', 'SELECT') THEN
    RAISE EXCEPTION 'model_6_attempt_secrets_readable';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.order_installment_attempts_safe', 'SELECT') THEN
    RAISE EXCEPTION 'model_6_safe_view_not_readable';
  END IF;
  IF has_table_privilege('anon', 'public.order_installment_pay_links', 'SELECT')
     OR has_table_privilege('authenticated', 'public.order_installment_pay_links', 'SELECT') THEN
    RAISE EXCEPTION 'model_6_pay_links_readable';
  END IF;
  IF has_function_privilege('anon', 'public.issue_3645_paystack_installments_enabled()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3645_paystack_installments_enabled()', 'EXECUTE') THEN
    RAISE EXCEPTION 'model_6_switch_exposed';
  END IF;
END
$grants$;

-- 6b. As authenticated, the private table and the charge function both refuse.
DO $as_auth$
DECLARE
  v_denied boolean := false;
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM 1 FROM private.order_payment_authorizations;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'model_6b_authenticated_read_private'; END IF;
  v_denied := false;
  BEGIN
    PERFORM public.issue_3645_installment_authorization_for_charge(gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'model_6b_authenticated_called_charge_fn'; END IF;
  RESET ROLE;
END
$as_auth$;

-- 9. Webhook inbox scrub expression (same statement as the migration).
DO $scrub$
DECLARE
  v_id uuid;
  v_payload jsonb;
BEGIN
  INSERT INTO public.payment_webhook_events(stripe_event_id, type, payload, provider, provider_event_type, provider_event_id)
  VALUES ('paystack:3645:scrub', 'charge.success',
    jsonb_build_object('event', 'charge.success', 'data', jsonb_build_object(
      'reference', 'mingla_scrub', 'authorization', jsonb_build_object(
        'authorization_code', 'AUTH_scrubtest', 'last4', '4081', 'brand', 'visa'))),
    'paystack', 'charge.success', 'paystack:3645:scrub')
  RETURNING id INTO v_id;
  UPDATE public.payment_webhook_events
     SET payload = payload #- '{data,authorization,authorization_code}'
   WHERE provider = 'paystack'
     AND payload #> '{data,authorization,authorization_code}' IS NOT NULL;
  SELECT payload INTO v_payload FROM public.payment_webhook_events WHERE id = v_id;
  IF v_payload #> '{data,authorization,authorization_code}' IS NOT NULL THEN
    RAISE EXCEPTION 'model_9_scrub_left_code';
  END IF;
  IF v_payload #>> '{data,authorization,last4}' <> '4081' THEN
    RAISE EXCEPTION 'model_9_scrub_removed_masked_reference';
  END IF;
END
$scrub$;

ROLLBACK;
