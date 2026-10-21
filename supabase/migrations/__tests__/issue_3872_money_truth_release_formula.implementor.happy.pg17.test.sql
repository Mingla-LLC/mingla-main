-- Issue #3872 PR 1 (money truth) + #3645 flat 4.5% host net (PG17).
--
-- MINGLA-INVARIANT: I-3645-HOST-NET-IGNORES-PROVIDER-FEE | issue #3645 | Host
-- net = greatest(0, gross − refunded − disputed − mingla_fee). provider_fee is
-- still snapshotted for reporting but is not subtracted (#3645: Mingla pays
-- processing out of the flat 4.5%). Partner share stays off the host net (#3872).
-- "The fee Mingla kept" is the application fee minus any application fee the
-- provider returned to the host on a refund.
--
-- Cases:
--   A. F10 — a hosted Stripe order that passes fees: gross must be what the card was
--      charged (buyer_total_cents), not the ticket base kept in orders.total_cents.
--   B. F1  — a partner share (10% OF Mingla's fee, paid from Mingla's platform
--      balance) must not reduce the host's net; provider_fee also does not.
--   C. A refunded application fee returns to the host's balance, so only the fee
--      Mingla kept is deducted (provider_fee still ignored).
--   D. A reservation deposit pays Mingla an application fee; the fee must be deducted
--      (the arm used to pass 0 and over-release by the fee).
--   E. plan_pending_payout_partner_legs rebuilds a pending release's net without the
--      partner share, provider fee, partner principal corrections or partner transfer costs.

BEGIN;

-- Shared fixture helper: one Stripe brand past its payout cutover, one live event
-- whose only date ended 4 days before "now" so the order arm is mature.
CREATE FUNCTION pg_temp.issue_3872_fixture(
  p_tag text, p_owner uuid, p_brand uuid, p_event uuid, p_date uuid, p_now timestamptz
) RETURNS void LANGUAGE plpgsql AS $fx$
BEGIN
  INSERT INTO auth.users(id) VALUES (p_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (p_owner, 'owner-3872-' || p_tag || '@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, payout_hold_cutover_at
  ) VALUES (
    p_brand, p_owner, 'Issue 3872 ' || p_tag, 'issue-3872-' || p_tag,
    'stripe', 'US', 'USD', 'USD', timestamptz '2020-01-01 00:00:00+00'
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (p_event, p_brand, 'Issue 3872 ' || p_tag, 'issue-3872-ev-' || p_tag, 'live', 'USD');
  INSERT INTO public.event_dates(id, event_id, start_at, end_at, timezone, is_master)
  VALUES (p_date, p_event, p_now - interval '5 days', p_now - interval '4 days', 'UTC', true);
END $fx$;

-- A. F10 — hosted passed-fee order: gross = what the provider charged.
DO $case_a$
DECLARE
  v_owner constant uuid := '38720000-0000-4000-8000-00000000a001';
  v_brand constant uuid := '38720000-0000-4000-8000-00000000a002';
  v_event constant uuid := '38720000-0000-4000-8000-00000000a003';
  v_date  constant uuid := '38720000-0000-4000-8000-00000000a004';
  v_order constant uuid := '38720000-0000-4000-8000-00000000a005';
  v_now   constant timestamptz := timestamptz '2026-10-01 12:00:00+00';
  v_item  record;
BEGIN
  PERFORM pg_temp.issue_3872_fixture('a', v_owner, v_brand, v_event, v_date, v_now);
  -- Mirrors production order 6d25e937: base 3000, buyer charged 3135
  -- (1.5% Mingla fee + 3% service fee passed), application fee 45, Stripe fee 166.
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status, stripe_payment_intent_id,
    stripe_charge_id, source, buyer_phone_e164, event_date_id, stripe_application_fee_amount_cents,
    created_at
  ) VALUES (
    v_order, v_event, 3000, 'USD', 'paid', 'pi_3872_a', 'ch_3872_a', 'online_checkout', '+12125550100',
    v_date, 45, v_now - interval '6 days'
  );
  -- The explicit charged total exists only once #3872's migration is applied; on the
  -- old schema the column is absent, gross stays 3000 and the assertion below fails.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
              AND table_name='orders' AND column_name='buyer_total_cents') THEN
    EXECUTE 'UPDATE public.orders SET list_subtotal_cents = 3000, net_subtotal_cents = 3000,
      buyer_fees_cents = 135, tax_cents = 0, buyer_total_cents = 3135,
      pricing_source = ''provider_reconciled'' WHERE id = $1' USING v_order;
  END IF;
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents)
  VALUES ('order', v_order, 166);

  PERFORM public.run_payout_release_dark_sweep(v_now);

  SELECT * INTO v_item FROM public.payout_release_items
   WHERE source_type='order' AND source_id=v_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_a: order did not attach'; END IF;
  IF v_item.gross_cents <> 3135 THEN
    RAISE EXCEPTION 'case_a F10: gross must be the charged total 3135, got %', v_item.gross_cents;
  END IF;
  IF v_item.provider_fee_cents <> 166 THEN
    RAISE EXCEPTION 'case_a: provider fee must still be snapshotted (166), got %',
      v_item.provider_fee_cents;
  END IF;
  -- #3645: host net ignores provider_fee (3135 - 45 = 3090).
  IF v_item.net_cents <> 3135 - 45 THEN
    RAISE EXCEPTION 'case_a F10: net must be 3090 (charged - Mingla fee), got %', v_item.net_cents;
  END IF;
  RAISE NOTICE 'issue_3872 case_a pass';
