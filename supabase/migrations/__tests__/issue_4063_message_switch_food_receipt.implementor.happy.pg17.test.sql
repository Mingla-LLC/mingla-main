\set ON_ERROR_STOP on
-- MINGLA-INVARIANT: I-4063-OLD-SENDERS-NEVER-SEE-NEW-ROWS | issue #4063 | New message rows are emitted only after the service-role messages_v2 switch is enabled.
-- MINGLA-INVARIANT: I-4063-RECEIPT-NEVER-BLOCKS-PAYMENT | issue #4063 | Food-receipt enqueue failures are warning-only and cannot roll back a venue payment write.

BEGIN;

DO $test$
DECLARE
  v_owner uuid := '40630000-0000-4000-8000-000000005001';
  v_buyer uuid := '40630000-0000-4000-8000-000000005002';
  v_brand uuid := '40630000-0000-4000-8000-000000005003';
  v_venue uuid := '40630000-0000-4000-8000-000000005004';
  v_session uuid := '40630000-0000-4000-8000-000000005005';
  v_order uuid := '40630000-0000-4000-8000-000000005006';
  v_missing_category uuid := '40630000-0000-4000-8000-000000005007';
  v_no_phone uuid := '40630000-0000-4000-8000-000000005008';
  v_venue_collected uuid := '40630000-0000-4000-8000-000000005009';
  v_definition text;
