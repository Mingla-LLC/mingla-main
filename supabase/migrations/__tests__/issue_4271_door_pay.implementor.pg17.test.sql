-- Issue #4271 — implementor happy path for 20280404004271_issue_4271_door_pay.sql
-- on the fully replayed PG17 schema.
--
--   P-PERM   owners, event managers and scanners whose switch is on may take
--            door money; a scanner without the switch may not (F6), and the
--            cash door sale now refuses that scanner too.
--   P-NFC    the removed 'nfc' method is refused; pay_code/tap_to_pay are only
--            allowed off the door_sale source, cash only on it.
--   P-QUOTE  the server prices door lines from the ticket types.
--   P-CODE   a paid checkout on a code's session becomes a door card sale:
--            door_payment_method 'pay_code', tickets born used with a scan row,
--            the code paid, one ledger row. A second payment never re-points
--            the code. An expired code refuses a new session.
--   P-TEXT   a code can be texted at most three times.
--   P-TAP    a recorded tap is an online_checkout order with tap_to_pay,
--            tickets born used, a ledger row; replays return the same order.
--   P-TEAM   brand members read each other's names and emails; outsiders
--            are refused.
--   P-RLS    codes are visible to payment takers only.
--
-- FAILS-ON-REVERT: without the migration every call to
-- issue_4271_can_take_door_payment / door_pay_codes fails, and with the old
-- biz_door_sale_record the no-switch scanner's cash sale succeeds.
\set ON_ERROR_STOP on

