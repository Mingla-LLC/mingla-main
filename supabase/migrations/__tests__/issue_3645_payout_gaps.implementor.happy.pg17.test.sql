-- Issue #3645 — payout gaps (PG17, after the full replay).
--
-- Proves, against 20280809003645_issue_3645_payout_gaps.sql:
--   T1 issue_2036_installment_payout_ready() is on, SECURITY DEFINER, and only
--      service_role may call it.
--   T2 A collected Paystack instalment on a stamped brand attaches to a release
--      with Mingla's fee and the Paystack fee from its row, net of its partial
--      refund and its open dispute.
--   T3 A collected Stripe instalment is a fee candidate (charge ref, connected
--      account), waits while it has no fee snapshot, then attaches with the
--      snapshot's provider fee, net of its refund and its open Stripe dispute.
--   T4 A fully refunded instalment never attaches.
--   T5 The fee-candidate limit applies per source family.
--   T6 A paid Paystack stay is listed by its transaction reference; recording
--      its fee lets run_stay_payout_release_dark_sweep attach it.
--   T7 A replayed finalize back-fills a paid Stripe chip-in's missing charge
--      reference once, never overwrites one, and leaves Paystack rows alone.
--   T8 A Paystack instalment paid with no fee in Paystack's answer stays
--      pending (never fee 0), is a fee candidate by its reference, and pays
--      out with the verified fee once issue_3645_record_installment_paystack_fee
--      records it; one paid with a fee is ready at once.
--   T9 Inside a family a source whose fee read failed goes behind the others.
--   T10 A Paystack stay without its transaction reference is not listed.
--
-- Fails on revert: with the gate false T2/T3 attach nothing; without the
-- snapshot wait T3 attaches with provider fee 0; without the stay hunk T6 lists
-- the numeric charge id; without the finalize hunk T7 keeps a NULL charge.

BEGIN;

ALTER TABLE public.stay_reservation_groups DISABLE TRIGGER stay_reservation_groups_scope_guard;
ALTER TABLE public.stay_reservation_lines DISABLE TRIGGER stay_reservation_lines_scope_guard;
ALTER TABLE public.stay_reservation_groups DROP CONSTRAINT stay_reservation_groups_quote_id_fkey;
ALTER TABLE public.stay_reservation_lines DROP CONSTRAINT stay_reservation_lines_quote_line_id_fkey;
ALTER TABLE public.stay_reservation_lines DROP CONSTRAINT stay_reservation_lines_offering_id_fkey;

SELECT set_config('request.jwt.claim.role', 'service_role', true),
       set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $test$
DECLARE
  v_owner uuid := '3645a000-0000-4000-8000-000000000001';
  v_ng uuid := '3645a000-0000-4000-8000-000000000002';
  v_us uuid := '3645a000-0000-4000-8000-000000000003';
  v_eng uuid := '3645a000-0000-4000-8000-000000000004';
  v_eus uuid := '3645a000-0000-4000-8000-000000000005';
  v_p uuid := '3645a000-0000-4000-8000-000000000006';
  v_s uuid := '3645a000-0000-4000-8000-000000000007';
  v_p1 uuid := '3645a000-0000-4000-8000-000000000008';
  v_p2 uuid := '3645a000-0000-4000-8000-000000000009';
  v_s1 uuid := '3645a000-0000-4000-8000-000000000010';
  v_plain uuid := '3645a000-0000-4000-8000-000000000011';
  v_venue uuid := '3645a000-0000-4000-8000-000000000012';
  v_group uuid := '3645a000-0000-4000-8000-000000000013';
  v_line uuid := '3645a000-0000-4000-8000-000000000014';
  v_attempt uuid := '3645a000-0000-4000-8000-000000000015';
  v_c_cs uuid := '3645a000-0000-4000-8000-000000000016';
  v_c_ps uuid := '3645a000-0000-4000-8000-000000000017';
  v_p3 uuid := '3645a000-0000-4000-8000-000000000018';
  v_p4 uuid := '3645a000-0000-4000-8000-000000000019';
  v_old uuid := '3645a000-0000-4000-8000-000000000020';
  v_group2 uuid := '3645a000-0000-4000-8000-000000000021';
  v_attempt2 uuid := '3645a000-0000-4000-8000-000000000022';
  v_ref text;
  v_now timestamptz := timestamptz '2026-12-10 12:00:00+00';
  v_collected timestamptz := timestamptz '2026-12-08 12:00:00+00';
  v_rows record;
  v_count integer;
  r jsonb;
