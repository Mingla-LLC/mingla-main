-- Issue #4271 rework — implementor happy paths for the four tester defects in
-- 20280404004271_issue_4271_door_pay.sql, on the fully replayed PG17 schema.
--
--   R-ONLINE  (D1) a door-only tier (in person, not online) is priced and
--             authorised inside its own pay code's checkout, and stays
--             refused by every other checkout.
--   R-GUEST-NAME the host's paid screen reads the guest through the door
--             permission, for a scanner who cannot read orders.
--   R-CLAIM   (D2) a Tap to Pay order and a pay-code order on a scheduled
--             event are claimable in Explorer like a cash door sale; an
--             ordinary online order with a used ticket on a scheduled event
--             still is not (no other order kind widened).
--   R-CHECK   (D3) the NULL trap: an ordinary online order without a phone and a
--             door_pay_code_id on a NULL-method order are both refused.
--   R-LATE    (D4) cancelling an opened code revokes its checkout session,
--             queues the provider page for expiry and returns it for the edge
--             to expire now; a payment that still lands is refused at
--             finalize, makes no order, leaves the code cancelled and queues a
--             full late-payment refund the host sees on the code. A paid code
--             revokes the guest's other tabs.
--
-- FAILS-ON-REVERT (verified by the implementor, line deletion):
--   * drop the issue_4271_door_code_unlocks_tier clause from
--     issue_3872_ticket_line_price -> R-ONLINE fails;
--   * restore `o.source = 'door_sale'` in claim_attendance_by_verified_identity
--     -> R-CLAIM fails;
--   * restore `door_payment_method = 'tap_to_pay'` in
--     orders_online_checkout_phone_e164_check -> R-CHECK fails;
--   * drop the issue_4271_door_revoke_code_sessions call from
--     issue_4271_door_pay_code_revoke -> R-LATE fails.

\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_guest uuid := gen_random_uuid();
  v_scanner_on uuid := gen_random_uuid();
  v_scanner_off uuid := gen_random_uuid();
  v_late_code uuid;
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_event_sched uuid := gen_random_uuid();
  v_date uuid := gen_random_uuid();
  v_date_sched uuid := gen_random_uuid();
  v_tier_door uuid := gen_random_uuid();
  v_tier_both uuid := gen_random_uuid();
  v_tier_sched uuid := gen_random_uuid();
  v_code uuid;
  v_session uuid;
  v_session2 uuid;
  v_order uuid;
  v_attempt uuid;
  v_epoch bigint;
  v_claim jsonb;
  v_result jsonb;
  v_raised text;
  v_count integer;
