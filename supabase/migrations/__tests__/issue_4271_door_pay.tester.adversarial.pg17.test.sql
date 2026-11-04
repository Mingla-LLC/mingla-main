-- Issue #4271 — TESTER adversarial suite for 20280404004271_issue_4271_door_pay.sql
-- on the fully replayed PG17 schema. Different angles from the implementor's
-- happy path (issue_4271_door_pay.implementor.pg17.test.sql):
--
--   A-PERM    cross-brand event manager, a REMOVED event scanner whose switch is
--             on, an event scanner of a sibling event, a brand-scope scanner
--             with no switch, a brand-scope scanner whose accepted invitation
--             (email in a different case) turns the switch on, a pending
--             manager invite. Cash via biz_door_sale_record follows the same
--             answer (F6 covers ALL door methods).
--   A-LINES   the server quote refuses a hidden tier, a tier not sold in
--             person, a free tier, another event's tier, a duplicate line,
--             quantity 0 / 100, and a tier already at capacity.
--   A-CHECK   the DB refuses 'nfc' everywhere, pay_code / tap_to_pay on a
--             source='door_sale' row, card_reader on the checkout source, a
--             door_pay_code_id on a non pay_code order, and a second card
--             ledger row for one order.
--   A-LINK    a cancelled / failed code refuses a session, an open code past
--             its time persists 'expired', a session of another event or one
--             that already has an order is refused.
--   A-PAY     a duplicate payment never adds a second ledger row and never
--             burns the second order's tickets.
--   A-TEXT    a cancelled or timed-out code cannot be texted and a refusal
--             does not spend the three-text budget.
--   A-TAP     biz_door_tap_record refuses an amount that is not the server
--             price, an unknown PaymentIntent and a malformed id, and a replay
--             never adds a second ledger row.
--   A-TEAM    biz_brand_team_members refuses a removed member, a pending
--             member, another brand's manager and anon, and never returns
--             another brand's, pending or removed members.
--   A-RLS     anon holds no privilege on door_pay_codes; another brand's
--             manager reads none of this brand's codes.
--   A-CLAIM   (defect probe) a paid pay-code order is claimable in Explorer
--             through claim_attendance_by_verified_identity on a 'live' event
--             AND on a 'scheduled' event (doors open before the start time).
--   A-ONLINE  (defect probe) any tier the door quote accepts for a pay code
--             must also be accepted by the online checkout quote the guest's
--             payment runs through (issue_3872_ticket_quote).
--
-- Every check records a failure instead of stopping, so one run reports every
-- broken guard; the block raises once at the end if any failed.
--
-- FAILS-ON-REVERT (verified locally by the tester): drop the scanner switch
-- clause from issue_4271_can_take_door_payment -> A-PERM fails; drop
-- `tt.is_hidden = false` from issue_4271_door_quote_lines -> A-LINES fails;
-- restore the pre-#4271 orders_door_payment_method_check -> A-CHECK fails;
-- drop the `m.removed_at IS NULL` filter from biz_brand_team_members ->
-- A-TEAM fails.

\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_fail text[] := ARRAY[]::text[];
  v_owner uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_mgr_b uuid := gen_random_uuid();
  v_removed_scanner uuid := gen_random_uuid();
  v_sibling_scanner uuid := gen_random_uuid();
  v_brand_plain uuid := gen_random_uuid();
  v_brand_inv uuid := gen_random_uuid();
  v_pending_mgr uuid := gen_random_uuid();
  v_removed_member uuid := gen_random_uuid();
  v_guest uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_brand_b uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_event_sched uuid := gen_random_uuid();
  v_event_sibling uuid := gen_random_uuid();
  v_event_b uuid := gen_random_uuid();
  v_date uuid := gen_random_uuid();
  v_date_sched uuid := gen_random_uuid();
  v_tier_door uuid := gen_random_uuid();
  v_tier_both uuid := gen_random_uuid();
  v_tier_hidden uuid := gen_random_uuid();
  v_tier_online uuid := gen_random_uuid();
  v_tier_free uuid := gen_random_uuid();
  v_tier_cap uuid := gen_random_uuid();
  v_tier_b uuid := gen_random_uuid();
  v_tier_sched uuid := gen_random_uuid();
  v_seed_order uuid := gen_random_uuid();
  v_code uuid;
  v_session uuid;
  v_order uuid;
  v_result jsonb;
  v_text text;
  v_raised text;
  v_count integer;
  v_row record;
  v_ok boolean;
  v_cash_order uuid;
  v_online_order uuid := gen_random_uuid();
