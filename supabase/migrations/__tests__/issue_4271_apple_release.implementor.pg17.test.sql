-- Issue #4271 phase 2 — the Tap to Pay release switch and the Apple build's
-- server state, on the fully replayed PG17 schema.
--
--   A-RELEASE  biz_tap_to_pay_release returns only {iphone, android}; defaults
--              off; a listed test brand is on and another brand is not; the
--              list is never returned; bad values read as off; a missing row
--              reads as off; authenticated may call it, anon may not.
--   A-BRAND-PERM  the brand-wide door permission: owner, event manager and a
--              brand scanner with the switch may; a brand scanner without it, an
--              event-only scanner and an outsider may not; service role only.
--   A-UNFINISHED  the sweep's columns exist and authenticated can't touch the table.
BEGIN;
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'door_tap_intents'
         AND column_name IN ('outcome_seen_at','unfinished_notified_at')) <> 2 THEN
    RAISE EXCEPTION 'A-UNFINISHED both columns must exist';
  END IF;
  IF has_table_privilege('authenticated', 'public.door_tap_intents', 'SELECT')
     OR has_table_privilege('authenticated', 'public.door_tap_intents', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.door_tap_intents', 'outcome_seen_at', 'UPDATE') THEN
    RAISE EXCEPTION 'A-UNFINISHED authenticated must have no access';
  END IF;
END;
$$;
DO $$
DECLARE
  v_listed uuid := '42710000-0000-4000-8000-00000000b001';
  v_other uuid := '42710000-0000-4000-8000-00000000b002';
  v_answer jsonb;
BEGIN
  v_answer := public.biz_tap_to_pay_release(v_other);
  IF v_answer <> '{"iphone":false,"android":false}'::jsonb THEN
    RAISE EXCEPTION 'A-RELEASE default must be off with exactly two keys, got %', v_answer;
  END IF;

  UPDATE public.ops_settings
     SET value = jsonb_build_object('iphone', false, 'android', false, 'test_brand_ids', jsonb_build_array(v_listed))
   WHERE key = 'tap_to_pay_release';
  v_answer := public.biz_tap_to_pay_release(v_listed);
  IF v_answer <> '{"iphone":true,"android":true}'::jsonb THEN
    RAISE EXCEPTION 'A-RELEASE a listed brand must be on, got %', v_answer;
  END IF;
  v_answer := public.biz_tap_to_pay_release(v_other);
  IF v_answer <> '{"iphone":false,"android":false}'::jsonb THEN
    RAISE EXCEPTION 'A-RELEASE another brand must stay off, got %', v_answer;
  END IF;
  IF v_answer ? 'test_brand_ids' THEN
    RAISE EXCEPTION 'A-RELEASE the list must never be returned';
  END IF;

  UPDATE public.ops_settings
     SET value = '{"iphone":true,"android":false,"test_brand_ids":[]}'::jsonb
   WHERE key = 'tap_to_pay_release';
  v_answer := public.biz_tap_to_pay_release(v_other);
  IF v_answer <> '{"iphone":true,"android":false}'::jsonb THEN
    RAISE EXCEPTION 'A-RELEASE flags are read per platform, got %', v_answer;
  END IF;

  UPDATE public.ops_settings
     SET value = '{"iphone":"yes","android":1,"test_brand_ids":"everyone"}'::jsonb
   WHERE key = 'tap_to_pay_release';
  v_answer := public.biz_tap_to_pay_release(v_other);
  IF v_answer <> '{"iphone":false,"android":false}'::jsonb THEN
    RAISE EXCEPTION 'A-RELEASE a bad value must read as off, got %', v_answer;
  END IF;

  UPDATE public.ops_settings SET value = '"on"'::jsonb WHERE key = 'tap_to_pay_release';
  v_answer := public.biz_tap_to_pay_release(v_other);
  IF v_answer <> '{"iphone":false,"android":false}'::jsonb THEN
    RAISE EXCEPTION 'A-RELEASE a non-object must read as off, got %', v_answer;
  END IF;

  DELETE FROM public.ops_settings WHERE key = 'tap_to_pay_release';
  v_answer := public.biz_tap_to_pay_release(v_other);
  IF v_answer <> '{"iphone":false,"android":false}'::jsonb THEN
    RAISE EXCEPTION 'A-RELEASE a missing row must read as off, got %', v_answer;
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.biz_tap_to_pay_release(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A-RELEASE authenticated must be able to call it';
  END IF;
  IF has_function_privilege('anon', 'public.biz_tap_to_pay_release(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A-RELEASE anon must not be able to call it';
  END IF;
END;
$$;

DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_pay uuid := gen_random_uuid();
  v_plain uuid := gen_random_uuid();
  v_event_only uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email)
  SELECT id, id::text || '@example.test'
    FROM unnest(ARRAY[v_owner, v_manager, v_pay, v_plain, v_event_only, v_outsider]) AS id;
  INSERT INTO public.creator_accounts (id, email, display_name)
  SELECT id, id::text || '@example.test', 'Member'
    FROM unnest(ARRAY[v_owner, v_manager, v_pay, v_plain, v_event_only, v_outsider]) AS id;
  INSERT INTO public.brands (id, account_id, name, slug, default_currency, pricing_currency, payment_provider)
  VALUES (v_brand, v_owner, 'Brand perm', 'brand-perm-'||v_brand, 'USD', 'USD', 'stripe');
  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at, permissions_override) VALUES
    (v_brand, v_owner, 'brand_owner', now(), now(), '{}'::jsonb),
    (v_brand, v_manager, 'event_manager', now(), now(), '{}'::jsonb),
    (v_brand, v_pay, 'scanner', now(), now(), '{"canAcceptPayments":true}'::jsonb),
    (v_brand, v_plain, 'scanner', now(), now(), '{}'::jsonb)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_event, v_brand, 'Night', 'brand-perm-'||v_event, 'event', 'live', 'public', 'UTC', 'USD');
  INSERT INTO public.event_scanners (event_id, user_id, permissions, assigned_by)
  VALUES (v_event, v_event_only, '{"canAcceptPayments":true}'::jsonb, v_owner);

  IF NOT public.issue_4271_can_take_brand_door_payment(v_brand, v_owner) THEN
    RAISE EXCEPTION 'A-BRAND-PERM owner must be allowed';
  END IF;
  IF NOT public.issue_4271_can_take_brand_door_payment(v_brand, v_manager) THEN
    RAISE EXCEPTION 'A-BRAND-PERM event manager must be allowed';
  END IF;
  IF NOT public.issue_4271_can_take_brand_door_payment(v_brand, v_pay) THEN
    RAISE EXCEPTION 'A-BRAND-PERM a brand scanner with the switch must be allowed';
  END IF;
  IF public.issue_4271_can_take_brand_door_payment(v_brand, v_plain) THEN
    RAISE EXCEPTION 'A-BRAND-PERM a brand scanner without the switch must be refused';
  END IF;
  IF public.issue_4271_can_take_brand_door_payment(v_brand, v_event_only) THEN
    RAISE EXCEPTION 'A-BRAND-PERM an event-only scanner gets no brand-wide session';
  END IF;
  IF public.issue_4271_can_take_brand_door_payment(v_brand, v_outsider) THEN
    RAISE EXCEPTION 'A-BRAND-PERM an outsider must be refused';
  END IF;
  IF public.issue_4271_can_take_brand_door_payment(v_brand, NULL) THEN
    RAISE EXCEPTION 'A-BRAND-PERM no actor must be refused';
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_4271_can_take_brand_door_payment(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A-BRAND-PERM service role only';
  END IF;
END;
$$;

-- O8  online late refunds and the evidence hold use what was charged.
DO $o8$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_brand_ps uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_event_ps uuid := gen_random_uuid();
  v_tier uuid := gen_random_uuid();
  v_tier_ps uuid := gen_random_uuid();
  v_session uuid;
  v_claim jsonb;
  v_answer jsonb;
  v_row public.source_refunds%ROWTYPE;
  v_outbox uuid;
  v_pi text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'owner.o8@example.test');
  INSERT INTO public.creator_accounts (id, email, display_name) VALUES (v_owner, 'owner.o8@example.test', 'Owner');
  INSERT INTO public.brands (id, account_id, name, slug, default_currency, pricing_currency, payment_provider, payout_hold_cutover_at)
  VALUES (v_brand, v_owner, 'O8', 'o8-'||v_brand, 'GBP', 'GBP', 'stripe', now() - interval '1 day'),
         (v_brand_ps, v_owner, 'O8 ps', 'o8-ps-'||v_brand_ps, 'NGN', 'NGN', 'paystack', now() - interval '1 day');
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone, currency) VALUES
    (v_event, v_brand, 'O8 night', 'o8-'||v_event, 'event', 'scheduled', 'public', 'UTC', 'GBP'),
    (v_event_ps, v_brand_ps, 'O8 lagos', 'o8-'||v_event_ps, 'event', 'scheduled', 'public', 'UTC', 'NGN');
  INSERT INTO public.ticket_types (id, event_id, name, price_cents, currency, is_free, quantity_total, min_purchase_qty, available_online, available_in_person, display_order) VALUES
    (v_tier, v_event, 'General', 1500, 'GBP', false, 50, 1, true, false, 0),
    (v_tier_ps, v_event_ps, 'General', 1500000, 'NGN', false, 50, 1, true, false, 0);

  -- A hosted Stripe session helper, as a loop over the cases that differ.
  -- Case NO-TOTAL: nothing recorded, the refund falls back to total_cents.
  v_session := gen_random_uuid();
  v_pi := 'pi_o8'||replace(v_session::text,'-','');
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, status,
    idempotency_key, expires_at, stripe_account_id, stripe_checkout_session_id, stripe_payment_intent_id
  ) VALUES (
    v_session, v_event, v_brand, 'Guest', 'guest.o8@example.test', '+447700900123', 3000, 'GBP',
    'awaiting_web_redirect', 'o8-'||v_session, now() + interval '40 minutes', 'acct_o8',
    'cs_o8'||replace(v_session::text,'-',''), v_pi
  );
  INSERT INTO public.ticket_checkout_session_items (checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity, unit_price_cents, total_cents)
  VALUES (v_session, v_tier, 'General', 2, 1500, 3000);
  v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event, 'stripe', 'stripe_checkout', 'o8-fp-'||v_session);
  PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, NULL, 'cs_o8'||replace(v_session::text,'-',''), NULL, 'o8-cont-'||v_session);
  PERFORM public.issue_1930_mint_ticket_late_reversal(v_session, 'stripe', v_pi, NULL, 'ch_o8'||replace(v_session::text,'-',''));
  SELECT * INTO v_row FROM public.source_refunds WHERE source_id = v_session AND refund_kind = 'late_payment_no_value';
  IF NOT FOUND OR v_row.buyer_refund_requested_cents <> 3000 OR v_row.original_charge_cents <> 3000
     OR v_row.fee_reversal_required_cents <> 0 THEN
    RAISE EXCEPTION 'O8 no recorded total must refund total_cents: %', to_jsonb(v_row);
  END IF;

  -- Final test P3-4: no provider total recorded on the session, but the stored
  -- webhook event holds Stripe's own amount: the refund uses that, not the
  -- create-time computed total. Three variants: the payment_intent.succeeded
  -- amount (tax on top), the checkout.session.completed amount (below the
  -- computed total), and a recorded provider total that wins over the event.
  FOR v_answer IN
    SELECT jsonb_build_object('tag', tag, 'type', typ, 'amount', amt, 'reconcile', rec, 'expect', exp)
      FROM (VALUES
        ('PI', 'payment_intent.succeeded', 3385, NULL::integer, 3385),
        ('CS', 'checkout.session.completed', 3000, NULL::integer, 3000),
        ('RECORDED', 'payment_intent.succeeded', 9999, 3385, 3385)
      ) x(tag, typ, amt, rec, exp)
  LOOP
    v_session := gen_random_uuid();
    v_pi := 'pi_o8wh'||replace(v_session::text,'-','');
    INSERT INTO public.ticket_checkout_sessions (
      id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, status,
      idempotency_key, expires_at, stripe_account_id, stripe_checkout_session_id, stripe_payment_intent_id,
      stripe_application_fee_amount_cents, list_subtotal_cents, discount_cents, net_subtotal_cents,
      buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source
    ) VALUES (
      v_session, v_event, v_brand, 'Guest', 'guest.o8@example.test', '+447700900123', 3000, 'GBP',
      'awaiting_web_redirect', 'o8-'||v_session, now() + interval '40 minutes', 'acct_o8',
      'cs_o8'||replace(v_session::text,'-',''), v_pi, 135, 3000, 0, 3000, 135, 0, 3135, 'computed_at_checkout'
    );
    INSERT INTO public.ticket_checkout_session_items (checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity, unit_price_cents, total_cents)
    VALUES (v_session, v_tier, 'General', 2, 1500, 3000);
    INSERT INTO public.payment_webhook_events(stripe_event_id, type, payload, provider, provider_event_type)
    VALUES ('evt_o8'||replace(v_session::text,'-',''), v_answer->>'type',
      CASE WHEN v_answer->>'type' = 'payment_intent.succeeded'
        THEN jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
          'id', v_pi, 'amount_received', (v_answer->>'amount')::integer, 'currency', 'gbp')))
        ELSE jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
          'id', 'cs_o8'||replace(v_session::text,'-',''), 'payment_intent', v_pi,
          'amount_total', (v_answer->>'amount')::integer, 'currency', 'gbp')))
      END,
      'stripe', v_answer->>'type');
    v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event, 'stripe', 'stripe_checkout', 'o8-fp-'||v_session);
    PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, NULL, 'cs_o8'||replace(v_session::text,'-',''), NULL, 'o8-cont-'||v_session);
    IF v_answer->>'reconcile' IS NOT NULL THEN
      PERFORM public.issue_3872_record_ticket_provider_total(v_session, 'stripe', (v_answer->>'reconcile')::bigint, 250);
    END IF;
    PERFORM public.issue_1930_mint_ticket_late_reversal(v_session, 'stripe', v_pi, NULL, 'ch_o8'||replace(v_session::text,'-',''));
    SELECT * INTO v_row FROM public.source_refunds WHERE source_id = v_session AND refund_kind = 'late_payment_no_value';
    IF NOT FOUND OR v_row.buyer_refund_requested_cents <> (v_answer->>'expect')::integer
       OR v_row.original_charge_cents <> (v_answer->>'expect')::integer
       OR v_row.fee_reversal_required_cents <> 135
       OR v_row.organizer_refund_liability_cents <> (v_answer->>'expect')::integer - 135 THEN
      RAISE EXCEPTION 'O8-WEBHOOK % the refund must be the provider''s own amount: %', v_answer->>'tag', to_jsonb(v_row);
    END IF;
  END LOOP;

  -- Paystack: the charge.success amount is used the same way.
  v_session := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, status,
    idempotency_key, expires_at, application_fee_amount_cents
  ) VALUES (
    v_session, v_event_ps, v_brand_ps, 'Guest', 'guest.o8@example.test', '+2348012345678', 1567500, 'NGN',
    'awaiting_web_redirect', 'o8-'||v_session, now() + interval '40 minutes', 67500
  );
  INSERT INTO public.ticket_checkout_session_items (checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity, unit_price_cents, total_cents)
  VALUES (v_session, v_tier_ps, 'General', 1, 1500000, 1500000);
  INSERT INTO public.payment_webhook_events(stripe_event_id, type, payload, provider, provider_event_type)
  VALUES ('paystack:o8'||replace(v_session::text,'-',''), 'charge.success',
    jsonb_build_object('event', 'charge.success', 'data', jsonb_build_object(
      'reference', 'pswh'||replace(v_session::text,'-',''), 'amount', 1560000, 'currency', 'NGN')),
    'paystack', 'charge.success');
  v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event_ps, 'paystack', 'paystack_redirect', 'o8-fp-'||v_session);
  PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, NULL, NULL, 'pswh'||replace(v_session::text,'-',''), 'o8-cont-'||v_session);
  PERFORM public.issue_1930_mint_ticket_late_reversal(v_session, 'paystack', 'pswh'||replace(v_session::text,'-',''), '900323456', NULL);
  SELECT * INTO v_row FROM public.source_refunds WHERE source_id = v_session AND refund_kind = 'late_payment_no_value';
  IF NOT FOUND OR v_row.buyer_refund_requested_cents <> 1560000 OR v_row.original_charge_cents <> 1560000 THEN
    RAISE EXCEPTION 'O8-WEBHOOK Paystack the refund must be the charge.success amount: %', to_jsonb(v_row);
  END IF;

  -- Case TAX: the webhook records Stripe's total, with tax, before the refund is minted.
  v_session := gen_random_uuid();
  v_pi := 'pi_o8'||replace(v_session::text,'-','');
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, status,
    idempotency_key, expires_at, stripe_account_id, stripe_checkout_session_id, stripe_payment_intent_id,
    stripe_application_fee_amount_cents, list_subtotal_cents, discount_cents, net_subtotal_cents,
    buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source
  ) VALUES (
    v_session, v_event, v_brand, 'Guest', 'guest.o8@example.test', '+447700900123', 3000, 'GBP',
    'awaiting_web_redirect', 'o8-'||v_session, now() + interval '40 minutes', 'acct_o8',
    'cs_o8'||replace(v_session::text,'-',''), v_pi, 135, 3000, 0, 3000, 135, 0, 3135, 'computed_at_checkout'
  );
  INSERT INTO public.ticket_checkout_session_items (checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity, unit_price_cents, total_cents)
  VALUES (v_session, v_tier, 'General', 2, 1500, 3000);
  v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event, 'stripe', 'stripe_checkout', 'o8-fp-'||v_session);
  PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, NULL, 'cs_o8'||replace(v_session::text,'-',''), NULL, 'o8-cont-'||v_session);
  PERFORM public.issue_3872_record_ticket_provider_total(v_session, 'stripe', 3385, 250);
  PERFORM public.issue_1930_mint_ticket_late_reversal(v_session, 'stripe', v_pi, NULL, 'ch_o8'||replace(v_session::text,'-',''));
  SELECT * INTO v_row FROM public.source_refunds WHERE source_id = v_session AND refund_kind = 'late_payment_no_value';
  IF NOT FOUND OR v_row.buyer_refund_requested_cents <> 3385 THEN
    RAISE EXCEPTION 'O8 the refund must include tax Stripe charged: %', to_jsonb(v_row);
  END IF;

  -- Case PAYSTACK: total_cents is already all-in and must not double.
  v_session := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, status,
    idempotency_key, expires_at, application_fee_amount_cents
  ) VALUES (
    v_session, v_event_ps, v_brand_ps, 'Guest', 'guest.o8@example.test', '+2348012345678', 1567500, 'NGN',
    'awaiting_web_redirect', 'o8-'||v_session, now() + interval '40 minutes', 67500
  );
  INSERT INTO public.ticket_checkout_session_items (checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity, unit_price_cents, total_cents)
  VALUES (v_session, v_tier_ps, 'General', 1, 1500000, 1500000);
  v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event_ps, 'paystack', 'paystack_redirect', 'o8-fp-'||v_session);
  PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, NULL, NULL, 'pso8'||replace(v_session::text,'-',''), 'o8-cont-'||v_session);
  PERFORM public.issue_1930_mint_ticket_late_reversal(v_session, 'paystack', 'pso8'||replace(v_session::text,'-',''), '900223456', NULL);
  SELECT * INTO v_row FROM public.source_refunds WHERE source_id = v_session AND refund_kind = 'late_payment_no_value';
  IF NOT FOUND OR v_row.buyer_refund_requested_cents <> 1567500 OR v_row.original_charge_cents <> 1567500
     OR v_row.organizer_refund_liability_cents <> 1500000 THEN
    RAISE EXCEPTION 'O8 Paystack is all-in already, nothing doubles: %', to_jsonb(v_row);
  END IF;

  -- Case HOLD: a held payment with passed fees completes the sale.
  v_session := gen_random_uuid();
  v_pi := 'pi_o8hold'||replace(v_session::text,'-','');
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, currency, subtotal_cents, total_cents, status,
    idempotency_key, expires_at, application_fee_amount_cents, list_subtotal_cents, discount_cents, net_subtotal_cents,
    buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source
  ) VALUES (
    v_session, v_event, v_brand, 'Hold', 'hold.o8@example.test', '+447700900123', 'GBP', 3000, 3000, 'requires_payment',
    'o8-'||v_session, now() + interval '15 minutes', 135, 3000, 0, 3000, 135, 0, 3135, 'computed_at_checkout'
  );
  INSERT INTO public.ticket_checkout_session_items (checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity, unit_price_cents, total_cents)
  VALUES (v_session, v_tier, 'General', 2, 1500, 3000);
  v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event, 'stripe', 'stripe_native', 'o8-fp-'||v_session);
  PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, v_pi, NULL, NULL, 'o8-cont-'||v_session);
  UPDATE public.ticket_checkout_sessions SET stripe_account_id = 'acct_o8', stripe_payment_intent_id = v_pi WHERE id = v_session;
  v_answer := public.issue_2079_verify_ticket_paid_identity(v_session, 'stripe', v_pi, NULL, NULL, 'acct_o8');
  IF v_answer->>'outcome' <> 'attention' THEN RAISE EXCEPTION 'O8 hold fixture did not hold: %', v_answer; END IF;
  v_answer := public.release_ticket_checkout_evidence_hold(v_session, 'stripe', v_pi, NULL, 'ch_o8hold', 'acct_o8', 3135, 'gbp');
  IF v_answer->>'outcome' <> 'released' THEN
    RAISE EXCEPTION 'O8 a held payment with passed fees must complete the sale: %', v_answer;
  END IF;

  -- A wrong amount still keeps the refund.
  v_session := gen_random_uuid();
  v_pi := 'pi_o8hold'||replace(v_session::text,'-','');
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, currency, subtotal_cents, total_cents, status,
    idempotency_key, expires_at, application_fee_amount_cents, list_subtotal_cents, discount_cents, net_subtotal_cents,
    buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source
  ) VALUES (
    v_session, v_event, v_brand, 'Hold', 'hold2.o8@example.test', '+447700900123', 'GBP', 3000, 3000, 'requires_payment',
    'o8-'||v_session, now() + interval '15 minutes', 135, 3000, 0, 3000, 135, 0, 3135, 'computed_at_checkout'
  );
  INSERT INTO public.ticket_checkout_session_items (checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity, unit_price_cents, total_cents)
  VALUES (v_session, v_tier, 'General', 2, 1500, 3000);
  v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event, 'stripe', 'stripe_native', 'o8-fp-'||v_session);
  PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, v_pi, NULL, NULL, 'o8-cont-'||v_session);
  UPDATE public.ticket_checkout_sessions SET stripe_account_id = 'acct_o8', stripe_payment_intent_id = v_pi WHERE id = v_session;
  PERFORM public.issue_2079_verify_ticket_paid_identity(v_session, 'stripe', v_pi, NULL, NULL, 'acct_o8');
  v_answer := public.release_ticket_checkout_evidence_hold(v_session, 'stripe', v_pi, NULL, 'ch_o8hold2', 'acct_o8', 3000, 'gbp');
  IF v_answer->>'reason' IS DISTINCT FROM 'amount_mismatch' THEN
    RAISE EXCEPTION 'O8 the bare ticket base is no longer the charge: %', v_answer;
  END IF;

  -- Operator review shows the charge; no money moves on this path.
  v_session := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, currency, subtotal_cents, total_cents, status,
    idempotency_key, expires_at, application_fee_amount_cents, stripe_account_id, list_subtotal_cents, discount_cents,
    net_subtotal_cents, buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source
  ) VALUES (
    v_session, v_event, v_brand, 'Review', 'review.o8@example.test', '+447700900123', 'GBP', 3000, 3000, 'failed',
    'o8-'||v_session, now() + interval '15 minutes', 135, 'acct_o8', 3000, 0, 3000, 135, 0, 3135, 'computed_at_checkout'
  );
  INSERT INTO public.checkout_sale_revocation_outbox (subject_type, subject_id, event_id, target_epoch, reason, state, last_error_code)
  VALUES ('ticket_checkout_session', v_session, v_event, 1, 'paid_provider_reference_missing', 'provider_unknown', 'paid_provider_reference_missing')
  RETURNING id INTO v_outbox;
  IF public.issue_2168_handoff_revocation_attention(v_outbox) <> 'attention_created' THEN
    RAISE EXCEPTION 'O8 handoff did not create attention';
  END IF;
  SELECT * INTO v_row FROM public.source_refunds WHERE source_id = v_session AND refund_kind = 'checkout_provider_reference_unresolved';
  IF v_row.original_charge_cents <> 3135 OR v_row.buyer_refund_requested_cents <> 3000
     OR v_row.buyer_refund_processed_cents <> 0 THEN
    RAISE EXCEPTION 'O8 the review row must show the charge: %', to_jsonb(v_row);
  END IF;

  -- The replacement keeps the newer guard: paid evidence with an owner opens nothing.
  UPDATE public.checkout_sale_revocation_outbox SET state = 'sale_completed' WHERE id = v_outbox;
  IF public.issue_2168_handoff_revocation_attention(v_outbox) <> 'already_owned' THEN
    RAISE EXCEPTION 'O8 a completed sale must not open a review row';
  END IF;
END;
$o8$;
ROLLBACK;