BEGIN
  -- ---------------------------------------------------------------- fixtures
  INSERT INTO auth.users (id, email) VALUES
    (v_owner, 'owner.r4271@example.test'),
    (v_guest, 'guest.r4271@example.test');
  INSERT INTO public.creator_accounts (id, email, display_name)
  VALUES (v_owner, 'owner.r4271@example.test', 'Rae Owner');
  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency, pricing_currency,
    payment_provider, payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'Rework door', 'rework-door-'||v_brand, 'USD', 'USD', 'stripe',
    now() - interval '1 day'
  );
  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_brand, v_owner, 'brand_owner', now() - interval '9 days', now() - interval '9 days')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.events (
    id, brand_id, title, slug, event_type, status, visibility, timezone, currency
  ) VALUES
    (v_event, v_brand, 'Rework live', 'rework-live-'||v_event, 'event', 'live', 'public', 'UTC', 'USD'),
    (v_event_sched, v_brand, 'Rework early', 'rework-early-'||v_event_sched, 'event', 'scheduled', 'public', 'UTC', 'USD');
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master, occurrence_key)
  VALUES
    (v_date, v_event, now() - interval '1 hour', now() + interval '3 hours', 'UTC', true, 'one'),
    (v_date_sched, v_event_sched, now() + interval '30 minutes', now() + interval '5 hours', 'UTC', true, 'one');
  INSERT INTO public.ticket_types (
    id, event_id, name, price_cents, currency, quantity_total, is_unlimited,
    available_online, available_in_person, is_disabled, is_hidden
  ) VALUES
    (v_tier_door, v_event, 'Door only', 2000, 'USD', 50, false, false, true, false, false),
    (v_tier_both, v_event, 'General', 1500, 'USD', 50, false, true, true, false, false),
    (v_tier_sched, v_event_sched, 'Early door', 1500, 'USD', 50, false, true, true, false, false);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- ---------------------------------------------------------------- R-ONLINE
  v_code := gen_random_uuid();
  INSERT INTO public.door_pay_codes (
    id, brand_id, event_id, event_date_id, code, lines, currency, subtotal_cents,
    fee_cents, total_cents, provider, created_by
  ) VALUES (
    v_code, v_brand, v_event, NULL, 'RDNY2345',
    jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_door, 'quantity', 2)),
    'USD', 4000, 180, 4180, 'stripe', v_owner
  );
  v_result := public.issue_4271_door_ticket_quote(
    v_code, v_event, jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_door, 'quantity', 2)),
    NULL, NULL, NULL, NULL, 'full', NULL, 'guest.r4271@example.test', '+12025550160', NULL, false);
  IF (v_result->>'netSubtotalCents')::bigint <> 4000 THEN
    RAISE EXCEPTION 'R-ONLINE the door quote must price the code''s lines, got %', v_result;
  END IF;
  IF current_setting('mingla.door_pay_code_id', true) <> '' THEN
    RAISE EXCEPTION 'R-ONLINE the door unlock leaked past its call';
  END IF;
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3872_ticket_quote(
      v_event, jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_door, 'quantity', 2)),
      NULL, NULL, NULL, NULL, 'full', NULL, 'guest.r4271@example.test', '+12025550160',
      NULL, NULL, false);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  IF v_raised IS DISTINCT FROM 'ticket_type_unavailable' THEN
    RAISE EXCEPTION 'R-ONLINE the online quote must refuse a door-only tier, got %', coalesce(v_raised, 'accepted');
  END IF;
  -- The code's lines only: another basket is refused by the wrapper.
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_4271_door_ticket_quote(
      v_code, v_event, jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_both, 'quantity', 2)),
      NULL, NULL, NULL, NULL, 'full', NULL, 'guest.r4271@example.test', '+12025550160', NULL, false);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  IF v_raised IS DISTINCT FROM 'door_code_unavailable:lines' THEN
    RAISE EXCEPTION 'R-ONLINE a basket that is not the code''s must be refused, got %', coalesce(v_raised, 'accepted');
  END IF;
  -- Finalize authorisation: the door session may hold the door-only tier.
  v_session := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, status, idempotency_key, expires_at
  ) VALUES (
    v_session, v_event, v_brand, 'Door Guest', 'guest.r4271@example.test', '+12025550160',
    4180, 'USD', 'awaiting_web_redirect', 'r4271-online-'||v_session, now() + interval '15 minutes'
  );
  INSERT INTO public.ticket_checkout_session_items (
    checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity, unit_price_cents, total_cents
  ) VALUES (v_session, v_tier_door, 'Door only', 2, 2000, 4000);
  IF public.issue_1930_ticket_session_authorized(v_session, v_event) THEN
    RAISE EXCEPTION 'R-ONLINE a session with no door code must not hold a door-only tier';
  END IF;
  IF public.issue_4271_door_pay_code_link_session(v_code, v_session) <> 'linked' THEN
    RAISE EXCEPTION 'R-ONLINE the code must link';
  END IF;
  IF NOT public.issue_1930_ticket_session_authorized(v_session, v_event) THEN
    RAISE EXCEPTION 'R-ONLINE the code''s own session must be authorised for its door-only tier';
  END IF;

  -- ----------------------------------------------------------------- R-CHECK
  BEGIN
    INSERT INTO public.orders (
      id, event_id, buyer_name, buyer_email, total_cents, currency, payment_method,
      payment_status, source, stripe_payment_intent_id, stripe_charge_id
    ) VALUES (
      gen_random_uuid(), v_event, 'No phone', 'nophone.r4271@example.test', 1500, 'USD',
      'online_card', 'paid', 'online_checkout', 'pi_r4271nophone', 'ch_r4271nophone'
    );
    RAISE EXCEPTION 'R-CHECK an ordinary online order without a phone was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.orders (
      id, event_id, buyer_name, buyer_email, buyer_phone, buyer_phone_e164, total_cents,
      currency, payment_method, payment_status, source, stripe_payment_intent_id,
      stripe_charge_id, door_pay_code_id
    ) VALUES (
      gen_random_uuid(), v_event, 'Shape', 'shape.r4271@example.test', '+12025550161',
      '+12025550161', 1500, 'USD', 'online_card', 'paid', 'online_checkout',
      'pi_r4271shape', 'ch_r4271shape', v_code
    );
    RAISE EXCEPTION 'R-CHECK a door_pay_code_id on a NULL-method order was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ------------------------------------------------------------------ R-LATE
  -- The guest is on Stripe's page: a claimed, committed stripe_checkout attempt.
  UPDATE public.ticket_checkout_sessions
     SET stripe_account_id = 'acct_r4271', stripe_checkout_session_id = 'cs_r4271late',
         stripe_payment_intent_id = 'pi_r4271late', application_fee_amount_cents = 180
   WHERE id = v_session;
  v_claim := public.issue_1930_claim_ticket_provider_attempt(
    v_session, v_event, 'stripe', 'stripe_checkout', 'r4271-late-fingerprint');
  IF v_claim->>'outcome' <> 'fresh_claim' THEN
    RAISE EXCEPTION 'R-LATE provider claim failed: %', v_claim;
  END IF;
  v_attempt := (v_claim->>'attemptId')::uuid;
  v_epoch := (v_claim->>'epoch')::bigint;
  PERFORM public.issue_1930_commit_ticket_provider_attempt(
    v_attempt, v_epoch, NULL, 'cs_r4271late', 'pi_r4271late', 'r4271-late-continuation');

  v_result := public.issue_4271_door_pay_code_revoke(v_code, 'cancelled');
  IF v_result->>'status' <> 'cancelled'
     OR jsonb_array_length(v_result->'stripeExpire') <> 1
     OR v_result->'stripeExpire'->0->>'checkoutSessionId' <> 'cs_r4271late'
     OR v_result->'stripeExpire'->0->>'stripeAccountId' <> 'acct_r4271'
     OR v_result->'stripeExpire'->0->>'idempotencyKey' NOT LIKE '%:expire' THEN
    RAISE EXCEPTION 'R-LATE cancel must hand back the page to expire, got %', v_result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_checkout_sessions
                  WHERE id = v_session AND revoked_at IS NOT NULL AND status = 'failed'
                    AND revoked_reason = 'door_code_cancelled') THEN
    RAISE EXCEPTION 'R-LATE the guest''s checkout session was not revoked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.checkout_sale_revocation_outbox
                  WHERE subject_type = 'ticket_checkout_session' AND subject_id = v_session
                    AND state = 'queued') THEN
    RAISE EXCEPTION 'R-LATE the provider page was not queued for the revocation worker';
  END IF;
  IF public.issue_1930_ticket_session_authorized(v_session, v_event) THEN
    RAISE EXCEPTION 'R-LATE a cancelled code''s session is still authorised';
  END IF;
  -- The payment lands anyway (the guest pressed Pay as the host cancelled).
  v_result := public.biz_ticket_checkout_finalize(
    v_session, 'pi_r4271late', 'ch_r4271late', 'card', 'r4271-pepper');
  IF v_result->>'outcome' <> 'paid_reversal_pending' THEN
    RAISE EXCEPTION 'R-LATE a late payment must go to the late refund, got %', v_result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE checkout_session_id = v_session) THEN
    RAISE EXCEPTION 'R-LATE a late payment made an order';
  END IF;
  IF (SELECT status FROM public.door_pay_codes WHERE id = v_code) <> 'cancelled' THEN
    RAISE EXCEPTION 'R-LATE a late payment changed the cancelled code';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.source_refunds
                  WHERE source_type = 'ticket_checkout_session' AND source_id = v_session
                    AND refund_kind = 'late_payment_no_value'
                    AND buyer_refund_requested_cents = 4180
                    AND buyer_state = 'queued') THEN
    RAISE EXCEPTION 'R-LATE no full late-payment refund was queued';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_result := public.biz_door_pay_code_late_payment(v_code);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_result->>'state' <> 'refunding' OR (v_result->>'amountCents')::integer <> 4180 THEN
    RAISE EXCEPTION 'R-LATE the host must see the refund on the code, got %', v_result;
  END IF;
  v_late_code := v_code;

  -- Another tab is closed once the code is paid.
  v_code := gen_random_uuid();
  INSERT INTO public.door_pay_codes (
    id, brand_id, event_id, event_date_id, code, lines, currency, subtotal_cents,
    fee_cents, total_cents, provider, created_by
  ) VALUES (
    v_code, v_brand, v_event, v_date, 'RTBS2345',
    jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_both, 'quantity', 1)),
    'USD', 1500, 70, 1570, 'stripe', v_owner
  );
  v_session := gen_random_uuid();
  v_session2 := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, status, idempotency_key, expires_at
  ) VALUES
    (v_session, v_event, v_brand, 'Tab one', 'tab.r4271@example.test', '+12025550162',
     1570, 'USD', 'awaiting_web_redirect', 'r4271-tab1-'||v_session, now() + interval '15 minutes'),
    (v_session2, v_event, v_brand, 'Tab two', 'tab.r4271@example.test', '+12025550162',
     1570, 'USD', 'awaiting_web_redirect', 'r4271-tab2-'||v_session2, now() + interval '15 minutes');
  PERFORM public.issue_4271_door_pay_code_link_session(v_code, v_session);
  PERFORM public.issue_4271_door_pay_code_link_session(v_code, v_session2);
  v_order := gen_random_uuid();
  INSERT INTO public.orders (
    id, event_id, buyer_name, buyer_email, buyer_phone, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, checkout_session_id,
    source, stripe_payment_intent_id, stripe_charge_id
  ) VALUES (
    v_order, v_event, 'Tab one', 'tab.r4271@example.test', '+12025550162', '+12025550162',
    1570, 'USD', 'online_card', 'paid', v_session, 'online_checkout', 'pi_r4271tab', 'ch_r4271tab'
  );
  UPDATE public.ticket_checkout_sessions SET order_id = v_order WHERE id = v_session;
  IF (SELECT status FROM public.door_pay_codes WHERE id = v_code) <> 'paid' THEN
    RAISE EXCEPTION 'R-LATE the first payment must pay the code';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_checkout_sessions
                  WHERE id = v_session2 AND revoked_at IS NOT NULL
                    AND revoked_reason = 'door_code_paid') THEN
    RAISE EXCEPTION 'R-LATE the guest''s other tab is still payable after the code was paid';
  END IF;
  IF (public.issue_4271_door_pay_code_revoke(v_code, 'cancelled'))->>'status' <> 'paid' THEN
    RAISE EXCEPTION 'R-LATE a paid code must never be cancelled';
  END IF;

  -- ------------------------------------------------------------ R-GUEST-NAME
  -- A scanner with the switch on reaches the paid screen but cannot read
  -- orders, so the name must come through the door permission.
  INSERT INTO auth.users (id, email) VALUES
    (v_scanner_on, 'scanner.on.r4271@example.test'),
    (v_scanner_off, 'scanner.off.r4271@example.test');
  INSERT INTO public.event_scanners (event_id, user_id, permissions, assigned_by) VALUES
    (v_event, v_scanner_on, '{"canScan":true,"canAcceptPayments":true}'::jsonb, v_owner),
    (v_event, v_scanner_off, '{"canScan":true,"canAcceptPayments":false}'::jsonb, v_owner);
  IF public.biz_can_read_order(v_order, v_scanner_on) THEN
    RAISE EXCEPTION 'R-GUEST-NAME fixture: this scanner was meant to be unable to read orders';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_scanner_on::text, true);
  IF public.biz_door_pay_code_guest_name(v_code) IS DISTINCT FROM 'Tab one' THEN
    RAISE EXCEPTION 'R-GUEST-NAME a scanner allowed to take payments must see the guest, got %',
      public.biz_door_pay_code_guest_name(v_code);
  END IF;
  v_result := public.biz_door_pay_code_late_payment(v_late_code);
  IF v_result->>'state' <> 'refunding' THEN
    RAISE EXCEPTION 'R-GUEST-NAME the same scanner must see a late payment, got %', v_result;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_scanner_off::text, true);
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_door_pay_code_guest_name(v_code);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  IF v_raised IS DISTINCT FROM 'door_access_denied' THEN
    RAISE EXCEPTION 'R-GUEST-NAME a scanner without the switch must be refused, got %', coalesce(v_raised, 'allowed');
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  -- An order with no name is a real walk-up: NULL, not an empty string.
  UPDATE public.orders SET buyer_name = '  ' WHERE id = v_order;
  IF public.biz_door_pay_code_guest_name(v_code) IS NOT NULL THEN
    RAISE EXCEPTION 'R-GUEST-NAME a nameless order must read as no name';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- ----------------------------------------------------------------- R-CLAIM
  INSERT INTO public.verified_phone_identities (user_id, phone_e164) VALUES (v_guest, '+12025550188');
  -- A Tap to Pay order on the scheduled event (doors open early).
  INSERT INTO public.door_tap_intents (
    id, brand_id, event_id, event_date_id, client_request_id, lines, currency,
    subtotal_cents, fee_cents, total_cents, application_fee_cents,
    stripe_account_id, stripe_payment_intent_id, created_by, buyer_phone_e164
  ) VALUES (
    gen_random_uuid(), v_brand, v_event_sched, v_date_sched, gen_random_uuid(),
    jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_tier_sched, 'quantity', 1, 'unitCents', 1500, 'name', 'Early door')),
    'USD', 1500, 70, 1570, 70, 'acct_r4271', 'pi_r4271claimtap', v_owner, '+12025550188'
  );
  v_result := public.biz_door_tap_record('pi_r4271claimtap', 'ch_r4271claimtap', 1570, 'visa', '4242');
  v_order := (v_result->>'orderId')::uuid;
  -- An ordinary online order on the same event whose ticket was scanned: the
  -- online rule (valid tickets only on a scheduled event) is unchanged.
  INSERT INTO public.orders (
    id, event_id, buyer_name, buyer_email, buyer_phone, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source,
    stripe_payment_intent_id, stripe_charge_id
  ) VALUES (
    gen_random_uuid(), v_event_sched, 'Online', 'online.r4271@example.test', '+12025550188',
    '+12025550188', 1500, 'USD', 'online_card', 'paid', 'online_checkout',
    'pi_r4271online', 'ch_r4271online'
  ) RETURNING id INTO v_session2;
  INSERT INTO public.tickets (id, order_id, ticket_type_id, event_id, qr_code, status, approval_status)
  VALUES (gen_random_uuid(), v_session2, v_tier_sched, v_event_sched, 'r4271-online-used', 'used', 'auto');
  v_result := public.claim_attendance_by_verified_identity(v_guest);
  IF (SELECT buyer_user_id FROM public.orders WHERE id = v_order) IS DISTINCT FROM v_guest THEN
    RAISE EXCEPTION 'R-CLAIM a Tap to Pay order on a scheduled event was not claimed: %', v_result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'claimed') c
                  WHERE c->>'orderId' = v_order::text AND c->>'source' = 'door' AND c->>'noun' = 'receipt') THEN
    RAISE EXCEPTION 'R-CLAIM a card door order must read as a door receipt: %', v_result;
  END IF;
  IF (SELECT buyer_user_id FROM public.orders WHERE id = v_session2) IS NOT NULL THEN
    RAISE EXCEPTION 'R-CLAIM an ordinary online order with a used ticket on a scheduled event was claimed';
  END IF;

  RAISE NOTICE '#4271 rework implementor: all checks passed';
END;
$test$;

ROLLBACK;