BEGIN
  -- ---------------------------------------------------------------- fixtures
  INSERT INTO auth.users (id, email) VALUES
    (v_owner, 'owner.a4271@example.test'),
    (v_owner_b, 'owner.b4271@example.test'),
    (v_mgr_b, 'mgr.b4271@example.test'),
    (v_removed_scanner, 'removed.a4271@example.test'),
    (v_sibling_scanner, 'sibling.a4271@example.test'),
    (v_brand_plain, 'plain.a4271@example.test'),
    (v_brand_inv, 'Invited.A4271@Example.test'),
    (v_pending_mgr, 'pending.a4271@example.test'),
    (v_removed_member, 'gone.a4271@example.test'),
    (v_guest, 'guest.a4271@example.test');
  INSERT INTO public.creator_accounts (id, email, display_name) VALUES
    (v_owner, 'owner.a4271@example.test', 'Ada Owner'),
    (v_owner_b, 'owner.b4271@example.test', 'Bola Other'),
    (v_mgr_b, 'mgr.b4271@example.test', 'Bayo Manager'),
    (v_removed_scanner, 'removed.a4271@example.test', 'Rex Removed'),
    (v_sibling_scanner, 'sibling.a4271@example.test', 'Sid Sibling'),
    (v_brand_plain, 'plain.a4271@example.test', NULL),
    (v_brand_inv, 'invited.a4271@example.test', 'Ivy Invited'),
    (v_pending_mgr, 'pending.a4271@example.test', 'Pam Pending'),
    (v_removed_member, 'gone.a4271@example.test', 'Gus Gone');
  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency, pricing_currency,
    payment_provider, payout_hold_cutover_at
  ) VALUES
    (v_brand, v_owner, 'Door A', 'door-a-'||v_brand, 'USD', 'USD', 'stripe', now() - interval '1 day'),
    (v_brand_b, v_owner_b, 'Door B', 'door-b-'||v_brand_b, 'USD', 'USD', 'stripe', now() - interval '1 day');
  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at, removed_at)
  VALUES
    (v_brand, v_owner, 'brand_owner', now() - interval '9 days', now() - interval '9 days', NULL),
    (v_brand, v_brand_plain, 'scanner', now() - interval '8 days', now() - interval '8 days', NULL),
    (v_brand, v_brand_inv, 'scanner', now() - interval '7 days', now() - interval '7 days', NULL),
    (v_brand, v_pending_mgr, 'event_manager', now() - interval '6 days', NULL, NULL),
    (v_brand, v_removed_member, 'event_manager', now() - interval '6 days', now() - interval '6 days', now() - interval '1 day'),
    (v_brand_b, v_owner_b, 'brand_owner', now() - interval '9 days', now() - interval '9 days', NULL),
    (v_brand_b, v_mgr_b, 'event_manager', now() - interval '5 days', now() - interval '5 days', NULL)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.scanner_invitations (
    brand_id, event_id, scope, email, permissions, invited_by, token_hash,
    expires_at, status, accepted_at
  ) VALUES (
    v_brand, NULL, 'brand', 'invited.a4271@example.test',
    '{"canScan":true,"canAcceptPayments":true}'::jsonb, v_owner, 'tok-a4271-inv',
    now() + interval '7 days', 'accepted', now() - interval '7 days'
  );
  INSERT INTO public.events (
    id, brand_id, title, slug, event_type, status, visibility, timezone, currency
  ) VALUES
    (v_event, v_brand, 'Door live', 'door-live-'||v_event, 'event', 'live', 'public', 'UTC', 'USD'),
    (v_event_sched, v_brand, 'Doors open early', 'door-sched-'||v_event_sched, 'event', 'scheduled', 'public', 'UTC', 'USD'),
    (v_event_sibling, v_brand, 'Sibling night', 'door-sib-'||v_event_sibling, 'event', 'live', 'public', 'UTC', 'USD'),
    (v_event_b, v_brand_b, 'Other brand night', 'door-b-'||v_event_b, 'event', 'live', 'public', 'UTC', 'USD');
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master, occurrence_key)
  VALUES
    (v_date, v_event, now() - interval '1 hour', now() + interval '3 hours', 'UTC', true, 'one'),
    (v_date_sched, v_event_sched, now() + interval '30 minutes', now() + interval '5 hours', 'UTC', true, 'one'),
    (gen_random_uuid(), v_event_sibling, now() - interval '1 hour', now() + interval '3 hours', 'UTC', true, 'one'),
    (gen_random_uuid(), v_event_b, now() - interval '1 hour', now() + interval '3 hours', 'UTC', true, 'one');
  INSERT INTO public.ticket_types (
    id, event_id, name, price_cents, currency, quantity_total, is_unlimited,
    available_online, available_in_person, is_disabled, is_hidden
  ) VALUES
    (v_tier_door, v_event, 'Door only', 2000, 'USD', 50, false, false, true, false, false),
    (v_tier_both, v_event, 'General', 1500, 'USD', 50, false, true, true, false, false),
    (v_tier_hidden, v_event, 'Secret', 1000, 'USD', 50, false, true, true, false, true),
    (v_tier_online, v_event, 'Online only', 1000, 'USD', 50, false, true, false, false, false),
    (v_tier_free, v_event, 'Free door', 0, 'USD', 50, false, true, true, false, false),
    (v_tier_cap, v_event, 'Last two', 1000, 'USD', 2, false, true, true, false, false),
    (v_tier_b, v_event_b, 'B tier', 1000, 'USD', 50, false, true, true, false, false),
    (v_tier_sched, v_event_sched, 'Early door', 1500, 'USD', 50, false, true, true, false, false);
  INSERT INTO public.event_scanners (event_id, user_id, permissions, assigned_by, removed_at)
  VALUES
    (v_event, v_removed_scanner, '{"canScan":true,"canAcceptPayments":true}'::jsonb, v_owner, now() - interval '1 hour'),
    (v_event_sibling, v_sibling_scanner, '{"canScan":true,"canAcceptPayments":true}'::jsonb, v_owner, NULL);

  -- Two sold tickets put v_tier_cap at capacity.
  INSERT INTO public.orders (
    id, event_id, buyer_name, buyer_email, buyer_phone, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source,
    stripe_payment_intent_id, stripe_charge_id
  ) VALUES (
    v_seed_order, v_event, 'Seed', 'seed.a4271@example.test', '+12025550199',
    '+12025550199', 2000, 'USD', 'online_card', 'paid', 'online_checkout',
    'pi_a4271seed', 'ch_a4271seed'
  );
  INSERT INTO public.tickets (id, order_id, ticket_type_id, event_id, qr_code, status)
  SELECT gen_random_uuid(), v_seed_order, v_tier_cap, v_event, 'a4271-seed-'||g, 'valid'
    FROM generate_series(1, 2) g;

  -- ------------------------------------------------------------------ A-PERM
  IF NOT public.issue_4271_can_take_door_payment(v_event, v_owner) THEN
    v_fail := v_fail || text 'A-PERM the brand owner must take door money';
  END IF;
  IF public.issue_4271_can_take_door_payment(v_event, v_mgr_b) THEN
    v_fail := v_fail || text 'A-PERM brand B''s event manager took money on brand A''s event';
  END IF;
  IF NOT public.issue_4271_can_take_door_payment(v_event_b, v_mgr_b) THEN
    v_fail := v_fail || text 'A-PERM brand B''s event manager must take money on brand B''s event';
  END IF;
  IF public.issue_4271_can_take_door_payment(v_event, v_removed_scanner) THEN
    v_fail := v_fail || text 'A-PERM a REMOVED event scanner (switch on) took door money';
  END IF;
  IF public.issue_4271_can_take_door_payment(v_event, v_sibling_scanner) THEN
    v_fail := v_fail || text 'A-PERM a scanner of a sibling event took money on this event';
  END IF;
  IF public.issue_4271_can_take_door_payment(v_event, v_brand_plain) THEN
    v_fail := v_fail || text 'A-PERM a brand-scope scanner without the switch took door money';
  END IF;
  IF NOT public.issue_4271_can_take_door_payment(v_event, v_brand_inv) THEN
    v_fail := v_fail || text 'A-PERM a brand-scope scanner whose accepted invite turned the switch on was refused';
  END IF;
  IF public.issue_4271_can_take_door_payment(v_event, v_pending_mgr) THEN
    v_fail := v_fail || text 'A-PERM a pending (unaccepted) event manager took door money';
  END IF;
  IF public.issue_4271_can_take_door_payment(v_event, v_removed_member) THEN
    v_fail := v_fail || text 'A-PERM a removed event manager took door money';
  END IF;
  IF public.issue_4271_can_take_door_payment(v_event, NULL) THEN
    v_fail := v_fail || text 'A-PERM a NULL actor took door money';
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_4271_can_take_door_payment(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_4271_can_take_door_payment(uuid, uuid)', 'EXECUTE') THEN
    v_fail := v_fail || text 'A-PERM the actor-taking permission function must be service_role only';
  END IF;

  -- Cash (and manual) follow the same answer: F6 covers every door method.
  FOREACH v_text IN ARRAY ARRAY[v_mgr_b::text, v_removed_scanner::text, v_brand_plain::text] LOOP
    PERFORM set_config('request.jwt.claim.sub', v_text, true);
    v_raised := NULL;
    BEGIN
      PERFORM public.biz_door_sale_record(
        v_event, v_date,
        jsonb_build_array(jsonb_build_object('ticket_type_id', v_tier_door, 'quantity', 1)),
        'manual', NULL, NULL, NULL, NULL, gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
    END;
    IF v_raised IS DISTINCT FROM 'door_access_denied' THEN
      v_fail := v_fail || format('A-PERM manual door sale by %s must be door_access_denied, got %s', v_text, coalesce(v_raised, 'success'));
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', v_brand_inv::text, true);
  v_result := public.biz_door_sale_record(
    v_event, v_date,
    jsonb_build_array(jsonb_build_object('ticket_type_id', v_tier_door, 'quantity', 1)),
    'cash', NULL, NULL, NULL, NULL, gen_random_uuid());
  v_cash_order := (v_result->>'orderId')::uuid;
  IF v_cash_order IS NULL THEN
    v_fail := v_fail || text 'A-PERM the invited switch-on brand scanner must record cash';
  END IF;

  -- ----------------------------------------------------------------- A-LINES
  FOR v_row IN
    SELECT * FROM (VALUES
      ('hidden tier', jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_hidden, 'quantity', 1)), 'invalid_lines'),
      ('online-only tier', jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_online, 'quantity', 1)), 'invalid_lines'),
      ('free tier', jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_free, 'quantity', 1)), 'invalid_lines'),
      ('other event tier', jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_b, 'quantity', 1)), 'invalid_lines'),
      ('duplicate line', jsonb_build_array(
         jsonb_build_object('ticketTypeId', v_tier_door, 'quantity', 1),
         jsonb_build_object('ticketTypeId', v_tier_door, 'quantity', 1)), 'invalid_lines'),
      ('quantity 0', jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_door, 'quantity', 0)), 'invalid_lines'),
      ('quantity 100', jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_door, 'quantity', 100)), 'invalid_lines'),
      ('not a uuid', jsonb_build_array(jsonb_build_object('ticketTypeId', 'nope', 'quantity', 1)), 'invalid_lines'),
      ('over capacity', jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_cap, 'quantity', 1)), 'door_ticket_capacity_exceeded'),
      ('empty basket', '[]'::jsonb, 'invalid_lines')
    ) AS c(label, lines, expected)
  LOOP
    v_raised := NULL;
    BEGIN
      PERFORM public.issue_4271_door_quote_lines(v_event, NULL, v_row.lines);
    EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
    END;
    IF v_raised IS DISTINCT FROM v_row.expected THEN
      v_fail := v_fail || format('A-LINES %s must raise %s, got %s', v_row.label, v_row.expected, coalesce(v_raised, 'accepted'));
    END IF;
  END LOOP;
  -- The quote prices from the tier, whatever the phone thinks the price is.
  v_result := public.issue_4271_door_quote_lines(v_event, NULL, jsonb_build_array(
    jsonb_build_object('ticketTypeId', v_tier_both, 'quantity', 3,
                       'unitCents', 1, 'priceCents', 1, 'totalCents', 3)));
  IF (v_result->>'subtotalCents')::integer <> 4500
     OR (v_result->'lines'->0->>'unitCents')::integer <> 1500 THEN
    v_fail := v_fail || format('A-LINES a phone-sent unit price leaked into the quote: %s', v_result);
  END IF;

  -- ----------------------------------------------------------------- A-CHECK
  BEGIN
    UPDATE public.orders SET door_payment_method = 'pay_code' WHERE id = v_cash_order;
    v_fail := v_fail || text 'A-CHECK pay_code was accepted on a source=door_sale order';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.orders SET door_payment_method = 'tap_to_pay' WHERE id = v_cash_order;
    v_fail := v_fail || text 'A-CHECK tap_to_pay was accepted on a source=door_sale order';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.orders SET door_payment_method = 'nfc' WHERE id = v_cash_order;
    v_fail := v_fail || text 'A-CHECK nfc was accepted on a door_sale order';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.door_sales_ledger SET payment_method = 'nfc' WHERE order_id = v_cash_order;
    v_fail := v_fail || text 'A-CHECK nfc was accepted on the door ledger';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.orders (
    id, event_id, buyer_name, buyer_email, buyer_phone, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source,
    stripe_payment_intent_id, stripe_charge_id
  ) VALUES (
    v_online_order, v_event, 'Online', 'online.a4271@example.test', '+12025550111',
    '+12025550111', 1500, 'USD', 'online_card', 'paid', 'online_checkout',
    'pi_a4271online', 'ch_a4271online'
  );
  FOREACH v_text IN ARRAY ARRAY['nfc', 'card_reader', 'cash', 'manual'] LOOP
    BEGIN
      UPDATE public.orders SET door_payment_method = v_text WHERE id = v_online_order;
      v_fail := v_fail || format('A-CHECK %s was accepted on the checkout source', v_text);
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  BEGIN
    UPDATE public.orders SET door_payment_method = 'tap_to_pay' WHERE id = v_online_order;
  EXCEPTION WHEN check_violation THEN
    v_fail := v_fail || text 'A-CHECK tap_to_pay must be allowed on the checkout source';
  END;
  UPDATE public.orders SET door_payment_method = NULL WHERE id = v_online_order;
  -- An online checkout order still needs a phone unless it is a tap.
  BEGIN
    UPDATE public.orders SET buyer_phone_e164 = NULL WHERE id = v_online_order;
    v_fail := v_fail || text 'A-CHECK an ordinary online order lost its phone requirement';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ------------------------------------------------------------------ A-LINK
  -- The checkout finalize and the webhook run as the service role (no user).
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO public.door_pay_codes (
    id, brand_id, event_id, event_date_id, code, lines, currency, subtotal_cents,
    fee_cents, total_cents, provider, created_by, status
  ) VALUES
    (gen_random_uuid(), v_brand, v_event, v_date, 'CANC2345',
     jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_both, 'quantity', 1)),
     'USD', 1500, 70, 1570, 'stripe', v_owner, 'cancelled'),
    (gen_random_uuid(), v_brand, v_event, v_date, 'FXZZ2345',
     jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_both, 'quantity', 1)),
     'USD', 1500, 70, 1570, 'stripe', v_owner, 'failed');
  INSERT INTO public.door_pay_codes (
    id, brand_id, event_id, event_date_id, code, lines, currency, subtotal_cents,
    fee_cents, total_cents, provider, created_by, status, expires_at
  ) VALUES
    (gen_random_uuid(), v_brand, v_event, v_date, 'WATE2345',
     jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_both, 'quantity', 1)),
     'USD', 1500, 70, 1570, 'stripe', v_owner, 'opened', now() - interval '1 second');
  v_session := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, status, idempotency_key, expires_at
  ) VALUES (
    v_session, v_event, v_brand, 'Guest', 'guest.a4271@example.test', '+12025550101',
    1570, 'USD', 'awaiting_web_redirect', 'a4271-link-'||v_session, now() + interval '15 minutes'
  );
  FOR v_row IN SELECT id, code FROM public.door_pay_codes WHERE code IN ('CANC2345','FXZZ2345','WATE2345') LOOP
    v_text := public.issue_4271_door_pay_code_link_session(v_row.id, v_session);
    IF v_text = 'linked' THEN
      v_fail := v_fail || format('A-LINK %s linked a session', v_row.code);
    END IF;
  END LOOP;
  SELECT status INTO v_text FROM public.door_pay_codes WHERE code = 'WATE2345';
  IF v_text <> 'expired' THEN
    v_fail := v_fail || format('A-LINK a timed-out opened code must persist expired, got %s', v_text);
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_checkout_sessions WHERE id = v_session AND door_pay_code_id IS NOT NULL) THEN
    v_fail := v_fail || text 'A-LINK a refused code still stamped the session';
  END IF;
  -- A session of another event cannot be pointed at this code.
  v_code := gen_random_uuid();
  INSERT INTO public.door_pay_codes (
    id, brand_id, event_id, event_date_id, code, lines, currency, subtotal_cents,
    fee_cents, total_cents, provider, created_by
  ) VALUES (
    v_code, v_brand, v_event, v_date, 'GQQD2345',
    jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_both, 'quantity', 2)),
    'USD', 3000, 140, 3140, 'stripe', v_owner
  );
  v_session := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, status, idempotency_key, expires_at
  ) VALUES (
    v_session, v_event_b, v_brand_b, 'Guest', 'guest.a4271@example.test', '+12025550101',
    1000, 'USD', 'awaiting_web_redirect', 'a4271-other-'||v_session, now() + interval '15 minutes'
  );
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_4271_door_pay_code_link_session(v_code, v_session);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  IF v_raised IS DISTINCT FROM 'door_code_unavailable:session' THEN
    v_fail := v_fail || format('A-LINK another event''s session must be refused, got %s', coalesce(v_raised, 'linked'));
  END IF;

  -- ------------------------------------------------------------------- A-PAY
  -- Two sessions on the good code; the second payment is a duplicate.
  v_session := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, status, idempotency_key, expires_at
  ) VALUES (
    v_session, v_event, v_brand, 'Guest', 'guest.a4271@example.test', '+12025550101',
    3140, 'USD', 'awaiting_web_redirect', 'a4271-pay1-'||v_session, now() + interval '15 minutes'
  );
  IF public.issue_4271_door_pay_code_link_session(v_code, v_session) <> 'linked' THEN
    v_fail := v_fail || text 'A-PAY the good code must link';
  END IF;
  v_order := gen_random_uuid();
  INSERT INTO public.orders (
    id, event_id, buyer_name, buyer_email, buyer_phone, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, checkout_session_id,
    source, stripe_payment_intent_id, stripe_charge_id
  ) VALUES (
    v_order, v_event, 'Guest', 'guest.a4271@example.test', '+12025550101',
    '+12025550101', 3140, 'USD', 'online_card', 'paid', v_session,
    'online_checkout', 'pi_a4271pay1', 'ch_a4271pay1'
  );
  INSERT INTO public.tickets (id, order_id, ticket_type_id, event_id, qr_code, status)
  SELECT gen_random_uuid(), v_order, v_tier_both, v_event, 'a4271-pay1-'||g, 'valid'
    FROM generate_series(1, 2) g;
  UPDATE public.ticket_checkout_sessions SET order_id = v_order WHERE id = v_session;
  -- A duplicate on a session that was linked before the code was paid.
  v_session := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, status, idempotency_key, expires_at, door_pay_code_id
  ) VALUES (
    v_session, v_event, v_brand, 'Guest two', 'guest2.a4271@example.test', '+12025550102',
    3140, 'USD', 'awaiting_web_redirect', 'a4271-pay2-'||v_session, now() + interval '15 minutes', v_code
  );
  INSERT INTO public.orders (
    id, event_id, buyer_name, buyer_email, buyer_phone, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, checkout_session_id,
    source, stripe_payment_intent_id, stripe_charge_id
  ) VALUES (
    gen_random_uuid(), v_event, 'Guest two', 'guest2.a4271@example.test', '+12025550102',
    '+12025550102', 3140, 'USD', 'online_card', 'paid', v_session,
    'online_checkout', 'pi_a4271pay2', 'ch_a4271pay2'
  );
  SELECT id INTO v_order FROM public.orders WHERE stripe_payment_intent_id = 'pi_a4271pay2';
  INSERT INTO public.tickets (id, order_id, ticket_type_id, event_id, qr_code, status)
  SELECT gen_random_uuid(), v_order, v_tier_both, v_event, 'a4271-pay2-'||g, 'valid'
    FROM generate_series(1, 2) g;
  UPDATE public.ticket_checkout_sessions SET order_id = v_order WHERE id = v_session;
  SELECT count(*) INTO v_count FROM public.door_sales_ledger l
    JOIN public.orders o ON o.id = l.order_id
   WHERE o.event_id = v_event AND l.payment_method = 'pay_code';
  IF v_count <> 1 THEN
    v_fail := v_fail || format('A-PAY one code must make exactly one pay_code ledger row, got %s', v_count);
  END IF;
  SELECT count(*) INTO v_count FROM public.tickets WHERE order_id = v_order AND status = 'used';
  IF v_count <> 0 THEN
    v_fail := v_fail || text 'A-PAY the duplicate order''s tickets were burned (born used)';
  END IF;
  IF (SELECT door_payment_method FROM public.orders WHERE id = v_order) IS NOT NULL THEN
    v_fail := v_fail || text 'A-PAY the duplicate order was stamped as a door sale';
  END IF;
  -- The ledger refuses a second card row for one order, whatever the writer.
  BEGIN
    INSERT INTO public.door_sales_ledger (event_id, order_id, scanner_user_id, payment_method, amount_cents, currency)
    SELECT v_event, order_id, v_owner, 'pay_code', 3140, 'USD' FROM public.door_pay_codes WHERE id = v_code;
    v_fail := v_fail || text 'A-PAY a second pay_code ledger row for one order was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- ------------------------------------------------------------------ A-TEXT
  FOR v_row IN SELECT id, code FROM public.door_pay_codes WHERE code IN ('CANC2345', 'WATE2345') LOOP
    v_raised := NULL;
    BEGIN
      PERFORM public.issue_4271_door_pay_code_text_link(v_row.id, '+12025550101', 'https://example.test/pay/door/'||v_row.code);
    EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
    END;
    IF v_raised IS DISTINCT FROM 'door_code_unavailable' THEN
      v_fail := v_fail || format('A-TEXT %s must refuse a text, got %s', v_row.code, coalesce(v_raised, 'sent'));
    END IF;
  END LOOP;
  v_code := gen_random_uuid();
  INSERT INTO public.door_pay_codes (
    id, brand_id, event_id, event_date_id, code, lines, currency, subtotal_cents,
    fee_cents, total_cents, provider, created_by
  ) VALUES (
    v_code, v_brand, v_event, v_date, 'TEXT2345',
    jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_both, 'quantity', 1)),
    'USD', 1500, 70, 1570, 'stripe', v_owner
  );
  BEGIN
    PERFORM public.issue_4271_door_pay_code_text_link(v_code, '07700900123', 'https://example.test/pay/door/TEXT2345');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF (SELECT text_link_count FROM public.door_pay_codes WHERE id = v_code) <> 0 THEN
    v_fail := v_fail || text 'A-TEXT a refused (bad phone) text spent the budget';
  END IF;

  -- ------------------------------------------------------------------- A-TAP
  INSERT INTO public.door_tap_intents (
    id, brand_id, event_id, event_date_id, client_request_id, lines, currency,
    subtotal_cents, fee_cents, total_cents, application_fee_cents,
    stripe_account_id, stripe_payment_intent_id, created_by
  ) VALUES (
    gen_random_uuid(), v_brand, v_event, v_date, gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_both, 'quantity', 1, 'unitCents', 1500)),
    'USD', 1500, 0, 1500, 68, 'acct_a4271', 'pi_a4271tap', v_owner
  );
  FOR v_row IN
    SELECT * FROM (VALUES
      ('pi_a4271tap', 1),        -- a phone-reported amount that is not the server price
      ('pi_a4271tap', 1499),
      ('pi_unknown4271', 1500),  -- no such intent
      ('not-a-pi', 1500)
    ) AS c(pi, amount)
  LOOP
    v_raised := NULL;
    BEGIN
      PERFORM public.biz_door_tap_record(v_row.pi, 'ch_x', v_row.amount, 'visa', '4242');
    EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
    END;
    IF v_raised IS NULL THEN
      v_fail := v_fail || format('A-TAP %s / %s must be refused', v_row.pi, v_row.amount);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.orders WHERE stripe_payment_intent_id = 'pi_a4271tap') THEN
    v_fail := v_fail || text 'A-TAP a refused tap still wrote an order';
  END IF;
  v_result := public.biz_door_tap_record('pi_a4271tap', 'ch_a4271tap', 1500, 'VISA', '4242');
  v_result := public.biz_door_tap_record('pi_a4271tap', 'ch_a4271tap', 1500, 'VISA', '4242');
  IF (v_result->>'replayed')::boolean IS DISTINCT FROM true THEN
    v_fail := v_fail || text 'A-TAP the second record must be a replay';
  END IF;
  SELECT count(*) INTO v_count FROM public.door_sales_ledger WHERE payment_method = 'tap_to_pay'
     AND order_id = (v_result->>'orderId')::uuid;
  IF v_count <> 1 THEN
    v_fail := v_fail || format('A-TAP a replay must not add ledger rows, got %s', v_count);
  END IF;
  SELECT count(*) INTO v_count FROM public.tickets
   WHERE order_id = (v_result->>'orderId')::uuid AND status = 'used';
  IF v_count <> 1 THEN
    v_fail := v_fail || format('A-TAP tap tickets must be born used, got %s', v_count);
  END IF;
  IF has_function_privilege('authenticated', 'public.biz_door_tap_record(text, text, integer, text, text)', 'EXECUTE') THEN
    v_fail := v_fail || text 'A-TAP a signed-in phone may call biz_door_tap_record directly';
  END IF;

  -- ------------------------------------------------------------------ A-TEAM
  FOREACH v_text IN ARRAY ARRAY[v_mgr_b::text, v_removed_member::text, v_pending_mgr::text, v_guest::text] LOOP
    PERFORM set_config('request.jwt.claim.sub', v_text, true);
    v_raised := NULL;
    BEGIN
      PERFORM count(*) FROM public.biz_brand_team_members(v_brand);
    EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
    END;
    IF v_raised IS DISTINCT FROM 'brand_access_denied' THEN
      v_fail := v_fail || format('A-TEAM %s must be refused, got %s', v_text, coalesce(v_raised, 'rows'));
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_raised := NULL;
  BEGIN
    PERFORM count(*) FROM public.biz_brand_team_members(v_brand);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  IF v_raised IS DISTINCT FROM 'brand_access_denied' THEN
    v_fail := v_fail || format('A-TEAM a caller with no session must be refused, got %s', coalesce(v_raised, 'rows'));
  END IF;
  IF has_function_privilege('anon', 'public.biz_brand_team_members(uuid)', 'EXECUTE') THEN
    v_fail := v_fail || text 'A-TEAM anon may execute biz_brand_team_members';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_brand_plain::text, true);
  SELECT count(*) AS total,
         count(*) FILTER (WHERE t.user_id IN (v_owner_b, v_mgr_b)) AS other_brand,
         count(*) FILTER (WHERE t.user_id IN (v_pending_mgr, v_removed_member)) AS not_accepted,
         count(*) FILTER (WHERE t.display_name = t.user_id::text OR t.email = t.user_id::text) AS raw_ids,
         count(*) FILTER (WHERE t.user_id = v_brand_inv AND t.display_name = 'Ivy Invited') AS named,
         count(*) FILTER (WHERE t.user_id = v_brand_plain AND t.display_name IS NULL AND t.email = 'plain.a4271@example.test') AS email_only
    INTO v_row
    FROM public.biz_brand_team_members(v_brand) t;
  IF v_row.total <> 3 THEN
    v_fail := v_fail || format('A-TEAM brand A must list exactly its 3 accepted members, got %s', v_row.total);
  END IF;
  IF v_row.other_brand <> 0 THEN
    v_fail := v_fail || text 'A-TEAM another brand''s members leaked into the list';
  END IF;
  IF v_row.not_accepted <> 0 THEN
    v_fail := v_fail || text 'A-TEAM pending or removed members were listed';
  END IF;
  IF v_row.raw_ids <> 0 THEN
    v_fail := v_fail || text 'A-TEAM a raw user id was returned as a name or email';
  END IF;
  IF v_row.named <> 1 OR v_row.email_only <> 1 THEN
    v_fail := v_fail || text 'A-TEAM names / email fallbacks are wrong';
  END IF;

  -- ------------------------------------------------------------------- A-RLS
  IF has_table_privilege('anon', 'public.door_pay_codes', 'SELECT')
     OR has_table_privilege('anon', 'public.door_pay_codes', 'INSERT')
     OR has_table_privilege('authenticated', 'public.door_pay_codes', 'INSERT')
     OR has_table_privilege('authenticated', 'public.door_pay_codes', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.door_tap_intents', 'SELECT') THEN
    v_fail := v_fail || text 'A-RLS a client role holds a write (or anon a read) on the door tables';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_mgr_b::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.door_pay_codes WHERE brand_id = v_brand;
  EXECUTE 'RESET ROLE';
  IF v_count <> 0 THEN
    v_fail := v_fail || format('A-RLS brand B''s manager read %s of brand A''s codes', v_count);
  END IF;

  -- ----------------------------------------------------------------- A-CLAIM
  PERFORM set_config('request.jwt.claim.sub', '', true);
  -- The guest proves their number in Explorer; their pay-code door order must
  -- appear. One order on the live event, one on the scheduled event (doors
  -- open 30 minutes before the start time; the door quote allows it).
  INSERT INTO public.verified_phone_identities (user_id, phone_e164) VALUES (v_guest, '+12025550177');
  FOR v_row IN SELECT * FROM (VALUES (v_event, v_tier_both, 'WVVE2345', v_date), (v_event_sched, v_tier_sched, 'SCHD2345', v_date_sched)) AS c(ev, tier, code, dt) LOOP
    v_code := gen_random_uuid();
    INSERT INTO public.door_pay_codes (
      id, brand_id, event_id, event_date_id, code, lines, currency, subtotal_cents,
      fee_cents, total_cents, provider, created_by
    ) VALUES (
      v_code, v_brand, v_row.ev, v_row.dt, v_row.code,
      jsonb_build_array(jsonb_build_object('ticketTypeId', v_row.tier, 'quantity', 1)),
      'USD', 1500, 70, 1570, 'stripe', v_owner
    );
    v_session := gen_random_uuid();
    INSERT INTO public.ticket_checkout_sessions (
      id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
      total_cents, currency, status, idempotency_key, expires_at
    ) VALUES (
      v_session, v_row.ev, v_brand, 'Claimer', 'claimer.a4271@example.test', '+12025550177',
      1570, 'USD', 'awaiting_web_redirect', 'a4271-claim-'||v_session, now() + interval '15 minutes'
    );
    PERFORM public.issue_4271_door_pay_code_link_session(v_code, v_session);
    v_order := gen_random_uuid();
    INSERT INTO public.orders (
      id, event_id, buyer_name, buyer_email, buyer_phone, buyer_phone_e164,
      total_cents, currency, payment_method, payment_status, checkout_session_id,
      source, stripe_payment_intent_id, stripe_charge_id
    ) VALUES (
      v_order, v_row.ev, 'Claimer', 'claimer.a4271@example.test', '+12025550177',
      '+12025550177', 1570, 'USD', 'online_card', 'paid', v_session,
      'online_checkout', 'pi_a4271c'||v_row.code, 'ch_a4271c'||v_row.code
    );
    INSERT INTO public.tickets (id, order_id, ticket_type_id, event_id, qr_code, status, approval_status)
    VALUES (gen_random_uuid(), v_order, v_row.tier, v_row.ev, 'a4271-claim-'||v_row.code, 'valid', 'auto');
    UPDATE public.ticket_checkout_sessions SET order_id = v_order WHERE id = v_session;
    IF (SELECT status FROM public.tickets WHERE order_id = v_order) <> 'used' THEN
      v_fail := v_fail || format('A-CLAIM %s ticket must be born used', v_row.code);
    END IF;
    IF NOT public.account_owns_order_contact(v_guest, v_order) THEN
      v_fail := v_fail || format('A-CLAIM %s the guest must own the order contact', v_row.code);
    END IF;
  END LOOP;
  v_result := public.claim_attendance_by_verified_identity(v_guest);
  SELECT count(*) INTO v_count FROM public.orders o
    JOIN public.door_pay_codes c ON c.order_id = o.id
   WHERE o.buyer_user_id = v_guest AND c.code = 'WVVE2345';
  IF v_count <> 1 THEN
    v_fail := v_fail || format('A-CLAIM the live-event pay-code order was not claimed in Explorer: %s', v_result);
  END IF;
  SELECT count(*) INTO v_count FROM public.orders o
    JOIN public.door_pay_codes c ON c.order_id = o.id
   WHERE o.buyer_user_id = v_guest AND c.code = 'SCHD2345';
  IF v_count <> 1 THEN
    v_fail := v_fail || text 'A-CLAIM DEFECT a pay-code order on a scheduled event (doors open before the start) is never claimable: its tickets are born used and the claim only takes valid tickets on scheduled events';
  END IF;

  -- ---------------------------------------------------------------- A-ONLINE
  -- Every tier a pay code accepts must be payable by the online checkout the
  -- guest is sent to. A door-only tier (available_online = false) is accepted
  -- by the door quote, so the checkout quote must accept it too.
  v_ok := true;
  BEGIN
    PERFORM public.issue_4271_door_quote_lines(v_event, NULL,
      jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_door, 'quantity', 1)));
  EXCEPTION WHEN OTHERS THEN v_ok := false;
  END;
  IF v_ok THEN
    v_raised := NULL;
    BEGIN
      PERFORM public.issue_3872_ticket_quote(
        v_event, jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_door, 'quantity', 1)),
        NULL, NULL, NULL, NULL, 'full', NULL, 'guest.a4271@example.test', '+12025550101',
        NULL, NULL, false);
    EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
    END;
    IF v_raised IS NOT NULL THEN
      v_fail := v_fail || format('A-ONLINE DEFECT a door-only tier gets a pay code but the guest''s checkout refuses it (%s)', v_raised);
    END IF;
  END IF;
  -- Control: a tier sold both ways passes both quotes.
  v_raised := NULL;
  BEGIN
    PERFORM public.issue_3872_ticket_quote(
      v_event, jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_both, 'quantity', 1)),
      NULL, NULL, NULL, NULL, 'full', NULL, 'guest.a4271@example.test', '+12025550101',
      NULL, NULL, false);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  IF v_raised IS NOT NULL THEN
    v_fail := v_fail || format('A-ONLINE control: a tier sold online must pass the checkout quote, got %s', v_raised);
  END IF;

  -- ------------------------------------------------------------------ verdict
  IF array_length(v_fail, 1) IS NOT NULL THEN
    RAISE EXCEPTION E'#4271 tester adversarial: % failure(s)\n  - %',
      array_length(v_fail, 1), array_to_string(v_fail, E'\n  - ');
  END IF;
  RAISE NOTICE '#4271 tester adversarial: all checks passed';
END;
$test$;

ROLLBACK;