END $case_a$;

-- B. F1 — a partner share never reduces the host's net.
DO $case_b$
DECLARE
  v_owner   constant uuid := '38720000-0000-4000-8000-00000000b001';
  v_brand   constant uuid := '38720000-0000-4000-8000-00000000b002';
  v_event   constant uuid := '38720000-0000-4000-8000-00000000b003';
  v_date    constant uuid := '38720000-0000-4000-8000-00000000b004';
  v_order   constant uuid := '38720000-0000-4000-8000-00000000b005';
  v_partner constant uuid := '38720000-0000-4000-8000-00000000b006';
  v_now     constant timestamptz := timestamptz '2026-10-01 12:00:00+00';
  v_item    record;
  v_release record;
BEGIN
  PERFORM pg_temp.issue_3872_fixture('b', v_owner, v_brand, v_event, v_date, v_now);
  INSERT INTO auth.users(id) VALUES (v_partner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_partner, 'partner-3872-b@example.test');
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status, stripe_payment_intent_id,
    stripe_charge_id, source, buyer_phone_e164, event_date_id, stripe_application_fee_amount_cents,
    created_at
  ) VALUES (
    v_order, v_event, 10000, 'USD', 'paid', 'pi_3872_b', 'ch_3872_b', 'online_checkout', '+12125550100',
    v_date, 150, v_now - interval '6 days'
  );
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents)
  VALUES ('order', v_order, 320);
  INSERT INTO public.partner_splits(
    order_id, brand_id, partner_account_id, mingla_fee_cents, partner_share_cents,
    transfer_currency, stripe_application_fee_id, status, provider
  ) VALUES (
    v_order, v_brand, v_partner, 150, 15, 'usd', 'fee_3872_b', 'held', 'stripe'
  );

  PERFORM public.run_payout_release_dark_sweep(v_now);

  SELECT * INTO v_item FROM public.payout_release_items
   WHERE source_type='order' AND source_id=v_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_b: order did not attach'; END IF;
  IF v_item.partner_share_cents <> 15 THEN
    RAISE EXCEPTION 'case_b: partner share must stay stored for reporting, got %', v_item.partner_share_cents;
  END IF;
  -- #3645: ignore partner share and provider_fee (10000 - 150 = 9850).
  IF v_item.net_cents <> 10000 - 150 THEN
    RAISE EXCEPTION 'case_b F1: net must ignore partner + provider fee (9850), got %', v_item.net_cents;
  END IF;
  SELECT * INTO v_release FROM public.brand_payout_releases WHERE id = v_item.release_id;
  IF v_release.net_release_cents <> 9850 THEN
    RAISE EXCEPTION 'case_b F1: release net must be 9850, got %', v_release.net_release_cents;
  END IF;
  RAISE NOTICE 'issue_3872 case_b pass';