BEGIN
  -- T1 ----------------------------------------------------------------------
  IF public.issue_2036_installment_payout_ready() IS NOT TRUE THEN
    RAISE EXCEPTION 'T1 the instalment payout switch is not on';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p
           WHERE p.oid = 'public.issue_2036_installment_payout_ready()'::regprocedure) THEN
    RAISE EXCEPTION 'T1 the switch lost SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.issue_2036_installment_payout_ready()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_2036_installment_payout_ready()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.issue_2036_installment_payout_ready()', 'EXECUTE') THEN
    RAISE EXCEPTION 'T1 switch grants changed';
  END IF;

  -- Fixtures: a stamped Paystack brand and a stamped Stripe brand.
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-3645-gaps@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region, pricing_currency,
    default_currency, payout_hold_cutover_at, stripe_connect_id)
  VALUES (v_ng, v_owner, 'Gaps ng', 'issue-3645-gaps-ng', 'paystack', 'NG', 'NGN', 'NGN', timestamptz '2020-01-01', NULL),
         (v_us, v_owner, 'Gaps us', 'issue-3645-gaps-us', 'stripe', 'US', 'USD', 'USD', timestamptz '2020-01-01', 'acct_3645gaps');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, currency) VALUES
    (v_eng, v_ng, 'Gaps trip ng', 'issue-3645-gaps-ng-trip', 'trip', 'live', 'NGN'),
    (v_eus, v_us, 'Gaps trip us', 'issue-3645-gaps-us-trip', 'trip', 'live', 'USD');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_eng, v_now + interval '40 days', v_now + interval '45 days', 'UTC', true),
    (v_eus, v_now + interval '40 days', v_now + interval '45 days', 'UTC', true);
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status, stripe_payment_intent_id,
    stripe_charge_id, source, installment_plan_root)
  VALUES (v_p, v_eng, 250000, 'NGN', 'paid', 'mingla_3645_gaps', '3645901', 'legacy', true),
         (v_s, v_eus, 2500, 'USD', 'paid', 'pi_3645_gaps', 'ch_3645_gaps', 'legacy', true);
  -- The deposits already have their fee snapshots; only the instalments are new.
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents)
  VALUES ('order', v_p, 100), ('order', v_s, 100);
  INSERT INTO public.order_installments(id, order_id, ordinal, amount_cents, currency, due_at, status,
    stripe_payment_intent_id, stripe_charge_id, collected_at, provider, collection_method, buyer_total_cents,
    plan_bound_at, application_fee_amount_cents, provider_fee_cents, payout_accounting_state, refunded_amount_cents)
  VALUES
    (v_p1, v_p, 1, 500000, 'NGN', v_collected, 'collected', 'mingla-inst-' || v_p1 || '-a1', NULL, v_collected,
      'paystack', 'auto_card', 541250, now(), 22500, 8000, 'ready', 41250),
    (v_p2, v_p, 2, 250000, 'NGN', v_collected, 'collected', 'mingla-inst-' || v_p2 || '-l1', NULL, v_collected,
      'paystack', 'pay_link', 270625, now(), 11250, 4000, 'ready', 270625),
    (v_s1, v_s, 1, 7500, 'USD', v_collected, 'collected', 'pi_3645_gaps_i1', 'ch_3645_gaps_i1', v_collected,
      'stripe', 'auto_card', NULL, now(), 338, 0, 'ready', 500);
  UPDATE public.order_installments SET status = 'refunded' WHERE id = v_p2;
  -- Open disputes on both rails.
  r := public.record_paystack_dispute_outcome('dsp_3645_gaps', 'mingla-inst-' || v_p1 || '-a1',
    'charge.dispute.create', 'awaiting-merchant-feedback', NULL, 100000, 'NGN', 'fraud', NULL, '{}'::jsonb, v_now);
  IF (r->>'matched')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'fixture paystack dispute %', r; END IF;
  INSERT INTO public.stripe_disputes(stripe_dispute_id, stripe_account_id, stripe_charge_id, amount, currency, status, reason, raw_event)
  VALUES ('dp_3645_gaps', 'acct_3645gaps', 'ch_3645_gaps_i1', 1000, 'usd', 'needs_response', 'fraudulent', '{}'::jsonb);

  -- T3 (before the sweep): the Stripe instalment is a fee candidate.
  SELECT * INTO v_rows FROM public.list_missing_payout_source_fees(100) l
   WHERE l.source_type = 'order_installment' AND l.source_id = v_s1;
  IF NOT FOUND OR v_rows.provider <> 'stripe' OR v_rows.provider_reference <> 'ch_3645_gaps_i1'
     OR v_rows.stripe_account_id <> 'acct_3645gaps' THEN
    RAISE EXCEPTION 'T3 Stripe instalment fee candidate %', to_jsonb(v_rows);
  END IF;
  IF EXISTS (SELECT 1 FROM public.list_missing_payout_source_fees(100) l
              WHERE l.source_type = 'order_installment' AND l.source_id IN (v_p1, v_p2)) THEN
    RAISE EXCEPTION 'T3 a Paystack instalment must not be a fee candidate (its fee is on the row)';
  END IF;

  PERFORM public.run_payout_release_dark_sweep(v_now);

  -- T2 ----------------------------------------------------------------------
  SELECT i.gross_cents, i.refunded_cents, i.disputed_cents, i.mingla_fee_cents, i.provider_fee_cents,
         i.net_cents, rel.provider
    INTO v_rows
    FROM public.payout_release_items i JOIN public.brand_payout_releases rel ON rel.id = i.release_id
   WHERE i.source_type = 'order_installment' AND i.source_id = v_p1;
  IF NOT FOUND THEN RAISE EXCEPTION 'T2 the collected Paystack instalment did not attach'; END IF;
  IF v_rows.provider <> 'paystack' OR v_rows.gross_cents <> 541250 OR v_rows.refunded_cents <> 41250
     OR v_rows.disputed_cents <> 100000 OR v_rows.mingla_fee_cents <> 22500 OR v_rows.provider_fee_cents <> 8000
     OR v_rows.net_cents <> 541250 - 41250 - 100000 - 22500 THEN
    RAISE EXCEPTION 'T2 Paystack instalment item %', to_jsonb(v_rows);
  END IF;
  IF (SELECT payout_accounting_state FROM public.order_installments WHERE id = v_p1) <> 'attached' THEN
    RAISE EXCEPTION 'T2 the Paystack instalment is not marked attached';
  END IF;

  -- T4 ----------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM public.payout_release_items WHERE source_type = 'order_installment' AND source_id = v_p2) THEN
    RAISE EXCEPTION 'T4 a fully refunded instalment attached';
  END IF;

  -- T3: no fee snapshot yet, so the Stripe instalment waits.
  IF EXISTS (SELECT 1 FROM public.payout_release_items WHERE source_type = 'order_installment' AND source_id = v_s1) THEN
    RAISE EXCEPTION 'T3 the Stripe instalment attached before its fee was known';
  END IF;
  -- The sweep captures Stripe's fee from the charge (what payout-release-sweep upserts).
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents,
    provider_balance_transaction_id, application_fee_excluded_cents)
  VALUES ('order_installment', v_s1, 248, 'txn_3645_gaps_i1', 338);
  IF EXISTS (SELECT 1 FROM public.list_missing_payout_source_fees(100) l
              WHERE l.source_type = 'order_installment' AND l.source_id = v_s1) THEN
    RAISE EXCEPTION 'T3 a snapshotted instalment is still a fee candidate';
  END IF;
  PERFORM public.run_payout_release_dark_sweep(v_now);
  SELECT i.gross_cents, i.refunded_cents, i.disputed_cents, i.mingla_fee_cents, i.provider_fee_cents,
         i.net_cents, rel.provider
    INTO v_rows
    FROM public.payout_release_items i JOIN public.brand_payout_releases rel ON rel.id = i.release_id
   WHERE i.source_type = 'order_installment' AND i.source_id = v_s1;
  IF NOT FOUND THEN RAISE EXCEPTION 'T3 the collected Stripe instalment did not attach after its snapshot'; END IF;
  IF v_rows.provider <> 'stripe' OR v_rows.gross_cents <> 7500 OR v_rows.refunded_cents <> 500
     OR v_rows.disputed_cents <> 1000 OR v_rows.mingla_fee_cents <> 338 OR v_rows.provider_fee_cents <> 248
     OR v_rows.net_cents <> 7500 - 500 - 1000 - 338 THEN
    RAISE EXCEPTION 'T3 Stripe instalment item %', to_jsonb(v_rows);
  END IF;
  -- The forecast counts the same set of sales the sweep attaches: nothing left.
  IF EXISTS (SELECT 1 FROM public.issue_3645_unattached_payout_sources(v_now) u
              WHERE u.source_type = 'order_installment') THEN
    RAISE EXCEPTION 'T3 the forecast still counts an attached instalment';
  END IF;

  -- T5 ----------------------------------------------------------------------
  -- A Stripe order with no snapshot and a second Stripe instalment with none:
  -- with a limit of 1 each family still gets its row.
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status, stripe_payment_intent_id,
    stripe_charge_id, source)
  VALUES (v_plain, v_eus, 4000, 'USD', 'paid', 'pi_3645_gaps_plain', 'ch_3645_gaps_plain', 'legacy');
  INSERT INTO public.order_installments(order_id, ordinal, amount_cents, currency, due_at, status,
    stripe_payment_intent_id, stripe_charge_id, collected_at, provider, collection_method,
    plan_bound_at, application_fee_amount_cents, provider_fee_cents, payout_accounting_state)
  VALUES (v_s, 2, 7500, 'USD', v_collected, 'collected', 'pi_3645_gaps_i2', 'ch_3645_gaps_i2', v_collected,
    'stripe', 'auto_card', now(), 338, 0, 'ready');
  SELECT count(*) FILTER (WHERE l.source_type = 'order') AS n_order,
         count(*) FILTER (WHERE l.source_type = 'order_installment') AS n_inst,
         max(c.n) AS max_per_family
    INTO v_rows
    FROM public.list_missing_payout_source_fees(1) l
    CROSS JOIN LATERAL (SELECT count(*) AS n FROM public.list_missing_payout_source_fees(1) x
                         WHERE x.source_type = l.source_type) c;
  IF v_rows.n_order <> 1 OR v_rows.n_inst <> 1 OR v_rows.max_per_family <> 1 THEN
    RAISE EXCEPTION 'T5 per-family limit %', to_jsonb(v_rows);
  END IF;

  -- T6 ----------------------------------------------------------------------
  INSERT INTO public.venue_listings(id, brand_id, slug, name, lat, lng, venue_category, claim_status)
  VALUES (v_venue, v_ng, 'issue3645gapsstay', 'Issue 3645 Gaps Stay', 6.5, 3.4, 'stay', 'verified');
  INSERT INTO public.stay_settings(venue_id, brand_id, property_kind, timezone, default_booking_mode, booking_state)
  VALUES (v_venue, v_ng, 'hotel', 'UTC', 'instant', 'active');
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.stay_reservation_groups(
    id, public_reference, quote_id, actor_key_hash, venue_id, brand_id,
    currency_code, mode, state, guest_snapshot, source_subtotal_minor,
    fee_total_minor, tax_total_minor, total_minor, idempotency_key, request_hash
  ) VALUES (
    v_group, 'ST-3645A000000000000001', gen_random_uuid(), repeat('a', 64), v_venue, v_ng, 'NGN',
    'instant', 'confirmed', '{}'::jsonb, 10000, 450, 0, 10450, 'issue-3645-gaps-group', repeat('b', 64)
  );
  INSERT INTO public.stay_reservation_lines(
    id, group_id, quote_line_id, offering_id, kind, state, room_check_in,
    room_check_out, room_quantity, adults, children, base_minor, fee_minor,
    tax_minor, total_minor, offering_snapshot, price_snapshot, policy_snapshot
  ) VALUES (
    v_line, v_group, gen_random_uuid(), gen_random_uuid(), 'room', 'confirmed',
    (v_now + interval '8 days')::date, (v_now + interval '10 days')::date,
    1, 2, 0, 10000, 450, 0, 10450, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  );
  INSERT INTO public.stay_payment_attempts(
    id, group_id, provider, attempt_ordinal, amount_minor, currency_code,
    application_fee_minor, provider_fee_minor, state, provider_payment_ref,
    provider_charge_ref, idempotency_key, request_hash, succeeded_at
  ) VALUES (
    v_attempt, v_group, 'paystack', 1, 10450, 'NGN', 450, NULL, 'succeeded',
    'mingla_stay_3645_gaps', '4099260516', 'issue-3645-gaps-attempt', repeat('c', 64),
    v_now - interval '3 days'
  );
  SET LOCAL session_replication_role = origin;
  SELECT * INTO v_rows FROM public.list_missing_stay_provider_fees(100) l WHERE l.source_id = v_attempt;
  IF NOT FOUND OR v_rows.provider <> 'paystack' OR v_rows.provider_reference <> 'mingla_stay_3645_gaps'
     OR v_rows.stripe_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'T6 Paystack stay fee candidate %', to_jsonb(v_rows);
  END IF;
  PERFORM public.record_stay_provider_fee(v_attempt, 300, '4099260516');
  IF EXISTS (SELECT 1 FROM public.list_missing_stay_provider_fees(100) l WHERE l.source_id = v_attempt) THEN
    RAISE EXCEPTION 'T6 a stay with its fee recorded is still a candidate';
  END IF;
  PERFORM public.run_stay_payout_release_dark_sweep(v_now);
  SELECT count(*) INTO v_count FROM public.payout_release_items
   WHERE source_type = 'stay_reservation' AND source_id = v_line;
  IF v_count <> 1 THEN RAISE EXCEPTION 'T6 the paid stay did not attach (got %)', v_count; END IF;

  -- T7 ----------------------------------------------------------------------
  INSERT INTO public.event_rsvp_contributions(
    id, event_id, brand_id, guest_name, guest_email, provider, currency,
    amount_cents, buyer_total_cents, application_fee_amount_cents,
    pricing_breakdown, status, stripe_payment_intent_id, stripe_charge_id, paid_at
  ) VALUES
    (v_c_cs, v_eus, v_us, 'Chip', 'chip-3645@example.test', 'stripe', 'USD',
     500, 500, 25, '{}', 'paid', 'cs_live_3645_gaps', NULL, v_now - interval '3 days'),
    (v_c_ps, v_eng, v_ng, 'Chip', 'chip-ng-3645@example.test', 'paystack', 'NGN',
     500000, 500000, 22500, '{}', 'paid', 'mingla_rsvp_3645_gaps', NULL, v_now - interval '3 days');
  SELECT provider_reference INTO v_rows FROM public.list_missing_payout_source_fees(100) l
   WHERE l.source_type = 'rsvp_contribution' AND l.source_id = v_c_cs;
  IF v_rows.provider_reference <> 'cs_live_3645_gaps' THEN
    RAISE EXCEPTION 'T7 fixture: a cs_-only chip-in lists its session id (got %)', v_rows.provider_reference;
  END IF;
  r := public.issue_1930_finalize_rsvp_contribution(v_c_cs, 'pi_3645_gaps_chip', 'ch_3645_gaps_chip', 'card');
  IF r->>'outcome' <> 'finalized' THEN RAISE EXCEPTION 'T7 replay outcome %', r; END IF;
  SELECT status, stripe_charge_id, stripe_payment_intent_id INTO v_rows
    FROM public.event_rsvp_contributions WHERE id = v_c_cs;
  IF v_rows.status <> 'paid' OR v_rows.stripe_charge_id <> 'ch_3645_gaps_chip'
     OR v_rows.stripe_payment_intent_id <> 'cs_live_3645_gaps' THEN
    RAISE EXCEPTION 'T7 back-fill %', to_jsonb(v_rows);
  END IF;
  SELECT provider_reference INTO v_rows FROM public.list_missing_payout_source_fees(100) l
   WHERE l.source_type = 'rsvp_contribution' AND l.source_id = v_c_cs;
  IF v_rows.provider_reference <> 'ch_3645_gaps_chip' THEN
    RAISE EXCEPTION 'T7 the chip-in is not listed by its charge (got %)', v_rows.provider_reference;
  END IF;
  -- A later delivery never replaces a stored charge reference.
  PERFORM public.issue_1930_finalize_rsvp_contribution(v_c_cs, 'cs_live_3645_gaps', 'pi_3645_other', NULL);
  IF (SELECT stripe_charge_id FROM public.event_rsvp_contributions WHERE id = v_c_cs) <> 'ch_3645_gaps_chip' THEN
    RAISE EXCEPTION 'T7 a stored charge reference was overwritten';
  END IF;
  -- A Paystack chip-in is untouched (its reference is the Paystack reference).
  PERFORM public.issue_1930_finalize_rsvp_contribution(v_c_ps, 'mingla_rsvp_3645_gaps', '4099260517', NULL);
  IF (SELECT stripe_charge_id FROM public.event_rsvp_contributions WHERE id = v_c_ps) IS NOT NULL THEN
    RAISE EXCEPTION 'T7 a Paystack chip-in was changed by the Stripe back-fill';
  END IF;

  -- T8 ----------------------------------------------------------------------
  INSERT INTO public.order_installments(id, order_id, ordinal, amount_cents, currency, due_at, provider,
    collection_method, buyer_total_cents, planned_application_fee_cents, plan_bound_at)
  VALUES (v_p3, v_p, 3, 250000, 'NGN', v_collected, 'paystack', 'pay_link', 270625, 11250, now()),
         (v_p4, v_p, 4, 250000, 'NGN', v_collected, 'paystack', 'pay_link', 270625, 11250, now());
  -- No fee in Paystack's answer.
  r := public.issue_3645_begin_installment_attempt(v_p3, 'pay_link', 11250);
  IF (r->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'T8 begin %', r; END IF;
  v_ref := r->>'reference';
  r := public.issue_3645_resolve_installment_attempt((r->>'attempt_id')::uuid, 'succeeded', '5550018',
    'Approved', NULL, NULL, 270625);
  IF r->>'outcome' <> 'collected' THEN RAISE EXCEPTION 'T8 resolve %', r; END IF;
  SELECT status, payout_accounting_state, application_fee_amount_cents, provider_fee_cents INTO v_rows
    FROM public.order_installments WHERE id = v_p3;
  IF v_rows.status <> 'collected' OR v_rows.payout_accounting_state <> 'pending'
     OR v_rows.application_fee_amount_cents IS NOT NULL THEN
    RAISE EXCEPTION 'T8 a fee-less Paystack instalment must stay pending %', to_jsonb(v_rows);
  END IF;
  -- A replay that still has no fee changes nothing.
  r := public.issue_3645_resolve_installment_attempt(
    (SELECT id FROM public.order_installment_charge_attempts WHERE reference = v_ref), 'succeeded', '5550018',
    'Approved', NULL, NULL, 270625);
  IF (SELECT payout_accounting_state FROM public.order_installments WHERE id = v_p3) <> 'pending' THEN
    RAISE EXCEPTION 'T8 a fee-less replay made the instalment ready';
  END IF;
  SELECT * INTO v_rows FROM public.list_missing_payout_source_fees(100) l
   WHERE l.source_type = 'order_installment' AND l.source_id = v_p3;
  IF NOT FOUND OR v_rows.provider <> 'paystack' OR v_rows.provider_reference <> v_ref THEN
    RAISE EXCEPTION 'T8 fee-less Paystack instalment candidate %', to_jsonb(v_rows);
  END IF;
  PERFORM public.run_payout_release_dark_sweep(v_now);
  IF EXISTS (SELECT 1 FROM public.payout_release_items WHERE source_type = 'order_installment' AND source_id = v_p3) THEN
    RAISE EXCEPTION 'T8 a fee-less Paystack instalment attached';
  END IF;
  r := public.issue_3645_record_installment_paystack_fee(v_p3, 4100);
  IF (r->>'ok')::boolean IS NOT TRUE OR r->>'payout_accounting_state' <> 'ready' THEN
    RAISE EXCEPTION 'T8 record fee %', r;
  END IF;
  IF EXISTS (SELECT 1 FROM public.list_missing_payout_source_fees(100) l
              WHERE l.source_type = 'order_installment' AND l.source_id = v_p3) THEN
    RAISE EXCEPTION 'T8 a Paystack instalment with its fee is still a candidate';
  END IF;
  PERFORM public.run_payout_release_dark_sweep(v_now);
  SELECT i.provider_fee_cents, i.mingla_fee_cents INTO v_rows FROM public.payout_release_items i
   WHERE i.source_type = 'order_installment' AND i.source_id = v_p3;
  IF NOT FOUND OR v_rows.provider_fee_cents <> 4100 OR v_rows.mingla_fee_cents <> 11250 THEN
    RAISE EXCEPTION 'T8 fee-less instalment after its fee %', to_jsonb(v_rows);
  END IF;
  -- With a fee in the answer the instalment is ready at once.
  r := public.issue_3645_begin_installment_attempt(v_p4, 'pay_link', 11250);
  r := public.issue_3645_resolve_installment_attempt((r->>'attempt_id')::uuid, 'succeeded', '5550019',
    'Approved', NULL, 4060, 270625);
  SELECT payout_accounting_state, provider_fee_cents INTO v_rows FROM public.order_installments WHERE id = v_p4;
  IF v_rows.payout_accounting_state <> 'ready' OR v_rows.provider_fee_cents <> 4060 THEN
    RAISE EXCEPTION 'T8 a Paystack instalment with its fee %', to_jsonb(v_rows);
  END IF;

  -- T9 ----------------------------------------------------------------------
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status, stripe_payment_intent_id,
    stripe_charge_id, source, created_at)
  VALUES (v_old, v_eus, 4000, 'USD', 'paid', 'pi_3645_gaps_old', 'ch_3645_gaps_old', 'legacy', now() - interval '2 days');
  IF (SELECT l.source_id FROM public.list_missing_payout_source_fees(1) l WHERE l.source_type = 'order') <> v_old THEN
    RAISE EXCEPTION 'T9 the oldest unfailed order must come first';
  END IF;
  PERFORM public.record_payout_fee_capture_failure('order', v_old, 'stripe_down');
  IF (SELECT l.source_id FROM public.list_missing_payout_source_fees(1) l WHERE l.source_type = 'order') <> v_plain THEN
    RAISE EXCEPTION 'T9 a failed order must go behind the others';
  END IF;
  PERFORM public.record_payout_fee_capture_failure('order', v_old, 'stripe_down_again');
  IF (SELECT failure_count FROM public.payout_fee_capture_failures
       WHERE source_type = 'order' AND source_id = v_old) <> 2 THEN
    RAISE EXCEPTION 'T9 failure count';
  END IF;

  -- T10 ---------------------------------------------------------------------
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.stay_reservation_groups(
    id, public_reference, quote_id, actor_key_hash, venue_id, brand_id,
    currency_code, mode, state, guest_snapshot, source_subtotal_minor,
    fee_total_minor, tax_total_minor, total_minor, idempotency_key, request_hash
  ) VALUES (
    v_group2, 'ST-3645A000000000000002', gen_random_uuid(), repeat('a', 64), v_venue, v_ng, 'NGN',
    'instant', 'confirmed', '{}'::jsonb, 10000, 450, 0, 10450, 'issue-3645-gaps-group-2', repeat('b', 64)
  );
  INSERT INTO public.stay_payment_attempts(
    id, group_id, provider, attempt_ordinal, amount_minor, currency_code,
    application_fee_minor, provider_fee_minor, state, provider_payment_ref,
    provider_charge_ref, idempotency_key, request_hash, succeeded_at
  ) VALUES (
    v_attempt2, v_group2, 'paystack', 1, 10450, 'NGN', 450, NULL, 'succeeded',
    NULL, '4099260599', 'issue-3645-gaps-attempt-2', repeat('c', 64), v_now - interval '3 days'
  );
  SET LOCAL session_replication_role = origin;
  IF EXISTS (SELECT 1 FROM public.list_missing_stay_provider_fees(100) l WHERE l.source_id = v_attempt2) THEN
    RAISE EXCEPTION 'T10 a Paystack stay without its reference is listed (verify cannot read it)';
  END IF;

  RAISE NOTICE 'issue_3645_payout_gaps_pass';
END
$test$;

ROLLBACK;
