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
  -- A session that reached the code after it closed (never revoked, because it
  -- did not exist yet) still cannot be paid: the code's own status decides.
  v_session2 := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, status, idempotency_key, expires_at, door_pay_code_id
  ) VALUES (
    v_session2, v_event, v_brand, 'Racing tab', 'race.r4271@example.test', '+12025550163',
    4180, 'USD', 'awaiting_web_redirect', 'r4271-race-'||v_session2, now() + interval '15 minutes', v_code
  );
  IF public.issue_4271_door_session_payable(v_session2) THEN
    RAISE EXCEPTION 'R-LATE a session on a cancelled code reads as payable';
  END IF;
  IF public.issue_1930_ticket_session_authorized(v_session2, v_event) THEN
    RAISE EXCEPTION 'R-LATE a session that raced a cancelled code is still authorised';
  END IF;

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

-- =============================================================================
-- Retest fixes, on the real hosted Stripe money shape: session.total_cents is the
-- ticket base (3000), buyer_total_cents is the charge (3135), and Mingla's fee is
-- stripe_application_fee_amount_cents (135) with application_fee_amount_cents 0.
--   R-REFUND  (T2) a door code's late refund returns the whole charge, reverses
--             the fee, and the ledger allocations and the host's read agree. A
--             session with no door code is refunded exactly as before.
--   R-CLOSE   (T4) a close names the pages Stripe confirmed; any other live page
--             answers retry and closes nothing.
--   R-LANDING (T4) a code left open because a payment is landing finalizes past
--             its time: the money is honoured as a sale.
--   R-DUE     (T4) the sweep sees codes past their time, and no others.
--   R-KEPT    (T4) an order a non-finalize writer stood on a closed code is told
--             to the host, never "nothing charged".
--   R-LOCKS   (T8) every writer that closes or links a code takes finalize's
--             event and brand locks first.
-- =============================================================================
DO $retest$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_brand_ps uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_event_ps uuid := gen_random_uuid();
  v_tier uuid := gen_random_uuid();
  v_tier_ps uuid := gen_random_uuid();
  v_code uuid;
  v_session uuid;
  v_order uuid;
  v_claim jsonb;
  v_result jsonb;
  v_row public.source_refunds%ROWTYPE;
  v_pepper text := 'r4271-retest-pepper-0123456789-abcdef';
  v_fn text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'owner.t4271@example.test');
  INSERT INTO public.creator_accounts (id, email, display_name) VALUES (v_owner, 'owner.t4271@example.test', 'Owner');
  INSERT INTO public.brands (id, account_id, name, slug, default_currency, pricing_currency, payment_provider, payout_hold_cutover_at)
  VALUES (v_brand, v_owner, 'T door', 't-door-'||v_brand, 'GBP', 'GBP', 'stripe', now() - interval '1 day'),
         (v_brand_ps, v_owner, 'T ps', 't-ps-'||v_brand_ps, 'NGN', 'NGN', 'paystack', now() - interval '1 day');
  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at) VALUES
    (v_brand, v_owner, 'brand_owner', now() - interval '9 days', now() - interval '9 days'),
    (v_brand_ps, v_owner, 'brand_owner', now() - interval '9 days', now() - interval '9 days')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone, currency) VALUES
    (v_event, v_brand, 'T night', 't-night-'||v_event, 'event', 'live', 'public', 'UTC', 'GBP'),
    (v_event_ps, v_brand_ps, 'T lagos', 't-lagos-'||v_event_ps, 'event', 'live', 'public', 'UTC', 'NGN');
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master, occurrence_key) VALUES
    (gen_random_uuid(), v_event, now() - interval '1 hour', now() + interval '3 hours', 'UTC', true, 'one'),
    (gen_random_uuid(), v_event_ps, now() - interval '1 hour', now() + interval '3 hours', 'UTC', true, 'one');
  INSERT INTO public.ticket_types (id, event_id, name, price_cents, currency, quantity_total, is_unlimited, available_online, available_in_person, is_disabled, is_hidden) VALUES
    (v_tier, v_event, 'General', 1500, 'GBP', 50, false, true, true, false, false),
    (v_tier_ps, v_event_ps, 'General', 1500000, 'NGN', 50, false, true, true, false, false);


  -- ---------------------------------------------------------------- R-REFUND
  FOR v_result IN
    SELECT jsonb_build_object('tag', tag, 'door', door, 'ps', ps)
      FROM (VALUES ('stripe', true, false), ('paystack', true, true), ('online', false, false)) x(tag, door, ps)
  LOOP
    v_session := gen_random_uuid();
    INSERT INTO public.ticket_checkout_sessions (
      id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, status,
      idempotency_key, expires_at, stripe_account_id, stripe_checkout_session_id, stripe_payment_intent_id,
      stripe_application_fee_amount_cents, list_subtotal_cents, discount_cents, net_subtotal_cents,
      buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source
    ) VALUES (
      v_session,
      CASE WHEN (v_result->>'ps')::boolean THEN v_event_ps ELSE v_event END,
      CASE WHEN (v_result->>'ps')::boolean THEN v_brand_ps ELSE v_brand END,
      'Guest', 'guest.t4271@example.test', '+447700900123', 3000,
      CASE WHEN (v_result->>'ps')::boolean THEN 'NGN' ELSE 'GBP' END,
      'awaiting_web_redirect', 't4271-'||v_session, now() + interval '40 minutes',
      CASE WHEN (v_result->>'ps')::boolean THEN NULL ELSE 'acct_t4271' END,
      CASE WHEN (v_result->>'ps')::boolean THEN NULL ELSE 'cs_t'||replace(v_session::text,'-','') END,
      CASE WHEN (v_result->>'ps')::boolean THEN NULL ELSE 'pi_t'||replace(v_session::text,'-','') END,
      135, 3000, 0, 3000, 135, 0, 3135, 'computed_at_checkout'
    );
    INSERT INTO public.ticket_checkout_session_items (checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity, unit_price_cents, total_cents)
    VALUES (v_session, CASE WHEN (v_result->>'ps')::boolean THEN v_tier_ps ELSE v_tier END, 'General', 2, 1500, 3000);
    v_code := NULL;
    IF (v_result->>'door')::boolean THEN
      v_code := gen_random_uuid();
      INSERT INTO public.door_pay_codes (id, brand_id, event_id, code, lines, currency, subtotal_cents, fee_cents, total_cents, provider, created_by)
      VALUES (v_code,
        CASE WHEN (v_result->>'ps')::boolean THEN v_brand_ps ELSE v_brand END,
        CASE WHEN (v_result->>'ps')::boolean THEN v_event_ps ELSE v_event END,
        CASE WHEN (v_result->>'ps')::boolean THEN 'TPSK2345' ELSE 'TSTR2345' END,
        jsonb_build_array(jsonb_build_object('ticketTypeId', CASE WHEN (v_result->>'ps')::boolean THEN v_tier_ps ELSE v_tier END, 'quantity', 2)),
        CASE WHEN (v_result->>'ps')::boolean THEN 'NGN' ELSE 'GBP' END, 3000, 135, 3135,
        CASE WHEN (v_result->>'ps')::boolean THEN 'paystack' ELSE 'stripe' END, v_owner);
      PERFORM public.issue_4271_door_pay_code_link_session(v_code, v_session);
    END IF;
    IF (v_result->>'ps')::boolean THEN
      v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event_ps, 'paystack', 'paystack_redirect', 't4271-fp-'||v_session);
      PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, NULL, NULL, 'psref'||replace(v_session::text,'-',''), 't4271-c-'||v_session);
    ELSE
      v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event, 'stripe', 'stripe_checkout', 't4271-fp-'||v_session);
      PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, NULL, 'cs_t'||replace(v_session::text,'-',''), 'pi_t'||replace(v_session::text,'-',''), 't4271-c-'||v_session);
    END IF;

    IF v_code IS NOT NULL THEN
      PERFORM public.issue_4271_door_pay_code_revoke(v_code, 'cancelled');
    END IF;
    IF (v_result->>'ps')::boolean THEN
      PERFORM public.issue_1930_mint_ticket_late_reversal(v_session, 'paystack', 'psref'||replace(v_session::text,'-',''), '900123456', NULL);
    ELSE
      PERFORM public.issue_1930_mint_ticket_late_reversal(v_session, 'stripe', 'pi_t'||replace(v_session::text,'-',''), NULL, 'ch_t'||replace(v_session::text,'-',''));
    END IF;
    SELECT * INTO v_row FROM public.source_refunds WHERE source_id = v_session AND refund_kind = 'late_payment_no_value';
    IF NOT FOUND THEN RAISE EXCEPTION 'R-REFUND % minted no refund', v_result; END IF;

    IF NOT (v_result->>'door')::boolean THEN
      -- Online checkout behaviour is unchanged (its base-amount refund is its
      -- own to change, not this issue's).
      IF v_row.buyer_refund_requested_cents <> 3000 OR v_row.fee_reversal_required_cents <> 0 THEN
        RAISE EXCEPTION 'R-REFUND online refund changed: %', to_jsonb(v_row);
      END IF;
      CONTINUE;
    END IF;
    IF v_row.original_charge_cents <> 3135 OR v_row.buyer_refund_requested_cents <> 3135
       OR v_row.original_application_fee_cents <> 135 OR v_row.fee_reversal_required_cents <> 135
       OR v_row.fee_state <> 'queued' OR v_row.organizer_refund_liability_cents <> 3000
       OR v_row.platform_fee_absorption_cents <> 135
       OR v_row.fee_leg_kind <> (CASE WHEN (v_result->>'ps')::boolean THEN 'paystack_ledger_allocation' ELSE 'stripe_application_fee_refund' END) THEN
      RAISE EXCEPTION 'R-REFUND % late refund must be the whole charge with the fee reversed: %', v_result->>'tag', to_jsonb(v_row);
    END IF;
    IF (SELECT jsonb_object_agg(allocation_type, amount_cents) FROM public.source_refund_ledger_allocations WHERE refund_id = v_row.id)
       IS DISTINCT FROM jsonb_build_object('buyer_refund', 3135, 'organizer_refund_liability', 3000, 'platform_application_fee_reversal', 135) THEN
      RAISE EXCEPTION 'R-REFUND % allocations disagree with the refund', v_result->>'tag';
    END IF;
    IF public.issue_4271_door_pay_code_late_read(v_code)
       IS DISTINCT FROM jsonb_build_object('state', 'refunding', 'amountCents', 3135,
         'currency', CASE WHEN (v_result->>'ps')::boolean THEN 'NGN' ELSE 'GBP' END) THEN
      RAISE EXCEPTION 'R-REFUND % host read must name the full amount, got %', v_result->>'tag', public.issue_4271_door_pay_code_late_read(v_code);
    END IF;
  END LOOP;

  -- ------------------------------------------------ R-CLOSE, R-LANDING, R-DUE
  v_code := gen_random_uuid();
  v_session := gen_random_uuid();
  INSERT INTO public.door_pay_codes (id, brand_id, event_id, code, lines, currency, subtotal_cents, fee_cents, total_cents, provider, created_by)
  VALUES (v_code, v_brand, v_event, 'TXND2345', jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier, 'quantity', 2)), 'GBP', 3000, 135, 3135, 'stripe', v_owner);
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, status,
    idempotency_key, expires_at, stripe_account_id, stripe_checkout_session_id, stripe_payment_intent_id,
    stripe_application_fee_amount_cents, list_subtotal_cents, discount_cents, net_subtotal_cents,
    buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source
  ) VALUES (
    v_session, v_event, v_brand, 'Guest', 'guest.t4271@example.test', '+447700900123', 3000, 'GBP',
    'awaiting_web_redirect', 't4271-'||v_session, now() + interval '40 minutes', 'acct_t4271',
    'cs_tland', 'pi_tland', 135, 3000, 0, 3000, 135, 0, 3135, 'computed_at_checkout'
  );
  INSERT INTO public.ticket_checkout_session_items (checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity, unit_price_cents, total_cents)
  VALUES (v_session, v_tier, 'General', 2, 1500, 3000);
  PERFORM public.issue_4271_door_pay_code_link_session(v_code, v_session);
  v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event, 'stripe', 'stripe_checkout', 't4271-fp-land');
  PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, NULL, 'cs_tland', 'pi_tland', 't4271-c-land');

  v_result := public.issue_4271_door_pay_code_live_pages(v_code);
  IF v_result->>'status' <> 'opened' OR v_result->'pages'->0->>'checkoutSessionId' <> 'cs_tland'
     OR v_result->'pages'->0->>'stripeAccountId' <> 'acct_t4271'
     OR v_result->'pages'->0->>'idempotencyKey' NOT LIKE '%:expire' THEN
    RAISE EXCEPTION 'R-CLOSE live pages wrong: %', v_result;
  END IF;
  -- A close that doesn't name the live page closes nothing.
  v_result := public.issue_4271_door_pay_code_close(v_code, 'cancelled', ARRAY[]::text[]);
  IF v_result->>'status' <> 'retry' THEN
    RAISE EXCEPTION 'R-CLOSE a page Stripe was not asked about must answer retry, got %', v_result;
  END IF;
  IF (SELECT status FROM public.door_pay_codes WHERE id = v_code) <> 'opened'
     OR (SELECT revoked_at FROM public.ticket_checkout_sessions WHERE id = v_session) IS NOT NULL THEN
    RAISE EXCEPTION 'R-CLOSE a refused close must change nothing';
  END IF;

  UPDATE public.door_pay_codes SET expires_at = now() - interval '1 minute' WHERE id = v_code;
  IF NOT v_code = ANY(public.issue_4271_door_pay_codes_due(200)) THEN
    RAISE EXCEPTION 'R-DUE a code past its time must be due';
  END IF;
  -- Stripe said complete, so the code was left open: the money is a sale.
  v_result := public.biz_ticket_checkout_finalize(v_session, 'pi_tland', 'ch_tland', 'card', v_pepper);
  IF v_result->>'outcome' <> 'finalized' THEN
    RAISE EXCEPTION 'R-LANDING a landing payment past the code''s time must finalize, got %', v_result;
  END IF;
  IF (SELECT status FROM public.door_pay_codes WHERE id = v_code) <> 'paid' THEN
    RAISE EXCEPTION 'R-LANDING the code must read paid';
  END IF;
  IF v_code = ANY(public.issue_4271_door_pay_codes_due(200)) THEN
    RAISE EXCEPTION 'R-DUE a paid code must not be due';
  END IF;
  IF (public.issue_4271_door_pay_code_close(v_code, 'cancelled', ARRAY[]::text[]))->>'status' <> 'paid' THEN
    RAISE EXCEPTION 'R-CLOSE a paid code stays paid';
  END IF;

  -- A confirmed page closes the code and its checkout.
  v_code := gen_random_uuid();
  v_session := gen_random_uuid();
  INSERT INTO public.door_pay_codes (id, brand_id, event_id, code, lines, currency, subtotal_cents, fee_cents, total_cents, provider, created_by)
  VALUES (v_code, v_brand, v_event, 'TCXS2345', jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier, 'quantity', 2)), 'GBP', 3000, 135, 3135, 'stripe', v_owner);
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, status,
    idempotency_key, expires_at, stripe_account_id, stripe_checkout_session_id, stripe_payment_intent_id,
    stripe_application_fee_amount_cents, list_subtotal_cents, discount_cents, net_subtotal_cents,
    buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source
  ) VALUES (
    v_session, v_event, v_brand, 'Guest', 'guest.t4271@example.test', '+447700900123', 3000, 'GBP',
    'awaiting_web_redirect', 't4271-'||v_session, now() + interval '40 minutes', 'acct_t4271',
    'cs_tcls', 'pi_tcls', 135, 3000, 0, 3000, 135, 0, 3135, 'computed_at_checkout'
  );
  PERFORM public.issue_4271_door_pay_code_link_session(v_code, v_session);
  v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event, 'stripe', 'stripe_checkout', 't4271-fp-cls');
  PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, NULL, 'cs_tcls', 'pi_tcls', 't4271-c-cls');
  v_result := public.issue_4271_door_pay_code_close(v_code, 'cancelled', ARRAY['cs_tcls']);
  IF v_result->>'status' <> 'cancelled'
     OR (SELECT revoked_at FROM public.ticket_checkout_sessions WHERE id = v_session) IS NULL THEN
    RAISE EXCEPTION 'R-CLOSE a confirmed page must close the code and revoke its session: %', v_result;
  END IF;
  IF public.issue_4271_door_pay_code_late_read(v_code) IS NOT NULL THEN
    RAISE EXCEPTION 'R-CLOSE no payment landed, so no late read';
  END IF;

  -- ------------------------------------------------------------------ R-KEPT
  v_order := gen_random_uuid();
  INSERT INTO public.orders (id, event_id, buyer_name, buyer_email, buyer_phone, buyer_phone_e164, total_cents, list_subtotal_cents, discount_cents, net_subtotal_cents, buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source, currency, payment_method, payment_status, checkout_session_id, source, stripe_payment_intent_id, stripe_charge_id)
  VALUES (v_order, v_event, 'G', 'g.t4271@example.test', '+447700900123', '+447700900123', 3000, 3000, 0, 3000, 135, 0, 3135, 'computed_at_checkout', 'GBP', 'online_card', 'paid', v_session, 'online_checkout', 'pi_tcls', 'ch_tcls');
  UPDATE public.ticket_checkout_sessions SET order_id = v_order WHERE id = v_session;
  IF public.issue_4271_door_pay_code_late_read(v_code)
     IS DISTINCT FROM jsonb_build_object('state', 'kept', 'amountCents', 3135, 'currency', 'GBP') THEN
    RAISE EXCEPTION 'R-KEPT host must be told about an order on a closed code, got %', public.issue_4271_door_pay_code_late_read(v_code);
  END IF;

  -- ----------------------------------------------------------------- R-LOCKS
  FOREACH v_fn IN ARRAY ARRAY[
    'public.issue_4271_door_pay_code_revoke(uuid,text)',
    'public.issue_4271_door_pay_code_close(uuid,text,text[])',
    'public.issue_4271_door_pay_code_link_session(uuid,uuid)',
    'public.issue_4271_door_pay_code_text_link(uuid,text,text)'
  ] LOOP
    IF position('issue_4271_door_lock_event_brand' IN pg_get_functiondef(v_fn::regprocedure)) = 0
       OR position('issue_4271_door_lock_event_brand' IN pg_get_functiondef(v_fn::regprocedure))
          > position('FROM public.door_pay_codes' IN pg_get_functiondef(v_fn::regprocedure)) THEN
      RAISE EXCEPTION 'R-LOCKS % must take the event and brand locks before the code', v_fn;
    END IF;
  END LOOP;

  RAISE NOTICE '#4271 retest implementor: all checks passed';
END;
$retest$;

ROLLBACK;