END $case_b$;

-- C. A refunded application fee is the host's money again.
DO $case_c$
DECLARE
  v_owner constant uuid := '38720000-0000-4000-8000-00000000c001';
  v_brand constant uuid := '38720000-0000-4000-8000-00000000c002';
  v_event constant uuid := '38720000-0000-4000-8000-00000000c003';
  v_date  constant uuid := '38720000-0000-4000-8000-00000000c004';
  v_order constant uuid := '38720000-0000-4000-8000-00000000c005';
  v_now   constant timestamptz := timestamptz '2026-10-01 12:00:00+00';
  v_item  record;
BEGIN
  PERFORM pg_temp.issue_3872_fixture('c', v_owner, v_brand, v_event, v_date, v_now);
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status, stripe_payment_intent_id,
    stripe_charge_id, source, buyer_phone_e164, event_date_id, stripe_application_fee_amount_cents,
    refunded_amount_cents, created_at
  ) VALUES (
    v_order, v_event, 2000, 'USD', 'partial_refund', 'pi_3872_c', 'ch_3872_c',
    'online_checkout', '+12125550100', v_date, 30, 1000, v_now - interval '6 days'
  );
  -- Stripe refunded 1000 of 2000 with refund_application_fee=true, so 15 of the 30
  -- fee came back from Mingla to the connected account.
  INSERT INTO public.refunds(
    order_id, amount_cents, currency, reason, status, stripe_refund_id,
    application_fee_refunded_cents, application_fee_refund_status, buyer_refund_status
  ) VALUES (
    v_order, 1000, 'USD', 'Issue 3872 partial refund fixture', 'succeeded', 're_3872_c',
    15, 'succeeded_positive', 'succeeded'
  );
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents)
  VALUES ('order', v_order, 88);

  PERFORM public.run_payout_release_dark_sweep(v_now);

  SELECT * INTO v_item FROM public.payout_release_items
   WHERE source_type='order' AND source_id=v_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_c: order did not attach'; END IF;
  -- Host net: +2000 charged, -1000 refund, -(30-15) fee Mingla kept; provider_fee ignored.
  IF v_item.net_cents <> 2000 - 1000 - (30 - 15) THEN
    RAISE EXCEPTION 'case_c: net must deduct only the fee Mingla kept (985), got %', v_item.net_cents;
  END IF;
  RAISE NOTICE 'issue_3872 case_c pass';
END $case_c$;

-- D. Reservation deposits deduct Mingla's application fee.
DO $case_d$
DECLARE
  v_owner   constant uuid := '38720000-0000-4000-8000-00000000d001';
  v_brand   constant uuid := '38720000-0000-4000-8000-00000000d002';
  v_venue   constant uuid := '38720000-0000-4000-8000-00000000d003';
  v_resv    constant uuid := '38720000-0000-4000-8000-00000000d004';
  v_session constant uuid := '38720000-0000-4000-8000-00000000d005';
  v_now     constant timestamptz := timestamptz '2026-10-01 12:00:00+00';
  v_item    record;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-3872-d@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'Issue 3872 d', 'issue-3872-d', 'stripe', 'US', 'USD', 'USD',
    timestamptz '2020-01-01 00:00:00+00'
  );
  INSERT INTO public.venue_listings(id, brand_id, slug, name, lat, lng, venue_category, claim_status)
  VALUES (v_venue, v_brand, 'issue3872d', 'Issue 3872 d', 40.7, -74.0, 'restaurant', 'verified');
  INSERT INTO public.reservations(
    id, brand_id, venue_id, reserved_for, party_size, status, source, created_via,
    fee_cents, fee_currency, payment_intent_id, payment_status, created_at
  ) VALUES (
    v_resv, v_brand, v_venue, v_now - interval '4 days', 2, 'confirmed', 'website',
    'consumer', 2000, 'USD', 'pi_3872_d', 'paid', v_now - interval '6 days'
  );
  INSERT INTO public.reservation_checkout_sessions(
    id, brand_id, venue_id, reserved_for, party_size, buyer_name, buyer_email,
    buyer_phone_e164, amount_cents, currency, stripe_payment_intent_id, created_via,
    status, reservation_id, application_fee_amount_cents
  ) VALUES (
    v_session, v_brand, v_venue, v_now - interval '4 days', 2, 'Guest 3872',
    'guest-3872-d@example.test', '+12125550123', 2000, 'USD', 'pi_3872_d', 'web',
    'completed', v_resv, 30
  );
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents)
  VALUES ('venue_reservation', v_session, 88);

  PERFORM public.run_payout_release_dark_sweep(v_now);

  SELECT * INTO v_item FROM public.payout_release_items
   WHERE source_type='venue_reservation' AND source_id=v_session;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_d: reservation deposit did not attach'; END IF;
  IF v_item.mingla_fee_cents <> 30 OR v_item.net_cents <> 2000 - 30 THEN
    RAISE EXCEPTION 'case_d: deposit net must deduct the 30 application fee (1970), got fee % net %',
      v_item.mingla_fee_cents, v_item.net_cents;
  END IF;
  RAISE NOTICE 'issue_3872 case_d pass';
