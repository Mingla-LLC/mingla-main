-- Issue #4271 — final TESTER adversarial suite (money). Different angles from
-- the implementor's R-REFUND / O8 cases and the earlier tester's B-* probes:
--
--   F-ATTN      the OTHER creator of a ticket late refund (the #2079 identity
--               hold, reached when Stripe sends no charge id) on a session with
--               passed fees: the held refund already carries the whole charge
--               and the fee reversal, keeps the attention shape, and promotion
--               (the charge id arrives) changes no amount.
--   F-REPLAY    a webhook replay of the same late payment answers 'existing' and
--               never lands the minter's base-amount ledger rows beside the
--               charge-amount ones.
--   F-CAP       a late refund never exceeds what the guest was charged: a
--               discounted session whose charge is below total_cents refunds
--               the charge, not total_cents.
--   F-REOPEN    a held payment with passed fees: the bare base amount is refused
--               as evidence, the charge releases the hold, and when the sale then
--               fails the reopened refund is the whole charge again with no
--               extra ledger rows.
--   F-OWNER     #2168 operator review: a session whose late refund already exists,
--               or whose sale completed with an order, opens no second row; a
--               hosted session (fee on stripe_application_fee_amount_cents) shows
--               the charge.
--   F-PT409     link_session conflicts raise SQLSTATE PT409, never 40001.
--
-- Every check records a failure; the block raises once at the end.
--
-- FAILS-ON-REVERT (verified by the final tester, see #4271 test notes):
--   * drop trigger trg_source_refunds_4271_late_amounts -> F-ATTN, F-REPLAY,
--     F-CAP, F-REOPEN fail;
--   * restore `p_amount_cents<>v_session.total_cents` in
--     release_ticket_checkout_evidence_hold -> F-REOPEN fails;
--   * restore the base amount in issue_2168_handoff_revocation_attention ->
--     F-OWNER fails;
--   * drop the "a session belongs to one code" guard from
--     issue_4271_door_pay_code_link_session -> F-PT409 fails.

\set ON_ERROR_STOP on
BEGIN;

DO $final$
DECLARE
  v_fail text[] := ARRAY[]::text[];
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_event_live uuid := gen_random_uuid();
  v_tier uuid := gen_random_uuid();
  v_tier_live uuid := gen_random_uuid();
  v_session uuid;
  v_session2 uuid;
  v_code uuid;
  v_code2 uuid;
  v_order uuid;
  v_claim jsonb;
  v_answer jsonb;
  v_row public.source_refunds%ROWTYPE;
  v_alloc jsonb;
  v_count integer;
  v_outbox uuid;
  v_pi text;
  v_state text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'owner.f4271@example.test');
  INSERT INTO public.creator_accounts (id, email, display_name) VALUES (v_owner, 'owner.f4271@example.test', 'Owner');
  INSERT INTO public.brands (id, account_id, name, slug, default_currency, pricing_currency, payment_provider, payout_hold_cutover_at)
  VALUES (v_brand, v_owner, 'F door', 'f-door-'||v_brand, 'GBP', 'GBP', 'stripe', now() - interval '1 day');
  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_brand, v_owner, 'brand_owner', now() - interval '9 days', now() - interval '9 days')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone, currency) VALUES
    (v_event, v_brand, 'F night', 'f-night-'||v_event, 'event', 'scheduled', 'public', 'UTC', 'GBP'),
    (v_event_live, v_brand, 'F live', 'f-live-'||v_event_live, 'event', 'live', 'public', 'UTC', 'GBP');
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master, occurrence_key) VALUES
    (gen_random_uuid(), v_event_live, now() - interval '1 hour', now() + interval '3 hours', 'UTC', true, 'one');
  INSERT INTO public.ticket_types (id, event_id, name, price_cents, currency, is_free, quantity_total, min_purchase_qty, available_online, available_in_person, display_order) VALUES
    (v_tier, v_event, 'General', 1500, 'GBP', false, 50, 1, true, false, 0);
  INSERT INTO public.ticket_types (id, event_id, name, price_cents, currency, quantity_total, is_unlimited, available_online, available_in_person, is_disabled, is_hidden) VALUES
    (v_tier_live, v_event_live, 'General', 1500, 'GBP', 50, false, true, true, false, false);

  -- ------------------------------------------------------------------ F-ATTN
  v_session := gen_random_uuid();
  v_pi := 'pi_fa'||replace(v_session::text,'-','');
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, status,
    idempotency_key, expires_at, stripe_account_id, stripe_checkout_session_id, stripe_payment_intent_id,
    stripe_application_fee_amount_cents, list_subtotal_cents, discount_cents, net_subtotal_cents,
    buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source
  ) VALUES (
    v_session, v_event, v_brand, 'Guest', 'guest.f4271@example.test', '+447700900123', 3000, 'GBP',
    'awaiting_web_redirect', 'f4271-'||v_session, now() + interval '40 minutes', 'acct_f4271',
    'cs_fa'||replace(v_session::text,'-',''), v_pi, 135, 3000, 0, 3000, 135, 0, 3135, 'computed_at_checkout'
  );
  INSERT INTO public.ticket_checkout_session_items (checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity, unit_price_cents, total_cents)
  VALUES (v_session, v_tier, 'General', 2, 1500, 3000);
  v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event, 'stripe', 'stripe_checkout', 'f-fp-'||v_session);
  PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, NULL, 'cs_fa'||replace(v_session::text,'-',''), v_pi, 'f-c-'||v_session);
  -- No charge id from Stripe: the identity hold creates the refund.
  v_answer := public.issue_1930_mint_ticket_late_reversal(v_session, 'stripe', v_pi, NULL, NULL);
  SELECT * INTO v_row FROM public.source_refunds WHERE source_id = v_session AND refund_kind = 'late_payment_no_value';
  IF NOT FOUND THEN
    v_fail := v_fail || format('F-ATTN the identity hold minted no refund (%s)', v_answer);
  ELSE
    IF v_row.buyer_refund_requested_cents <> 3135 OR v_row.original_charge_cents <> 3135
       OR v_row.fee_reversal_required_cents <> 135 OR v_row.fee_state <> 'queued'
       OR v_row.organizer_refund_liability_cents <> 3000 OR v_row.platform_fee_absorption_cents <> 135 THEN
      v_fail := v_fail || format('F-ATTN held refund must be the whole charge with the fee reversed: %s/%s fee %s %s',
        v_row.buyer_refund_requested_cents, v_row.original_charge_cents, v_row.fee_reversal_required_cents, v_row.fee_state);
    END IF;
    IF v_row.buyer_state <> 'needs_attention' THEN
      v_fail := v_fail || format('F-ATTN held refund must stay in attention, got %s', v_row.buyer_state);
    END IF;
    SELECT jsonb_object_agg(allocation_type, amount_cents), count(*) INTO v_alloc, v_count
      FROM public.source_refund_ledger_allocations WHERE refund_id = v_row.id;
    IF v_count <> 3 OR v_alloc IS DISTINCT FROM jsonb_build_object('buyer_refund', 3135, 'organizer_refund_liability', 3000, 'platform_application_fee_reversal', 135) THEN
      v_fail := v_fail || format('F-ATTN held allocations disagree with the refund: %s rows %s', v_count, v_alloc);
    END IF;
  END IF;
  -- The charge id arrives on Stripe's retry: promoted, no amount changes.
  v_answer := public.issue_1930_mint_ticket_late_reversal(v_session, 'stripe', v_pi, NULL, 'ch_fa'||replace(v_session::text,'-',''));
  SELECT * INTO v_row FROM public.source_refunds WHERE source_id = v_session AND refund_kind = 'late_payment_no_value';
  IF v_answer->>'outcome' <> 'promoted' OR v_row.buyer_state <> 'queued' OR v_row.buyer_refund_requested_cents <> 3135
     OR v_row.fee_reversal_required_cents <> 135 THEN
    v_fail := v_fail || format('F-ATTN promotion must keep the whole charge: %s %s %s', v_answer, v_row.buyer_state, v_row.buyer_refund_requested_cents);
  END IF;

  -- ---------------------------------------------------------------- F-REPLAY
  v_session := gen_random_uuid();
  v_pi := 'pi_fr'||replace(v_session::text,'-','');
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, status,
    idempotency_key, expires_at, stripe_account_id, stripe_checkout_session_id, stripe_payment_intent_id,
    stripe_application_fee_amount_cents, list_subtotal_cents, discount_cents, net_subtotal_cents,
    buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source
  ) VALUES (
    v_session, v_event, v_brand, 'Guest', 'guest.f4271@example.test', '+447700900123', 3000, 'GBP',
    'awaiting_web_redirect', 'f4271-'||v_session, now() + interval '40 minutes', 'acct_f4271',
    'cs_fr'||replace(v_session::text,'-',''), v_pi, 135, 3000, 0, 3000, 135, 0, 3135, 'computed_at_checkout'
  );
  v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event, 'stripe', 'stripe_checkout', 'f-fp-'||v_session);
  PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, NULL, 'cs_fr'||replace(v_session::text,'-',''), v_pi, 'f-c-'||v_session);
  PERFORM public.issue_1930_mint_ticket_late_reversal(v_session, 'stripe', v_pi, NULL, 'ch_fr'||replace(v_session::text,'-',''));
  v_answer := public.issue_1930_mint_ticket_late_reversal(v_session, 'stripe', v_pi, NULL, 'ch_fr'||replace(v_session::text,'-',''));
  SELECT count(*) INTO v_count FROM public.source_refunds WHERE source_id = v_session;
  IF v_answer->>'outcome' <> 'existing' OR v_count <> 1 THEN
    v_fail := v_fail || format('F-REPLAY a replay must answer existing with one refund: %s, %s rows', v_answer, v_count);
  END IF;
  SELECT jsonb_object_agg(l.allocation_type, l.amount_cents), count(*) INTO v_alloc, v_count
    FROM public.source_refund_ledger_allocations l
    JOIN public.source_refunds r ON r.id = l.refund_id
   WHERE r.source_id = v_session;
  IF v_count <> 3 OR v_alloc IS DISTINCT FROM jsonb_build_object('buyer_refund', 3135, 'organizer_refund_liability', 3000, 'platform_application_fee_reversal', 135) THEN
    v_fail := v_fail || format('F-REPLAY ledger must hold only the charge amounts: %s rows %s', v_count, v_alloc);
  END IF;

  -- ------------------------------------------------------------------- F-CAP
  -- A discount on the page: the guest was charged 2635 although total_cents says 3000.
  v_session := gen_random_uuid();
  v_pi := 'pi_fc'||replace(v_session::text,'-','');
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, status,
    idempotency_key, expires_at, stripe_account_id, stripe_checkout_session_id, stripe_payment_intent_id,
    stripe_application_fee_amount_cents, list_subtotal_cents, discount_cents, net_subtotal_cents,
    buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source
  ) VALUES (
    v_session, v_event, v_brand, 'Guest', 'guest.f4271@example.test', '+447700900123', 3000, 'GBP',
    'awaiting_web_redirect', 'f4271-'||v_session, now() + interval '40 minutes', 'acct_f4271',
    'cs_fc'||replace(v_session::text,'-',''), v_pi, 119, 3000, 500, 2500, 135, 0, 2635, 'computed_at_checkout'
  );
  v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event, 'stripe', 'stripe_checkout', 'f-fp-'||v_session);
  PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, NULL, 'cs_fc'||replace(v_session::text,'-',''), v_pi, 'f-c-'||v_session);
  PERFORM public.issue_1930_mint_ticket_late_reversal(v_session, 'stripe', v_pi, NULL, 'ch_fc'||replace(v_session::text,'-',''));
  SELECT * INTO v_row FROM public.source_refunds WHERE source_id = v_session AND refund_kind = 'late_payment_no_value';
  IF NOT FOUND OR v_row.buyer_refund_requested_cents <> 2635 OR v_row.original_charge_cents <> 2635
     OR v_row.fee_reversal_required_cents <> 119 OR v_row.organizer_refund_liability_cents <> 2516 THEN
    v_fail := v_fail || format('F-CAP a late refund must be the charge (2635), never more: %s', to_jsonb(v_row));
  END IF;

  -- ---------------------------------------------------------------- F-REOPEN
  v_session := gen_random_uuid();
  v_pi := 'pi_fh'||replace(v_session::text,'-','');
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, currency, subtotal_cents, total_cents, status,
    idempotency_key, expires_at, application_fee_amount_cents, list_subtotal_cents, discount_cents, net_subtotal_cents,
    buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source
  ) VALUES (
    v_session, v_event, v_brand, 'Hold', 'hold.f4271@example.test', '+447700900123', 'GBP', 3000, 3000, 'requires_payment',
    'f4271-'||v_session, now() + interval '15 minutes', 135, 3000, 0, 3000, 135, 0, 3135, 'computed_at_checkout'
  );
  INSERT INTO public.ticket_checkout_session_items (checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity, unit_price_cents, total_cents)
  VALUES (v_session, v_tier, 'General', 2, 1500, 3000);
  v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event, 'stripe', 'stripe_native', 'f-fp-'||v_session);
  PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, v_pi, NULL, NULL, 'f-c-'||v_session);
  UPDATE public.ticket_checkout_sessions SET stripe_account_id = 'acct_f4271', stripe_payment_intent_id = v_pi WHERE id = v_session;
  v_answer := public.issue_2079_verify_ticket_paid_identity(v_session, 'stripe', v_pi, NULL, NULL, 'acct_f4271');
  IF v_answer->>'outcome' IS DISTINCT FROM 'attention' THEN
    v_fail := v_fail || format('F-REOPEN fixture did not hold: %s', v_answer);
  ELSE
    -- The ticket base is not what the guest paid: it is not evidence.
    v_answer := public.release_ticket_checkout_evidence_hold(v_session, 'stripe', v_pi, NULL, 'ch_fh1', 'acct_f4271', 3000, 'GBP');
    IF v_answer->>'reason' IS DISTINCT FROM 'amount_mismatch' THEN
      v_fail := v_fail || format('F-REOPEN the base amount must not release a held charge: %s', v_answer);
    END IF;
    -- More than the charge is not evidence either.
    v_answer := public.release_ticket_checkout_evidence_hold(v_session, 'stripe', v_pi, NULL, 'ch_fh1', 'acct_f4271', 3136, 'GBP');
    IF v_answer->>'reason' IS DISTINCT FROM 'amount_mismatch' THEN
      v_fail := v_fail || format('F-REOPEN an amount above the charge must not release: %s', v_answer);
    END IF;
    v_answer := public.release_ticket_checkout_evidence_hold(v_session, 'stripe', v_pi, NULL, 'ch_fh1', 'acct_f4271', 3135, 'GBP');
    IF v_answer->>'outcome' IS DISTINCT FROM 'released' THEN
      v_fail := v_fail || format('F-REOPEN the charge must release the hold: %s', v_answer);
    ELSE
      -- The sale then fails (seat gone): the refund comes back, whole.
      v_answer := public.issue_1930_mint_ticket_late_reversal(v_session, 'stripe', v_pi, NULL, 'ch_fh1');
      SELECT * INTO v_row FROM public.source_refunds WHERE source_id = v_session AND refund_kind = 'late_payment_no_value';
      IF v_answer->>'outcome' IS DISTINCT FROM 'reopened' OR v_row.buyer_refund_requested_cents <> 3135
         OR v_row.fee_reversal_required_cents <> 135 OR v_row.fee_state <> 'queued' OR v_row.buyer_state <> 'queued' THEN
        v_fail := v_fail || format('F-REOPEN the reopened refund must be the whole charge: %s %s', v_answer, to_jsonb(v_row));
      END IF;
      SELECT jsonb_object_agg(allocation_type, amount_cents), count(*) INTO v_alloc, v_count
        FROM public.source_refund_ledger_allocations WHERE refund_id = v_row.id;
      IF v_count <> 3 OR v_alloc IS DISTINCT FROM jsonb_build_object('buyer_refund', 3135, 'organizer_refund_liability', 3000, 'platform_application_fee_reversal', 135) THEN
        v_fail := v_fail || format('F-REOPEN ledger after the round trip: %s rows %s', v_count, v_alloc);
      END IF;
    END IF;
  END IF;

  -- ----------------------------------------------------------------- F-OWNER
  -- (a) the hosted shape: Mingla's fee lives on stripe_application_fee_amount_cents.
  v_session := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, currency, total_cents, status,
    idempotency_key, expires_at, stripe_account_id, stripe_application_fee_amount_cents, list_subtotal_cents,
    discount_cents, net_subtotal_cents, buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source
  ) VALUES (
    v_session, v_event, v_brand, 'Review', 'review.f4271@example.test', '+447700900123', 'GBP', 3000, 'failed',
    'f4271-'||v_session, now() + interval '15 minutes', 'acct_f4271', 135, 3000, 0, 3000, 135, 0, 3135, 'computed_at_checkout'
  );
  INSERT INTO public.checkout_sale_revocation_outbox (subject_type, subject_id, event_id, target_epoch, reason, state, last_error_code)
  VALUES ('ticket_checkout_session', v_session, v_event, 1, 'paid_provider_reference_missing', 'provider_unknown', 'paid_provider_reference_missing')
  RETURNING id INTO v_outbox;
  v_state := public.issue_2168_handoff_revocation_attention(v_outbox);
  SELECT * INTO v_row FROM public.source_refunds WHERE source_id = v_session AND refund_kind = 'checkout_provider_reference_unresolved';
  IF v_state <> 'attention_created' OR v_row.original_charge_cents <> 3135 OR v_row.buyer_refund_requested_cents <> 3135
     OR v_row.buyer_refund_processed_cents <> 0 OR v_row.buyer_state <> 'needs_attention' THEN
    v_fail := v_fail || format('F-OWNER hosted review row must show the charge 3135: %s %s', v_state, to_jsonb(v_row));
  END IF;
  -- (b) a late refund already owns the money: no second row.
  v_session := gen_random_uuid();
  v_pi := 'pi_fo'||replace(v_session::text,'-','');
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, status,
    idempotency_key, expires_at, stripe_account_id, stripe_checkout_session_id, stripe_payment_intent_id,
    stripe_application_fee_amount_cents, list_subtotal_cents, discount_cents, net_subtotal_cents,
    buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source
  ) VALUES (
    v_session, v_event, v_brand, 'Guest', 'guest.f4271@example.test', '+447700900123', 3000, 'GBP',
    'awaiting_web_redirect', 'f4271-'||v_session, now() + interval '40 minutes', 'acct_f4271',
    'cs_fo'||replace(v_session::text,'-',''), v_pi, 135, 3000, 0, 3000, 135, 0, 3135, 'computed_at_checkout'
  );
  v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event, 'stripe', 'stripe_checkout', 'f-fp-'||v_session);
  PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, NULL, 'cs_fo'||replace(v_session::text,'-',''), v_pi, 'f-c-'||v_session);
  PERFORM public.issue_1930_mint_ticket_late_reversal(v_session, 'stripe', v_pi, NULL, 'ch_fo'||replace(v_session::text,'-',''));
  INSERT INTO public.checkout_sale_revocation_outbox (subject_type, subject_id, event_id, target_epoch, reason, state, last_error_code)
  VALUES ('ticket_checkout_session', v_session, v_event, 99, 'paid_provider_reference_missing', 'provider_unknown', 'paid_provider_reference_missing')
  RETURNING id INTO v_outbox;
  v_state := public.issue_2168_handoff_revocation_attention(v_outbox);
  SELECT count(*) INTO v_count FROM public.source_refunds WHERE source_id = v_session;
  IF v_state <> 'already_owned' OR v_count <> 1 THEN
    v_fail := v_fail || format('F-OWNER a late refund owns the money; review must not open: %s, %s rows', v_state, v_count);
  END IF;
  -- (c) the sale completed with an order: no row either.
  v_session := gen_random_uuid();
  v_order := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, currency, total_cents, status,
    idempotency_key, expires_at, stripe_account_id, stripe_application_fee_amount_cents, list_subtotal_cents,
    discount_cents, net_subtotal_cents, buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source
  ) VALUES (
    v_session, v_event, v_brand, 'Done', 'done.f4271@example.test', '+447700900123', 'GBP', 3000, 'awaiting_web_redirect',
    'f4271-'||v_session, now() + interval '15 minutes', 'acct_f4271', 135, 3000, 0, 3000, 135, 0, 3135, 'computed_at_checkout'
  );
  INSERT INTO public.orders (id, event_id, buyer_name, buyer_email, buyer_phone, buyer_phone_e164, total_cents, list_subtotal_cents, discount_cents, net_subtotal_cents, buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source, currency, payment_method, payment_status, checkout_session_id, source, stripe_payment_intent_id, stripe_charge_id)
  VALUES (v_order, v_event, 'Done', 'done.f4271@example.test', '+447700900123', '+447700900123', 3000, 3000, 0, 3000, 135, 0, 3135, 'computed_at_checkout', 'GBP', 'online_card', 'paid', v_session, 'online_checkout', 'pi_fdone'||replace(v_session::text,'-',''), 'ch_fdone'||replace(v_session::text,'-',''));
  UPDATE public.ticket_checkout_sessions SET order_id = v_order WHERE id = v_session;
  INSERT INTO public.checkout_sale_revocation_outbox (subject_type, subject_id, event_id, target_epoch, reason, state, last_error_code)
  VALUES ('ticket_checkout_session', v_session, v_event, 1, 'paid_provider_reference_missing', 'provider_unknown', 'paid_provider_reference_missing')
  RETURNING id INTO v_outbox;
  v_state := public.issue_2168_handoff_revocation_attention(v_outbox);
  SELECT count(*) INTO v_count FROM public.source_refunds WHERE source_id = v_session;
  IF v_state <> 'already_owned' OR v_count <> 0 THEN
    v_fail := v_fail || format('F-OWNER a completed sale must not open review: %s, %s rows', v_state, v_count);
  END IF;

  -- ----------------------------------------------------------------- F-PT409
  v_code := gen_random_uuid();
  v_code2 := gen_random_uuid();
  INSERT INTO public.door_pay_codes (id, brand_id, event_id, code, lines, currency, subtotal_cents, fee_cents, total_cents, provider, created_by) VALUES
    (v_code, v_brand, v_event_live, 'FPTA2345', jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_live, 'quantity', 1)), 'GBP', 1500, 68, 1568, 'stripe', v_owner),
    (v_code2, v_brand, v_event_live, 'FPTB2345', jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier_live, 'quantity', 1)), 'GBP', 1500, 68, 1568, 'stripe', v_owner);
  v_session2 := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, status,
    idempotency_key, expires_at
  ) VALUES (
    v_session2, v_event_live, v_brand, 'Guest', 'guest.f4271@example.test', '+447700900123', 1500, 'GBP',
    'requires_payment', 'f4271-'||v_session2, now() + interval '40 minutes'
  );
  IF public.issue_4271_door_pay_code_link_session(v_code, v_session2) <> 'linked' THEN
    v_fail := v_fail || text 'F-PT409 fixture: first link failed';
  END IF;
  BEGIN
    PERFORM public.issue_4271_door_pay_code_link_session(v_code2, v_session2);
    v_fail := v_fail || text 'F-PT409 a session already on another open code was moved';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'PT409' THEN
      v_fail := v_fail || format('F-PT409 re-pointing must raise PT409, got %s %s', SQLSTATE, SQLERRM);
    END IF;
  END;
  -- A session of another event is a conflict too, never a serialization failure.
  v_session := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, status,
    idempotency_key, expires_at
  ) VALUES (
    v_session, v_event, v_brand, 'Guest', 'guest.f4271@example.test', '+447700900123', 1500, 'GBP',
    'requires_payment', 'f4271-'||v_session, now() + interval '40 minutes'
  );
  BEGIN
    PERFORM public.issue_4271_door_pay_code_link_session(v_code2, v_session);
    v_fail := v_fail || text 'F-PT409 a session of another event was linked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'PT409' THEN
      v_fail := v_fail || format('F-PT409 another event must raise PT409, got %s %s', SQLSTATE, SQLERRM);
    END IF;
  END;
  IF (SELECT door_pay_code_id FROM public.ticket_checkout_sessions WHERE id = v_session2) IS DISTINCT FROM v_code THEN
    v_fail := v_fail || text 'F-PT409 the session left its first code';
  END IF;

  IF array_length(v_fail, 1) > 0 THEN
    RAISE EXCEPTION E'#4271 final tester adversarial: % failure(s)\n  - %',
      array_length(v_fail, 1), array_to_string(v_fail, E'\n  - ');
  END IF;
  RAISE NOTICE '#4271 final tester adversarial: all checks passed';
