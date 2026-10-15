\set ON_ERROR_STOP on

-- Issue #3859 slice 4A isolated PostgreSQL proof. All fixtures roll back.
BEGIN;

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_plan_ticket uuid := gen_random_uuid();
  v_full_ticket uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_attempt uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_key text;
  v_schedule jsonb;
  v_result jsonb;
  v_conflict boolean := false;
BEGIN
  INSERT INTO auth.users(id, email)
  VALUES (v_owner, 'issue-3859-v2-' || v_owner || '@example.test');
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'issue-3859-v2-' || v_owner || '@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, default_currency,
    payment_provider, payment_country, pricing_region, pricing_currency
  ) VALUES (
    v_brand, v_owner, 'Issue 3859 v2', 'issue-3859-v2-' || v_brand,
    'USD', 'stripe', 'US', 'US', 'USD'
  );
  INSERT INTO public.events(
    id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency
  ) VALUES (
    v_event, v_brand, v_owner, 'Issue 3859 mixed trip',
    'issue-3859-v2-trip-' || v_event, 'trip', 'draft', 'public', 'UTC', 'USD'
  );
  INSERT INTO public.ticket_types(
    id, event_id, name, price_cents, currency, is_free, quantity_total,
    min_purchase_qty, available_online, available_in_person
  ) VALUES
    (v_plan_ticket, v_event, 'Plan', 10000, 'USD', false, 20, 1, true, false),
    (v_full_ticket, v_event, 'Full', 20000, 'USD', false, 20, 1, true, false);

  v_key := 'ticket_checkout:v2:' || v_event || ':' || v_attempt;
  INSERT INTO public.ticket_checkout_sessions(
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
    marketing_opt_in, subtotal_cents, total_cents, currency, status,
    idempotency_key, cart_fingerprint, expires_at
  ) VALUES (
    v_session, v_event, v_brand, 'Buyer', 'buyer@example.test', '+15555550123',
    true, 50000, 50000, 'USD', 'requires_payment', v_key, 'legacy', now() + interval '15 minutes'
  );
  INSERT INTO public.ticket_checkout_session_items(
    checkout_session_id, ticket_type_id, ticket_name_at_purchase,
    quantity, unit_price_cents, total_cents
  ) VALUES
    (v_session, v_plan_ticket, 'Plan', 1, 10000, 10000),
    (v_session, v_full_ticket, 'Full', 2, 20000, 40000);

  v_schedule := jsonb_build_object(
    'fullPriceCents', 50000,
    'depositCents', 42500,
    'currency', 'USD',
    'installments', jsonb_build_array(jsonb_build_object(
      'ordinal', 1,
      'pct', 75,
      'amountCents', 7500,
      'dueAt', to_char((now() + interval '30 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'sourceTicketTypeId', v_plan_ticket,
      'sourceOrdinal', 1
    ))
  );

  SELECT public.issue_3859_bind_checkout_contract(
    v_session, v_event, v_key, v_attempt, repeat('a', 64),
    jsonb_build_array(
      jsonb_build_object('ticketTypeId', v_full_ticket, 'quantity', 2, 'paymentPlanChoice', 'full'),
      jsonb_build_object('ticketTypeId', v_plan_ticket, 'quantity', 1, 'paymentPlanChoice', 'installments')
    ),
    42500, 50000, v_schedule
  ) INTO v_result;
  IF v_result->>'outcome' <> 'bound'
     OR (SELECT total_cents FROM public.ticket_checkout_sessions WHERE id=v_session) <> 42500
     OR (SELECT payment_plan_choice FROM public.ticket_checkout_session_items
          WHERE checkout_session_id=v_session AND ticket_type_id=v_plan_ticket) <> 'installments'
     OR (SELECT payment_plan_choice FROM public.ticket_checkout_session_items
          WHERE checkout_session_id=v_session AND ticket_type_id=v_full_ticket) <> 'full' THEN
    RAISE EXCEPTION 'T-01 FAIL: mixed per-line authority was not bound: %', v_result;
  END IF;

  SELECT public.issue_3859_bind_checkout_contract(
    v_session, v_event, v_key, v_attempt, repeat('a', 64),
    jsonb_build_array(
      jsonb_build_object('ticketTypeId', v_plan_ticket, 'quantity', 1, 'paymentPlanChoice', 'installments'),
      jsonb_build_object('ticketTypeId', v_full_ticket, 'quantity', 2, 'paymentPlanChoice', 'full')
    ),
    42500, 50000, v_schedule
  ) INTO v_result;
  IF v_result->>'outcome' <> 'reconciled' THEN
    RAISE EXCEPTION 'T-02 FAIL: same fingerprint did not reconcile: %', v_result;
  END IF;

  SELECT public.issue_3859_resolve_checkout_attempt(v_event, v_attempt)
    INTO v_result;
  IF v_result->>'checkoutSessionId' <> v_session::text
     OR v_result->>'status' <> 'requires_payment'
     OR jsonb_array_length(v_result->'lineItems') <> 2 THEN
    RAISE EXCEPTION 'T-02b FAIL: bound attempt did not resolve: %', v_result;
  END IF;

  BEGIN
    PERFORM public.issue_3859_bind_checkout_contract(
      v_session, v_event, v_key, v_attempt, repeat('b', 64),
      jsonb_build_array(
        jsonb_build_object('ticketTypeId', v_plan_ticket, 'quantity', 1, 'paymentPlanChoice', 'full'),
        jsonb_build_object('ticketTypeId', v_full_ticket, 'quantity', 2, 'paymentPlanChoice', 'full')
      ),
      50000, 50000, NULL
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM = 'checkout_fingerprint_conflict' THEN v_conflict := true; ELSE RAISE; END IF;
  END;
  IF NOT v_conflict THEN
    RAISE EXCEPTION 'T-03 FAIL: changed canonical input reused the attempt';
  END IF;

  INSERT INTO public.orders(
    id, event_id, buyer_email, buyer_name, buyer_phone, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, checkout_session_id,
    source, notification_status
  ) VALUES (
    v_order, v_event, 'buyer@example.test', 'Buyer', '+15555550123', '+15555550123',
    42500, 'USD', 'online_card', 'paid', v_session, 'online_checkout', 'pending'
  );
  INSERT INTO public.order_line_items(
    order_id, ticket_type_id, quantity, unit_price_cents, total_cents
  ) VALUES
    (v_order, v_plan_ticket, 1, 10000, 10000),
    (v_order, v_full_ticket, 2, 20000, 40000);
  INSERT INTO public.order_installments(
    order_id, ordinal, amount_cents, currency, due_at, status
  ) VALUES (
    v_order, 1, 7500, 'USD', now() + interval '30 days', 'scheduled'
  );
  IF (SELECT payment_plan_choice FROM public.order_line_items
       WHERE order_id=v_order AND ticket_type_id=v_plan_ticket) <> 'installments'
     OR (SELECT payment_plan_choice FROM public.order_line_items
       WHERE order_id=v_order AND ticket_type_id=v_full_ticket) <> 'full'
     OR (SELECT ticket_type_id FROM public.order_installments
       WHERE order_id=v_order AND ordinal=1) <> v_plan_ticket THEN
    RAISE EXCEPTION 'T-04 FAIL: finalize provenance adapters did not copy line identity';
  END IF;

  IF has_function_privilege('anon',
       'public.issue_3859_bind_checkout_contract(uuid,uuid,text,uuid,text,jsonb,integer,integer,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.issue_3859_bind_checkout_contract(uuid,uuid,text,uuid,text,jsonb,integer,integer,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.issue_3859_resolve_checkout_attempt(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.issue_3859_resolve_checkout_attempt(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-05 FAIL: bind authority is exposed to app roles';
  END IF;
  RAISE NOTICE 'issue_3859_checkout_line_authority: PASS';
END
$test$;

ROLLBACK;