END $case_d$;

-- E. The partner-leg planner rebuilds a pending release's net without partner money.
DO $case_e$
DECLARE
  v_owner   constant uuid := '38720000-0000-4000-8000-00000000e001';
  v_brand   constant uuid := '38720000-0000-4000-8000-00000000e002';
  v_event   constant uuid := '38720000-0000-4000-8000-00000000e003';
  v_date    constant uuid := '38720000-0000-4000-8000-00000000e004';
  v_order   constant uuid := '38720000-0000-4000-8000-00000000e005';
  v_partner constant uuid := '38720000-0000-4000-8000-00000000e006';
  v_now     constant timestamptz := timestamptz '2026-10-01 12:00:00+00';
  v_item    record;
  v_net     integer;
BEGIN
  PERFORM pg_temp.issue_3872_fixture('e', v_owner, v_brand, v_event, v_date, v_now);
  INSERT INTO auth.users(id) VALUES (v_partner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_partner, 'partner-3872-e@example.test');
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status, stripe_payment_intent_id,
    stripe_charge_id, source, buyer_phone_e164, event_date_id, stripe_application_fee_amount_cents,
    created_at
  ) VALUES (
    v_order, v_event, 10000, 'USD', 'paid', 'pi_3872_e', 'ch_3872_e', 'online_checkout', '+12125550100',
    v_date, 150, v_now - interval '6 days'
  );
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents)
  VALUES ('order', v_order, 320);
  INSERT INTO public.payout_partner_attributions(
    order_id, brand_id, provider, provider_key, provider_sale_at, partner_account_id,
    outcome, mingla_fee_cents, partner_share_cents, currency
  ) VALUES (
    v_order, v_brand, 'stripe', 'fee_3872_e', v_now - interval '6 days', v_partner,
    'partner', 150, 15, 'usd'
  );
  INSERT INTO public.partner_splits(
    order_id, brand_id, partner_account_id, mingla_fee_cents, partner_share_cents,
    transfer_currency, stripe_application_fee_id, status, provider
  ) VALUES (
    v_order, v_brand, v_partner, 150, 15, 'usd', 'fee_3872_e', 'held', 'stripe'
  );

  PERFORM public.run_payout_release_dark_sweep(v_now);
  SELECT * INTO v_item FROM public.payout_release_items
   WHERE source_type='order' AND source_id=v_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_e: order did not attach'; END IF;

  PERFORM public.plan_pending_payout_partner_legs(50);
  SELECT net_release_cents INTO v_net FROM public.brand_payout_releases WHERE id = v_item.release_id;
  IF v_net <> 10000 - 150 THEN
    RAISE EXCEPTION 'case_e F1: planner must leave the host net at 9850, got %', v_net;
  END IF;
  RAISE NOTICE 'issue_3872 case_e pass';
END $case_e$;

ROLLBACK;