BEGIN
  IF public.issue_4063_switch_on('messages_v2') THEN
    RAISE EXCEPTION 'messages_v2 must be off after migration replay';
  END IF;
  IF has_table_privilege('anon', 'public.issue_4063_switches', 'SELECT')
     OR has_table_privilege('authenticated', 'public.issue_4063_switches', 'SELECT')
     OR has_function_privilege(
       'anon', 'public.issue_4063_switch_on(text)', 'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated', 'public.issue_4063_switch_on(text)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'message switch authority escaped service role';
  END IF;

  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'issue-4063-food-owner@example.test'),
    (v_buyer, 'issue-4063-food-buyer@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_owner);
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, default_currency
  ) VALUES (
    v_brand, v_owner, 'Issue 4063 food brand', 'issue-4063-food-brand',
    'stripe', 'USD'
  );
  INSERT INTO public.venue_listings(
    id, brand_id, slug, name, lat, lng, venue_category
  ) VALUES (
    v_venue, v_brand, 'issue4063food', 'Issue 4063 Kitchen',
    40.7, -74.0, 'restaurant'
  );
  INSERT INTO public.venue_order_sessions(
    id, brand_id, venue_id, currency
  ) VALUES (v_session, v_brand, v_venue, 'USD');

  INSERT INTO public.notification_categories(
    key, section, is_transactional, urgency, default_channels, reach_mode, active
  ) VALUES (
    'buyer_venue_order_receipt', 'Orders', true, 'high',
    ARRAY['sms']::text[], 'reach_once', true
  ) ON CONFLICT (key) DO NOTHING;

  -- Switch off is byte-for-byte the previous behavior: payment succeeds and
  -- this new producer emits no row.
  INSERT INTO public.venue_orders(
    id, session_id, brand_id, venue_id, source, pickup_code, buyer_user_id,
    buyer_name, buyer_email, buyer_phone_e164, money_path, currency,
    subtotal_cents, service_charge_bps, service_charge_cents, tip_cents,
    effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
    platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, tax_amount_cents, total_cents, provider,
    payment_status, confirmed_at, idempotency_key
  ) VALUES (
    v_order, v_session, v_brand, v_venue, 'guest_page', '63', v_buyer,
    'Food buyer', 'food-buyer@example.test', '+12025550163',
    'mingla', 'USD', 1500, 0, 0, 0, 0, 0, 0, 0,
    false, false, false, 1500, 0, 1500, 'stripe', 'paid', now(),
    'issue-4063-food-off'
  );
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
     WHERE idempotency_key = 'buyer_venue_order_receipt:' || v_order || ':sms'
  ) THEN
    RAISE EXCEPTION 'food receipt escaped while messages_v2 was off';
  END IF;

  UPDATE public.issue_4063_switches
     SET enabled = true, changed_at = now()
   WHERE name = 'messages_v2';
  IF NOT public.issue_4063_switch_on('messages_v2') THEN
    RAISE EXCEPTION 'messages_v2 did not turn on';
  END IF;

  -- A transition into paid+confirmed produces one dedicated SMS row.
  UPDATE public.venue_orders
     SET payment_status = 'pending', confirmed_at = NULL
   WHERE id = v_order;
  UPDATE public.venue_orders
     SET payment_status = 'paid', confirmed_at = now()
   WHERE id = v_order;
  IF NOT EXISTS (
    SELECT 1
      FROM public.notification_outbox
     WHERE idempotency_key = 'buyer_venue_order_receipt:' || v_order || ':sms'
       AND category_key = 'buyer_venue_order_receipt'
       AND user_id = v_buyer
       AND contact = '+12025550163'
       AND country_code = 'US'
       AND brand_id = v_brand
       AND payload->>'venue_order_id' = v_order::text
       AND payload->>'venue_id' = v_venue::text
       AND payload->>'venue_name' = 'Issue 4063 Kitchen'
       AND payload->>'pickup_code' = '63'
       AND payload->>'claimed' = 'true'
       AND payload->>'channel_hint' = 'sms'
  ) THEN
    RAISE EXCEPTION 'food receipt row is missing or malformed';
  END IF;

  UPDATE public.venue_orders SET confirmed_at = confirmed_at
   WHERE id = v_order;
  IF (
    SELECT count(*) FROM public.notification_outbox
     WHERE idempotency_key = 'buyer_venue_order_receipt:' || v_order || ':sms'
  ) <> 1 THEN
    RAISE EXCEPTION 'food receipt enqueue was not idempotent';
  END IF;

  -- No phone and venue-collected money never emit a receipt message.
  INSERT INTO public.venue_orders(
    id, session_id, brand_id, venue_id, source, pickup_code, buyer_name,
    buyer_email, buyer_phone_e164, money_path, currency, subtotal_cents,
    service_charge_bps, service_charge_cents, tip_cents,
    effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
    platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, tax_amount_cents, total_cents, provider,
    payment_status, confirmed_at, idempotency_key
  ) VALUES
    (
      v_no_phone, v_session, v_brand, v_venue, 'guest_page', '64',
      'No phone', 'no-phone@example.test', '', 'mingla', 'USD', 1000,
      0, 0, 0, 0, 0, 0, 0, false, false, false, 1000, 0, 1000,
      'stripe', 'paid', now(), 'issue-4063-food-no-phone'
    ),
    (
      v_venue_collected, v_session, v_brand, v_venue, 'guest_page', '65',
      'Venue buyer', NULL, '+12025550165', 'venue_collected', 'USD', 1000,
      0, 0, 0, 0, 0, 0, 0, false, false, false, 1000, 0, 1000,
      NULL, 'paid', now(), 'issue-4063-food-venue-collected'
    );
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
     WHERE idempotency_key IN (
       'buyer_venue_order_receipt:' || v_no_phone || ':sms',
       'buyer_venue_order_receipt:' || v_venue_collected || ':sms'
     )
  ) THEN
    RAISE EXCEPTION 'ineligible food order emitted a receipt';
  END IF;

  -- Removing category data simulates a switch/category rollout race. The
  -- payment transition must still commit; the trigger catches the FK error.
  DELETE FROM public.notification_outbox
   WHERE category_key = 'buyer_venue_order_receipt';
  DELETE FROM public.notification_categories
   WHERE key = 'buyer_venue_order_receipt';
  INSERT INTO public.venue_orders(
    id, session_id, brand_id, venue_id, source, pickup_code, buyer_name,
    buyer_email, buyer_phone_e164, money_path, currency, subtotal_cents,
    service_charge_bps, service_charge_cents, tip_cents,
    effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
    platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, tax_amount_cents, total_cents, provider,
    payment_status, confirmed_at, idempotency_key
  ) VALUES (
    v_missing_category, v_session, v_brand, v_venue, 'guest_page', '66',
    'Missing category', 'missing-category@example.test', '+12025550166',
    'mingla', 'USD', 1000, 0, 0, 0, 0, 0, 0, 0,
    false, false, false, 1000, 0, 1000, 'stripe', 'paid', now(),
    'issue-4063-food-missing-category'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_orders
     WHERE id = v_missing_category AND payment_status = 'paid'
  ) THEN
    RAISE EXCEPTION 'missing notification category rolled back payment write';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
     WHERE idempotency_key =
       'buyer_venue_order_receipt:' || v_missing_category || ':sms'
  ) THEN
    RAISE EXCEPTION 'receipt row exists without its category';
  END IF;

  SELECT pg_get_functiondef(
    'public.tg_venue_orders_a4063_receipt()'::regprocedure
  ) INTO v_definition;
  IF position('issue_4063_receipt_enqueue_failed' IN v_definition) = 0
     OR position('EXCEPTION' IN upper(v_definition)) = 0 THEN
    RAISE EXCEPTION 'receipt producer lost its warning-only failure boundary';
  END IF;
END;
$test$;

ROLLBACK;