END;
$final$;

-- ===========================================================================
-- Retest 2 (after 63ac7e962b): a late refund that falls back to the stored
-- webhook amount. Different angles from the implementor's O8-WEBHOOK cases:
--   W-CUR     a stored event for the same payment in another currency is never
--             used (Stripe and Paystack): the refund keeps the session's total.
--   W-OTHER   another payment's events (another PaymentIntent id, a Checkout
--             completion pointing at another PaymentIntent, another Paystack
--             reference) are never used, however large.
--   W-ZERO    a zero or negative stored amount is ignored.
--   W-LOWREC  a recorded provider total wins over a stored event, also when the
--             event says LESS than the recorded total.
--   W-CAP     the refund is the provider's own amount, never more: a charge
--             smaller than Mingla's fee refunds the charge, reverses at most the
--             charge, and leaves the organiser no negative liability.
--   W-NEWEST  two stored events for the same payment: the newest one is used.
--   W-BAD     (retest 2 P4-2, implementor) a malformed or oversized stored
--             amount (a fraction, text, above 2^31) is ignored: the refund row
--             is still minted, from the next stored lookup or the session's own
--             total. Paystack too (W-PS-BAD).
--   W3-*      (retest 3, tester) both Stripe lookups malformed ('' then
--             '1e3'): the session's own total, no abort; a negative stored
--             amount is malformed, so the next lookup is used (W3-NEG-NEXT);
--             Paystack '' and an 11-digit amount are ignored, no abort.
--
-- FAILS-ON-REVERT (verified by retest 2 at 63ac7e962b): drop the currency
-- filters in issue_4271_ticket_late_refund_amounts -> W-CUR fails; match by
-- event type only (drop the reference filter) -> W-OTHER fails; drop the
-- `<= 0` guard -> W-ZERO fails; drop the provider_reconciled skip -> W-LOWREC
-- fails; use `buyer_total_cents` before the stored amount (63ac7e962b^ body)
-- -> W-CAP and W-NEWEST fail. Restore the bare `::integer` casts (the body
-- before the P4-2 guard) -> W-BAD and W-PS-BAD abort the mint with 22P02 / 22003.
-- Retest 3: the same revert -> W3-BOTH-BAD, W3-PS-EMPTY and W3-PS-DIGITS11
-- abort the mint, and W3-NEG-NEXT refunds 3135 instead of 3200.
-- ===========================================================================
DO $retest2$
DECLARE
  v_fail text[] := ARRAY[]::text[];
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_brand_ps uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_event_ps uuid := gen_random_uuid();
  v_tier uuid := gen_random_uuid();
  v_tier_ps uuid := gen_random_uuid();
  v_session uuid;
  v_key text;
  v_pi text;
  v_ref text;
  v_claim jsonb;
  v_case jsonb;
  v_row public.source_refunds%ROWTYPE;
  v_src text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'owner.r2@example.test');
  INSERT INTO public.creator_accounts (id, email, display_name) VALUES (v_owner, 'owner.r2@example.test', 'Owner');
  INSERT INTO public.brands (id, account_id, name, slug, default_currency, pricing_currency, payment_provider, payout_hold_cutover_at) VALUES
    (v_brand, v_owner, 'R2 door', 'r2-door-'||v_brand, 'GBP', 'GBP', 'stripe', now() - interval '1 day'),
    (v_brand_ps, v_owner, 'R2 ps', 'r2-ps-'||v_brand_ps, 'NGN', 'NGN', 'paystack', now() - interval '1 day');
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone, currency) VALUES
    (v_event, v_brand, 'R2 night', 'r2-night-'||v_event, 'event', 'scheduled', 'public', 'UTC', 'GBP'),
    (v_event_ps, v_brand_ps, 'R2 lagos', 'r2-lagos-'||v_event_ps, 'event', 'scheduled', 'public', 'UTC', 'NGN');
  INSERT INTO public.ticket_types (id, event_id, name, price_cents, currency, is_free, quantity_total, min_purchase_qty, available_online, available_in_person, display_order) VALUES
    (v_tier, v_event, 'General', 1500, 'GBP', false, 50, 1, true, false, 0),
    (v_tier_ps, v_event_ps, 'General', 1500000, 'NGN', false, 50, 1, true, false, 0);

  -- Stripe cases. Each: a session with a computed (not provider-reconciled)
  -- total of 3135 on a 3000 base, Mingla fee 135; stored events as listed;
  -- the expected refund and fee reversal.
  FOR v_case IN SELECT * FROM jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('tag','W-CUR', 'expect',3135, 'fee',135, 'events', jsonb_build_array(
      jsonb_build_object('type','payment_intent.succeeded','pi','SELF','amount',9999,'currency','usd','age',0),
      jsonb_build_object('type','checkout.session.completed','pi','SELF','amount',8888,'currency','eur','age',0))),
    jsonb_build_object('tag','W-OTHER', 'expect',3135, 'fee',135, 'events', jsonb_build_array(
      jsonb_build_object('type','payment_intent.succeeded','pi','OTHER','amount',9999,'currency','gbp','age',0),
      jsonb_build_object('type','checkout.session.completed','pi','OTHER','amount',8888,'currency','gbp','age',0),
      jsonb_build_object('type','charge.succeeded','pi','SELF','amount',7777,'currency','gbp','age',0))),
    jsonb_build_object('tag','W-ZERO', 'expect',3135, 'fee',135, 'events', jsonb_build_array(
      jsonb_build_object('type','payment_intent.succeeded','pi','SELF','amount',0,'currency','gbp','age',0),
      jsonb_build_object('type','checkout.session.completed','pi','SELF','amount',-5,'currency','gbp','age',0))),
    jsonb_build_object('tag','W-LOWREC', 'reconcile',3135, 'expect',3135, 'fee',135, 'events', jsonb_build_array(
      jsonb_build_object('type','payment_intent.succeeded','pi','SELF','amount',1000,'currency','gbp','age',0))),
    jsonb_build_object('tag','W-CAP', 'expect',100, 'fee',100, 'events', jsonb_build_array(
      jsonb_build_object('type','payment_intent.succeeded','pi','SELF','amount',100,'currency','GBP','age',0))),
    jsonb_build_object('tag','W-NEWEST', 'expect',3385, 'fee',135, 'events', jsonb_build_array(
      jsonb_build_object('type','payment_intent.succeeded','pi','SELF','amount',3200,'currency','gbp','age',60),
      jsonb_build_object('type','payment_intent.succeeded','pi','SELF','amount',3385,'currency','gbp','age',0))),
    jsonb_build_object('tag','W-BAD-FRACTION', 'expect',3135, 'fee',135, 'events', jsonb_build_array(
      jsonb_build_object('type','payment_intent.succeeded','pi','SELF','amount',3135.5,'currency','gbp','age',0))),
    jsonb_build_object('tag','W-BAD-TEXT', 'expect',3135, 'fee',135, 'events', jsonb_build_array(
      jsonb_build_object('type','payment_intent.succeeded','pi','SELF','amount','abc','currency','gbp','age',0))),
    jsonb_build_object('tag','W-BAD-OVERSIZED', 'expect',3135, 'fee',135, 'events', jsonb_build_array(
      jsonb_build_object('type','payment_intent.succeeded','pi','SELF','amount',3000000000,'currency','gbp','age',0))),
    jsonb_build_object('tag','W-BAD-NEXT', 'expect',3200, 'fee',135, 'events', jsonb_build_array(
      jsonb_build_object('type','payment_intent.succeeded','pi','SELF','amount','3135.5','currency','gbp','age',0),
      jsonb_build_object('type','checkout.session.completed','pi','SELF','amount',3200,'currency','gbp','age',0))),
    jsonb_build_object('tag','W3-BOTH-BAD', 'expect',3135, 'fee',135, 'events', jsonb_build_array(
      jsonb_build_object('type','payment_intent.succeeded','pi','SELF','amount','','currency','gbp','age',0),
      jsonb_build_object('type','checkout.session.completed','pi','SELF','amount','1e3','currency','gbp','age',0))),
    jsonb_build_object('tag','W3-NEG-NEXT', 'expect',3200, 'fee',135, 'events', jsonb_build_array(
      jsonb_build_object('type','payment_intent.succeeded','pi','SELF','amount','-3135','currency','gbp','age',0),
      jsonb_build_object('type','checkout.session.completed','pi','SELF','amount',3200,'currency','gbp','age',0)))
  )) LOOP
    v_session := gen_random_uuid();
    v_key := replace(v_session::text, '-', '');
    v_pi := 'pi_r2'||v_key;
    INSERT INTO public.ticket_checkout_sessions (
      id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, status,
      idempotency_key, expires_at, stripe_account_id, stripe_checkout_session_id, stripe_payment_intent_id,
      stripe_application_fee_amount_cents, list_subtotal_cents, discount_cents, net_subtotal_cents,
      buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source
    ) VALUES (
      v_session, v_event, v_brand, 'Guest', 'guest.r2@example.test', '+447700900123', 3000, 'GBP',
      'awaiting_web_redirect', 'r2-'||v_session, now() + interval '40 minutes', 'acct_r2',
      'cs_r2'||v_key, v_pi, 135, 3000, 0, 3000, 135, 0, 3135, 'computed_at_checkout'
    );
    INSERT INTO public.ticket_checkout_session_items (checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity, unit_price_cents, total_cents)
    VALUES (v_session, v_tier, 'General', 2, 1500, 3000);
    INSERT INTO public.payment_webhook_events(stripe_event_id, type, payload, provider, provider_event_type, created_at)
    SELECT 'evt_r2'||v_key||'_'||ord, e->>'type',
      CASE WHEN e->>'type' = 'checkout.session.completed'
        THEN jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
          'id', 'cs_r2x'||ord||v_key,
          'payment_intent', CASE WHEN e->>'pi' = 'SELF' THEN v_pi ELSE 'pi_other'||ord||v_key END,
          'amount_total', e->'amount', 'currency', e->>'currency')))
        ELSE jsonb_build_object('data', jsonb_build_object('object', jsonb_build_object(
          'id', CASE WHEN e->>'pi' = 'SELF' THEN v_pi ELSE 'pi_other'||ord||v_key END,
          'amount_received', e->'amount', 'amount', e->'amount',
          'payment_intent', v_pi, 'currency', e->>'currency')))
      END,
      'stripe', e->>'type', now() - make_interval(secs => (e->>'age')::integer)
    FROM jsonb_array_elements(v_case->'events') WITH ORDINALITY AS x(e, ord);
    v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event, 'stripe', 'stripe_checkout', 'r2-fp-'||v_session);
    PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, NULL, 'cs_r2'||v_key, NULL, 'r2-cont-'||v_session);
    IF v_case ? 'reconcile' THEN
      PERFORM public.issue_3872_record_ticket_provider_total(v_session, 'stripe', (v_case->>'reconcile')::bigint, 0);
      SELECT pricing_source INTO v_src FROM public.ticket_checkout_sessions WHERE id = v_session;
      IF v_src IS DISTINCT FROM 'provider_reconciled' THEN
        v_fail := v_fail || format('%s precondition: pricing_source %s', v_case->>'tag', v_src);
      END IF;
    END IF;
    BEGIN
      PERFORM public.issue_1930_mint_ticket_late_reversal(v_session, 'stripe', v_pi, NULL, 'ch_r2'||v_key);
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || format('%s the mint aborted: %s %s', v_case->>'tag', SQLSTATE, SQLERRM);
    END;
    SELECT * INTO v_row FROM public.source_refunds WHERE source_id = v_session AND refund_kind = 'late_payment_no_value';
    IF NOT FOUND THEN
      v_fail := v_fail || format('%s no late refund minted', v_case->>'tag');
    ELSIF v_row.buyer_refund_requested_cents <> (v_case->>'expect')::integer
       OR v_row.original_charge_cents <> (v_case->>'expect')::integer
       OR v_row.fee_reversal_required_cents <> (v_case->>'fee')::integer
       OR v_row.organizer_refund_liability_cents <> (v_case->>'expect')::integer - (v_case->>'fee')::integer
       OR v_row.organizer_refund_liability_cents < 0
       OR v_row.fee_reversal_required_cents > v_row.original_charge_cents
       OR v_row.buyer_refund_requested_cents > v_row.original_charge_cents THEN
      v_fail := v_fail || format('%s expected refund %s fee %s, got charge %s refund %s fee %s organiser %s',
        v_case->>'tag', v_case->>'expect', v_case->>'fee', v_row.original_charge_cents,
        v_row.buyer_refund_requested_cents, v_row.fee_reversal_required_cents, v_row.organizer_refund_liability_cents);
    END IF;
  END LOOP;

  -- Paystack: a charge.success in another currency, and one for another
  -- reference, are never used; with no usable event the refund is total_cents.
  v_session := gen_random_uuid();
  v_key := replace(v_session::text, '-', '');
  v_ref := 'psr2'||v_key;
  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, status,
    idempotency_key, expires_at, application_fee_amount_cents
  ) VALUES (
    v_session, v_event_ps, v_brand_ps, 'Guest', 'guest.r2@example.test', '+2348012345678', 1567500, 'NGN',
    'awaiting_web_redirect', 'r2-'||v_session, now() + interval '40 minutes', 67500
  );
  INSERT INTO public.ticket_checkout_session_items (checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity, unit_price_cents, total_cents)
  VALUES (v_session, v_tier_ps, 'General', 1, 1500000, 1500000);
  INSERT INTO public.payment_webhook_events(stripe_event_id, type, payload, provider, provider_event_type) VALUES
    ('paystack:r2cur'||v_key, 'charge.success', jsonb_build_object('event','charge.success','data',
      jsonb_build_object('reference', v_ref, 'amount', 99999999, 'currency', 'USD')), 'paystack', 'charge.success'),
    ('paystack:r2oth'||v_key, 'charge.success', jsonb_build_object('event','charge.success','data',
      jsonb_build_object('reference', v_ref||'x', 'amount', 88888888, 'currency', 'NGN')), 'paystack', 'charge.success'),
    ('paystack:r2fail'||v_key, 'charge.failed', jsonb_build_object('event','charge.failed','data',
      jsonb_build_object('reference', v_ref, 'amount', 77777777, 'currency', 'NGN')), 'paystack', 'charge.failed');
  v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event_ps, 'paystack', 'paystack_redirect', 'r2-fp-'||v_session);
  PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, NULL, NULL, v_ref, 'r2-cont-'||v_session);
  PERFORM public.issue_1930_mint_ticket_late_reversal(v_session, 'paystack', v_ref, '900323457', NULL);
  SELECT * INTO v_row FROM public.source_refunds WHERE source_id = v_session AND refund_kind = 'late_payment_no_value';
  IF NOT FOUND OR v_row.buyer_refund_requested_cents <> 1567500 OR v_row.original_charge_cents <> 1567500
     OR v_row.fee_reversal_required_cents <> 67500 THEN
    v_fail := v_fail || format('W-PS a foreign-currency or foreign-reference charge.success was used: %s', to_jsonb(v_row));
  END IF;

  -- W-PS-BAD: Paystack's stored amount is malformed (text, then above 2^31):
  -- ignored, the refund row still lands for the session's total.
  FOR v_case IN SELECT * FROM jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('tag','W-PS-BAD-TEXT','amount','abc'),
    jsonb_build_object('tag','W-PS-BAD-OVERSIZED','amount',2147483648),
    jsonb_build_object('tag','W3-PS-EMPTY','amount',''),
    jsonb_build_object('tag','W3-PS-DIGITS11','amount','99999999999')
  )) LOOP
    v_session := gen_random_uuid();
    v_key := replace(v_session::text, '-', '');
    v_ref := 'psr2b'||v_key;
    INSERT INTO public.ticket_checkout_sessions (
      id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, status,
      idempotency_key, expires_at, application_fee_amount_cents
    ) VALUES (
      v_session, v_event_ps, v_brand_ps, 'Guest', 'guest.r2@example.test', '+2348012345678', 1567500, 'NGN',
      'awaiting_web_redirect', 'r2b-'||v_session, now() + interval '40 minutes', 67500
    );
    INSERT INTO public.ticket_checkout_session_items (checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity, unit_price_cents, total_cents)
    VALUES (v_session, v_tier_ps, 'General', 1, 1500000, 1500000);
    INSERT INTO public.payment_webhook_events(stripe_event_id, type, payload, provider, provider_event_type) VALUES
      ('paystack:r2bad'||v_key, 'charge.success', jsonb_build_object('event','charge.success','data',
        jsonb_build_object('reference', v_ref, 'amount', v_case->'amount', 'currency', 'NGN')), 'paystack', 'charge.success');
    v_claim := public.issue_1930_claim_ticket_provider_attempt(v_session, v_event_ps, 'paystack', 'paystack_redirect', 'r2b-fp-'||v_session);
    PERFORM public.issue_1930_commit_ticket_provider_attempt((v_claim->>'attemptId')::uuid, (v_claim->>'epoch')::bigint, NULL, NULL, v_ref, 'r2b-cont-'||v_session);
    BEGIN
      PERFORM public.issue_1930_mint_ticket_late_reversal(v_session, 'paystack', v_ref, '900323458', NULL);
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || format('%s the mint aborted: %s %s', v_case->>'tag', SQLSTATE, SQLERRM);
    END;
    SELECT * INTO v_row FROM public.source_refunds WHERE source_id = v_session AND refund_kind = 'late_payment_no_value';
    IF NOT FOUND THEN
      v_fail := v_fail || format('%s no late refund row', v_case->>'tag');
    ELSIF v_row.buyer_refund_requested_cents <> 1567500 OR v_row.original_charge_cents <> 1567500
       OR v_row.fee_reversal_required_cents <> 67500 THEN
      v_fail := v_fail || format('%s expected 1567500 fee 67500, got %s', v_case->>'tag', to_jsonb(v_row));
    END IF;
  END LOOP;

  IF array_length(v_fail, 1) > 0 THEN
    RAISE EXCEPTION E'#4271 retest 2 tester adversarial: % failure(s)\n  - %',
      array_length(v_fail, 1), array_to_string(v_fail, E'\n  - ');
  END IF;
  RAISE NOTICE '#4271 retest 2 tester adversarial: all checks passed';
END;
$retest2$;

ROLLBACK;