-- MINGLA-INVARIANT: I-4271-DOOR-CODE-PAYS-ONCE | issue #4271 | a door pay code links at most one paid order; the finalize trigger locks the code row and never re-points a paid code.
-- MINGLA-INVARIANT: I-4271-DOOR-PAYMENT-PERMISSION | issue #4271 | every door money write (cash, manual, pay code, tap) passes issue_4271_can_take_door_payment.
-- MINGLA-INVARIANT: I-4271-DOOR-CARD-ON-RAIL | issue #4271 | pay_code and tap_to_pay orders are never source='door_sale'; cash/manual/card_reader are only ever door_sale.
BEGIN;

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_pay_scanner uuid := gen_random_uuid();
  v_plain_scanner uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_date uuid := gen_random_uuid();
  v_tier uuid := gen_random_uuid();
  v_code_id uuid := gen_random_uuid();
  v_code2_id uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_session2 uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_order2 uuid := gen_random_uuid();
  v_intent uuid := gen_random_uuid();
  v_result jsonb;
  v_text text;
  v_raised text;
  v_count integer;
  v_row record;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_owner, 'owner.w4271@example.test'),
    (v_pay_scanner, 'pay.w4271@example.test'),
    (v_plain_scanner, 'plain.w4271@example.test'),
    (v_outsider, 'out.w4271@example.test');
  INSERT INTO public.creator_accounts (id, email, display_name) VALUES
    (v_owner, 'owner.w4271@example.test', 'Ola Owner'),
    (v_pay_scanner, 'pay.w4271@example.test', 'Pat Payments'),
    (v_plain_scanner, 'plain.w4271@example.test', NULL),
    (v_outsider, 'out.w4271@example.test', 'Otto Outsider');
  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency, pricing_currency,
    payment_provider, payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'Door pay', 'door-pay-'||v_brand, 'USD', 'USD', 'stripe',
    now() - interval '1 day'
  );
  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_brand, v_owner, 'brand_owner', now() - interval '3 days', now() - interval '3 days')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.events (
    id, brand_id, title, slug, event_type, status, visibility, timezone, currency
  ) VALUES (
    v_event, v_brand, 'Door pay night', 'door-pay-'||v_event, 'event', 'live', 'public',
    'UTC', 'USD'
  );
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master, occurrence_key)
  VALUES (v_date, v_event, now() - interval '1 hour', now() + interval '3 hours', 'UTC', true, 'one');
  INSERT INTO public.ticket_types (
    id, event_id, name, price_cents, currency, quantity_total, is_unlimited,
    available_online, available_in_person, is_disabled, is_hidden
  ) VALUES (
    v_tier, v_event, 'Door entry', 2000, 'USD', 10, false, false, true, false, false
  );
  INSERT INTO public.event_scanners (event_id, user_id, permissions, assigned_by)
  VALUES
    (v_event, v_pay_scanner, '{"canScan":true,"canAcceptPayments":true}'::jsonb, v_owner),
    (v_event, v_plain_scanner, '{"canScan":true,"canAcceptPayments":false}'::jsonb, v_owner);

  -- P-PERM
  IF NOT public.issue_4271_can_take_door_payment(v_event, v_owner) THEN
    RAISE EXCEPTION 'P-PERM owner must take payments';
  END IF;
  IF NOT public.issue_4271_can_take_door_payment(v_event, v_pay_scanner) THEN
    RAISE EXCEPTION 'P-PERM a scanner with the switch on must take payments';
  END IF;
  IF public.issue_4271_can_take_door_payment(v_event, v_plain_scanner) THEN
    RAISE EXCEPTION 'P-PERM a scanner without the switch must not take payments';
  END IF;
  IF public.issue_4271_can_take_door_payment(v_event, v_outsider) THEN
    RAISE EXCEPTION 'P-PERM an outsider must not take payments';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_pay_scanner::text, true);
  IF NOT public.biz_can_take_door_payment(v_event) THEN
    RAISE EXCEPTION 'P-PERM biz_can_take_door_payment must read the caller';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_plain_scanner::text, true);
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_door_sale_record(
      v_event, v_date,
      jsonb_build_array(jsonb_build_object('ticket_type_id', v_tier, 'quantity', 1)),
      'cash', 'Cash Guest', NULL, NULL, NULL, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'door_access_denied' THEN
    RAISE EXCEPTION 'P-PERM cash sale by a no-switch scanner must be refused, got %', v_raised;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_pay_scanner::text, true);
  v_result := public.biz_door_sale_record(
    v_event, v_date,
    jsonb_build_array(jsonb_build_object('ticket_type_id', v_tier, 'quantity', 1)),
    'cash', 'Cash Guest', NULL, NULL, NULL, gen_random_uuid());
  IF jsonb_array_length(v_result->'ticketIds') <> 1 THEN
    RAISE EXCEPTION 'P-PERM a switch-on scanner must record cash, got %', v_result;
  END IF;

  -- P-NFC
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_door_sale_record(
      v_event, v_date,
      jsonb_build_array(jsonb_build_object('ticket_type_id', v_tier, 'quantity', 1)),
      'nfc', NULL, NULL, NULL, NULL, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'door_payment_method_invalid' THEN
    RAISE EXCEPTION 'P-NFC nfc must be refused, got %', v_raised;
  END IF;
  v_raised := NULL;
  BEGIN
    UPDATE public.orders SET door_payment_method = 'pay_code'
     WHERE id = (v_result->>'orderId')::uuid;
  EXCEPTION WHEN check_violation THEN v_raised := 'check'; END;
  IF v_raised IS DISTINCT FROM 'check' THEN
    RAISE EXCEPTION 'P-NFC pay_code must not be allowed on a door_sale order';
  END IF;

  -- P-QUOTE
  v_result := public.issue_4271_door_quote_lines(
    v_event, v_date,
    jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier, 'quantity', 2)));
  IF (v_result->>'subtotalCents')::integer <> 4000 OR v_result->>'currency' <> 'USD'
     OR v_result->'lines'->0->>'name' <> 'Door entry'
     OR (v_result->'lines'->0->>'unitCents')::integer <> 2000 THEN
    RAISE EXCEPTION 'P-QUOTE wrong quote %', v_result;
  END IF;
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_4271_door_quote_lines(
      v_event, v_date,
      jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier, 'quantity', 50)));
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'door_ticket_capacity_exceeded' THEN
    RAISE EXCEPTION 'P-QUOTE capacity must be checked, got %', v_raised;
  END IF;

  -- P-CODE
  INSERT INTO public.door_pay_codes (
    id, brand_id, event_id, event_date_id, code, lines, currency, subtotal_cents,
    fee_cents, total_cents, provider, created_by
  ) VALUES (
    v_code_id, v_brand, v_event, v_date, 'ABCD2345',
    jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier, 'quantity', 2)),
    'USD', 4000, 180, 4180, 'stripe', v_pay_scanner
  );
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, status, idempotency_key, expires_at
  ) VALUES
    (v_session, v_event, v_brand, 'Phone Guest', 'guest.w4271@example.test',
     '+12025550101', 4180, 'USD', 'awaiting_web_redirect', 'w4271-a-'||v_session,
     now() + interval '15 minutes'),
    (v_session2, v_event, v_brand, 'Phone Guest', 'guest.w4271@example.test',
     '+12025550101', 4180, 'USD', 'awaiting_web_redirect', 'w4271-b-'||v_session2,
     now() + interval '15 minutes');
  v_text := public.issue_4271_door_pay_code_link_session(v_code_id, v_session);
  IF v_text <> 'linked' THEN RAISE EXCEPTION 'P-CODE link failed: %', v_text; END IF;
  v_text := public.issue_4271_door_pay_code_link_session(v_code_id, v_session2);
  IF v_text <> 'linked' THEN RAISE EXCEPTION 'P-CODE relink of an unpaid code failed: %', v_text; END IF;
  -- The first session was left linked too (the guest reopened the page).

  -- Simulate the checkout finalize: an online order with valid tickets, then
  -- the session gets its order_id.
  INSERT INTO public.orders (
    id, event_id, buyer_name, buyer_email, buyer_phone, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, checkout_session_id,
    source, stripe_payment_intent_id, stripe_charge_id
  ) VALUES (
    v_order, v_event, 'Phone Guest', 'guest.w4271@example.test', '+12025550101',
    '+12025550101', 4180, 'USD', 'online_card', 'paid', v_session2,
    'online_checkout', 'pi_w4271a', 'ch_w4271a'
  );
  INSERT INTO public.tickets (id, order_id, ticket_type_id, event_id, qr_code, status)
  SELECT gen_random_uuid(), v_order, v_tier, v_event, 'w4271-a-'||g, 'valid'
    FROM generate_series(1, 2) g;
  UPDATE public.ticket_checkout_sessions SET order_id = v_order WHERE id = v_session2;

  SELECT * INTO v_row FROM public.orders WHERE id = v_order;
  IF v_row.door_payment_method IS DISTINCT FROM 'pay_code'
     OR v_row.door_pay_code_id IS DISTINCT FROM v_code_id
     OR v_row.source <> 'online_checkout' THEN
    RAISE EXCEPTION 'P-CODE order not marked as a pay-code door sale: % % %',
      v_row.door_payment_method, v_row.door_pay_code_id, v_row.source;
  END IF;
  SELECT count(*) INTO v_count FROM public.tickets
   WHERE order_id = v_order AND status = 'used' AND used_by_scanner_id = v_pay_scanner;
  IF v_count <> 2 THEN RAISE EXCEPTION 'P-CODE tickets must be born used, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.scan_events s
    JOIN public.tickets t ON t.id = s.ticket_id
   WHERE t.order_id = v_order AND s.scan_result = 'success';
  IF v_count <> 2 THEN RAISE EXCEPTION 'P-CODE scan rows missing, got %', v_count; END IF;
  SELECT * INTO v_row FROM public.door_pay_codes WHERE id = v_code_id;
  IF v_row.status <> 'paid' OR v_row.order_id IS DISTINCT FROM v_order OR v_row.paid_at IS NULL THEN
    RAISE EXCEPTION 'P-CODE code not paid: % %', v_row.status, v_row.order_id;
  END IF;
  SELECT count(*) INTO v_count FROM public.door_sales_ledger
   WHERE order_id = v_order AND payment_method = 'pay_code' AND amount_cents = 4180;
  IF v_count <> 1 THEN RAISE EXCEPTION 'P-CODE ledger row missing'; END IF;

  -- A paid code refuses a new session.
  v_text := public.issue_4271_door_pay_code_link_session(v_code_id, v_session);
  IF v_text <> 'paid' THEN RAISE EXCEPTION 'P-CODE a paid code must refuse, got %', v_text; END IF;

  -- Paying the code closed the guest's other tab (#4271 D4): it is revoked
  -- and queued for the revocation worker, so the provider page expires.
  IF NOT EXISTS (SELECT 1 FROM public.ticket_checkout_sessions
                  WHERE id = v_session AND revoked_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.checkout_sale_revocation_outbox
                     WHERE subject_id = v_session) THEN
    RAISE EXCEPTION 'P-CODE the other tab must be revoked once the code is paid';
  END IF;

  -- A second payment on the other session never re-points the code.
  INSERT INTO public.orders (
    id, event_id, buyer_name, buyer_email, buyer_phone, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, checkout_session_id,
    source, stripe_payment_intent_id, stripe_charge_id
  ) VALUES (
    v_order2, v_event, 'Phone Guest', 'guest.w4271@example.test', '+12025550101',
    '+12025550101', 4180, 'USD', 'online_card', 'paid', v_session,
    'online_checkout', 'pi_w4271b', 'ch_w4271b'
  );
  INSERT INTO public.tickets (id, order_id, ticket_type_id, event_id, qr_code, status)
  VALUES (gen_random_uuid(), v_order2, v_tier, v_event, 'w4271-b-1', 'valid');
  UPDATE public.ticket_checkout_sessions SET order_id = v_order2 WHERE id = v_session;
  SELECT * INTO v_row FROM public.orders WHERE id = v_order2;
  IF v_row.door_pay_code_id IS NOT NULL OR v_row.door_payment_method IS NOT NULL
     OR NOT coalesce((v_row.metadata ->> 'door_pay_code_late')::boolean, false) THEN
    RAISE EXCEPTION 'P-CODE a second payment must stay an ordinary order';
  END IF;
  IF (SELECT order_id FROM public.door_pay_codes WHERE id = v_code_id) IS DISTINCT FROM v_order THEN
    RAISE EXCEPTION 'P-CODE the paid code was re-pointed';
  END IF;

  -- An expired code refuses and is persisted as expired.
  INSERT INTO public.door_pay_codes (
    id, brand_id, event_id, code, lines, currency, subtotal_cents, total_cents,
    provider, created_by, expires_at
  ) VALUES (
    v_code2_id, v_brand, v_event, 'WXYZ6789',
    jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier, 'quantity', 1)),
    'USD', 2000, 2000, 'stripe', v_owner, now() - interval '1 minute'
  );
  v_text := public.issue_4271_door_pay_code_link_session(v_code2_id, v_session);
  IF v_text <> 'expired'
     OR (SELECT status FROM public.door_pay_codes WHERE id = v_code2_id) <> 'expired' THEN
    RAISE EXCEPTION 'P-CODE expired code must refuse, got %', v_text;
  END IF;

  -- P-TEXT
  UPDATE public.door_pay_codes SET expires_at = now() + interval '5 minutes', status = 'open'
   WHERE id = v_code2_id;
  FOR v_count IN 1..3 LOOP
    v_result := public.issue_4271_door_pay_code_text_link(
      v_code2_id, '+12025550199', 'https://host.usemingla.com/pay/door/WXYZ6789');
  END LOOP;
  IF (v_result->>'count')::integer <> 3 THEN RAISE EXCEPTION 'P-TEXT count %', v_result; END IF;
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_4271_door_pay_code_text_link(
      v_code2_id, '+12025550199', 'https://host.usemingla.com/pay/door/WXYZ6789');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'text_link_limit_reached' THEN
    RAISE EXCEPTION 'P-TEXT a fourth text must be refused, got %', v_raised;
  END IF;
  SELECT count(*) INTO v_count FROM public.notification_outbox
   WHERE category_key = 'buyer_door_pay_link' AND contact = '+12025550199';
  IF v_count <> 3 THEN RAISE EXCEPTION 'P-TEXT expected 3 outbox rows, got %', v_count; END IF;

  -- P-TAP
  INSERT INTO public.door_tap_intents (
    id, brand_id, event_id, event_date_id, client_request_id, lines, currency,
    subtotal_cents, fee_cents, total_cents, application_fee_cents,
    stripe_account_id, stripe_payment_intent_id, created_by
  ) VALUES (
    v_intent, v_brand, v_event, v_date, gen_random_uuid(),
    jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_tier, 'quantity', 1, 'unitCents', 2000, 'name', 'Door entry')),
    'USD', 2000, 90, 2090, 90, 'acct_w4271', 'pi_w4271tap', v_pay_scanner
  );
  v_result := public.biz_door_tap_record('pi_w4271tap', 'ch_w4271tap', 2090, 'visa', '4242');
  IF (v_result->>'replayed')::boolean OR jsonb_array_length(v_result->'ticketIds') <> 1 THEN
    RAISE EXCEPTION 'P-TAP wrong result %', v_result;
  END IF;
  SELECT * INTO v_row FROM public.orders WHERE id = (v_result->>'orderId')::uuid;
  IF v_row.source <> 'online_checkout' OR v_row.door_payment_method <> 'tap_to_pay'
     OR v_row.stripe_payment_intent_id <> 'pi_w4271tap'
     OR v_row.stripe_application_fee_amount_cents <> 90
     OR v_row.buyer_total_cents <> 2090 THEN
    RAISE EXCEPTION 'P-TAP order shape wrong';
  END IF;
  IF (SELECT status FROM public.tickets WHERE order_id = v_row.id) <> 'used' THEN
    RAISE EXCEPTION 'P-TAP ticket must be born used';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.door_sales_ledger
                  WHERE order_id = v_row.id AND payment_method = 'tap_to_pay') THEN
    RAISE EXCEPTION 'P-TAP ledger row missing';
  END IF;
  v_result := public.biz_door_tap_record('pi_w4271tap', 'ch_w4271tap', 2090, 'visa', '4242');
  IF NOT (v_result->>'replayed')::boolean OR (v_result->>'orderId')::uuid <> v_row.id THEN
    RAISE EXCEPTION 'P-TAP replay must return the same order %', v_result;
  END IF;

  -- P-TEAM
  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_brand, v_pay_scanner, 'scanner', now() - interval '1 day', now() - interval '1 day')
  ON CONFLICT DO NOTHING;
  PERFORM set_config('request.jwt.claim.sub', v_pay_scanner::text, true);
  SELECT count(*) INTO v_count FROM public.biz_brand_team_members(v_brand) t
   WHERE (t.user_id = v_owner AND t.display_name = 'Ola Owner' AND t.email = 'owner.w4271@example.test')
      OR (t.user_id = v_pay_scanner AND t.display_name = 'Pat Payments');
  IF v_count <> 2 THEN RAISE EXCEPTION 'P-TEAM names missing, got %', v_count; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  v_raised := NULL;
  BEGIN
    PERFORM count(*) FROM public.biz_brand_team_members(v_brand);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  IF v_raised IS DISTINCT FROM 'brand_access_denied' THEN
    RAISE EXCEPTION 'P-TEAM an outsider must be refused, got %', v_raised;
  END IF;

  -- P-RLS
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.door_pay_codes WHERE event_id = v_event;
  RESET ROLE;
  IF v_count <> 2 THEN RAISE EXCEPTION 'P-RLS owner must see both codes, got %', v_count; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_plain_scanner::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.door_pay_codes WHERE event_id = v_event;
  RESET ROLE;
  IF v_count <> 0 THEN RAISE EXCEPTION 'P-RLS a no-switch scanner must see none, got %', v_count; END IF;
END;
$test$;

ROLLBACK;
