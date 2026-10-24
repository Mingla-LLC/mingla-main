\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_user uuid := '40630000-0000-4000-8000-000000000401';
  v_brand uuid := '40630000-0000-4000-8000-000000000402';
  v_event uuid := '40630000-0000-4000-8000-000000000403';
  v_order uuid := '40630000-0000-4000-8000-000000000404';
  v_session uuid := '40630000-0000-4000-8000-000000000405';
  v_result jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_user);
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(
    id, account_id, name, slug, default_currency, pricing_currency, payment_provider
  ) VALUES (
    v_brand, v_user, 'Issue 4063 card', 'issue-4063-card', 'USD', 'USD', 'stripe'
  );
  INSERT INTO public.events(
    id, brand_id, title, slug, event_type, status, visibility, timezone, currency
  ) VALUES (
    v_event, v_brand, 'Issue 4063 event', 'issue-4063-card-event',
    'event', 'scheduled', 'public', 'UTC', 'USD'
  );
  INSERT INTO public.orders(
    id, event_id, buyer_email, buyer_phone_e164, total_cents, currency,
    payment_method, payment_status, source
  ) VALUES (
    v_order, v_event, 'buyer@example.test', '+12025550143', 1000, 'USD',
    'online_card', 'paid', 'online_checkout'
  );
  INSERT INTO public.ticket_checkout_sessions(
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
    currency, subtotal_cents, total_cents, status, idempotency_key, expires_at,
    order_id
  ) VALUES (
    v_session, v_event, v_brand, 'Buyer', 'buyer@example.test', '+12025550143',
    'USD', 1000, 1000, 'paid_completed', 'issue-4063-card',
    now() + interval '1 hour', v_order
  );

  v_result := public.issue_4063_record_payment_card(
    v_session, 'American Express', '4242', 'apple_pay'
  );
  IF v_result->>'outcome' <> 'recorded' THEN
    RAISE EXCEPTION 'expected recorded, got %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ticket_checkout_sessions
     WHERE id = v_session AND payment_card_brand = 'amex'
       AND payment_card_last4 = '4242' AND payment_wallet = 'apple_pay'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = v_order AND payment_card_brand = 'amex'
       AND payment_card_last4 = '4242' AND payment_wallet = 'apple_pay'
  ) THEN
    RAISE EXCEPTION 'card display fields were not copied to both rows';
  END IF;

  v_result := public.issue_4063_record_payment_card(
    v_session, 'visa', '9999', 'google_pay'
  );
  IF v_result->>'outcome' <> 'already_recorded' THEN
    RAISE EXCEPTION 'expected first-writer refusal, got %', v_result;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = v_order AND payment_card_last4 <> '4242'
  ) THEN
    RAISE EXCEPTION 'later provider observation rewrote the card';
  END IF;

  v_result := public.issue_4063_record_payment_card(
    v_session, 'visa', '42', NULL
  );
  IF v_result->>'outcome' <> 'invalid' THEN
    RAISE EXCEPTION 'malformed last4 was accepted: %', v_result;
  END IF;

  IF has_function_privilege(
    'anon', 'public.issue_4063_record_payment_card(uuid,text,text,text)', 'EXECUTE'
  ) OR has_function_privilege(
    'authenticated', 'public.issue_4063_record_payment_card(uuid,text,text,text)', 'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role', 'public.issue_4063_record_payment_card(uuid,text,text,text)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'payment card RPC privilege contract is wrong';
  END IF;
END;
$test$;

ROLLBACK;
