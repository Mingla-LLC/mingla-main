-- Issue #3645 — venue menu dark-sweep subtracts full application fee (PG17).
--
-- MINGLA-INVARIANT: I-3645-VENUE-MENU-RELEASE-FULL-APP-FEE | issue #3645 | Dark-sweep attach for venue_menu_order deducts mingla_fee_cents + platform_service_fee_cents (the charged application fee), so host net never includes the service-fee slice Mingla already took at charge.
--
-- Also pins Paystack dispute pending-item net to the flat 4.5% host formula
-- (gross − refunded − disputed − mingla_fee; partner_share and provider_fee
-- stay off the host net).
-- [TEST-MOD-APPROVED #3645] The old H2 expected an UPDATE to the immutable
-- payout item. The release projection now carries the dispute hold while the
-- item remains the append-only sale snapshot.

BEGIN;

-- H1: venue menu order with non-zero platform_service_fee — host net excludes
-- both Mingla take and service fee (equals charged application fee).
DO $h1$
DECLARE
  v_owner constant uuid := '3645fe00-0000-4000-8000-000000000001';
  v_brand constant uuid := '3645fe00-0000-4000-8000-000000000002';
  v_venue constant uuid := '3645fe00-0000-4000-8000-000000000003';
  v_session constant uuid := '3645fe00-0000-4000-8000-000000000004';
  v_order constant uuid := '3645fe00-0000-4000-8000-000000000005';
  v_now constant timestamptz := timestamptz '2026-10-22 12:00:00+00';
  v_item record;
  v_app_fee constant integer := 450 + 135; -- mingla + platform_service
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'issue-3645-venue-fee@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 Venue Fee', 'issue-3645-venue-fee',
    'stripe', 'US', 'USD', 'USD', timestamptz '2020-01-01 00:00:00+00'
  );
  INSERT INTO public.venue_listings(
    id, brand_id, slug, name, lat, lng, venue_category, claim_status
  ) VALUES (
    v_venue, v_brand, 'issue3645venuefee', 'Issue 3645 Venue Fee',
    40.7, -74.0, 'restaurant', 'verified'
  );
  INSERT INTO public.venue_order_sessions(id, brand_id, venue_id, currency)
  VALUES (v_session, v_brand, v_venue, 'USD');
  -- fee_basis = 4000 + 500 = 4500; take 10% → 450; service 3% → 135;
  -- both passed → buyer/total 5085. Matches venue_orders fee CHECKs.
  INSERT INTO public.venue_orders(
    id, session_id, brand_id, venue_id, source, pickup_code, buyer_name,
    buyer_email, buyer_phone_e164, money_path, currency,
    subtotal_cents, service_charge_bps, service_charge_cents, tip_cents,
    effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
    platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, tax_amount_cents, total_cents, provider, payment_status,
    confirmed_at, idempotency_key, created_at
  ) VALUES (
    v_order, v_session, v_brand, v_venue, 'guest_page', '77',
    'Guest', 'venue-fee-3645@example.test', '+12125550777', 'mingla', 'USD',
    4000, 1250, 500, 0, 1000, 300, 450, 135,
    true, true, false, 5085, 0, 5085, 'stripe', 'paid',
    v_now - interval '25 hours', 'issue-3645-venue-full-app-fee',
    v_now - interval '25 hours'
  );
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents)
  VALUES ('venue_menu_order', v_order, 180);

  PERFORM public.run_payout_release_dark_sweep(v_now);

  SELECT * INTO v_item FROM public.payout_release_items
   WHERE source_type = 'venue_menu_order' AND source_id = v_order;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'H1: venue menu order did not attach';
  END IF;
  IF v_item.mingla_fee_cents <> v_app_fee THEN
    RAISE EXCEPTION 'H1: mingla_fee must be full app fee %, got %',
      v_app_fee, v_item.mingla_fee_cents;
  END IF;
  IF v_item.gross_cents <> 5085 THEN
    RAISE EXCEPTION 'H1: gross must be order total 5085, got %', v_item.gross_cents;
  END IF;
  -- Host net = gross − full application fee; provider fee snapshotted, not deducted.
  IF v_item.net_cents <> 5085 - v_app_fee THEN
    RAISE EXCEPTION 'H1: net must be % (gross − full app fee), got %',
      5085 - v_app_fee, v_item.net_cents;
  END IF;
  IF v_item.provider_fee_cents <> 180 THEN
    RAISE EXCEPTION 'H1: provider fee must remain snapshotted at 180, got %',
      v_item.provider_fee_cents;
  END IF;
END
$h1$;

-- H2: Paystack dispute on a pending release recomputes the executable release
-- without mutating the append-only item.
DO $h2$
DECLARE
  v_owner constant uuid := '3645fe00-0000-4000-8000-000000000011';
  v_brand constant uuid := '3645fe00-0000-4000-8000-000000000012';
  v_event constant uuid := '3645fe00-0000-4000-8000-000000000013';
  v_order constant uuid := '3645fe00-0000-4000-8000-000000000014';
  v_rel   constant uuid := '3645fe00-0000-4000-8000-000000000015';
  v_now   timestamptz := timestamptz '2026-10-22 15:00:00+00';
  v_out   jsonb;
  v_item  record;
  v_release record;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'issue-3645-dispute-net@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 Dispute Net', 'issue-3645-dispute-net',
    'paystack', 'NG', 'NGN', 'NGN'
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'Dispute Net Event', 'issue-3645-dispute-net-ev', 'live', 'NGN');
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, source
  ) VALUES (
    v_order, v_event, 10000, 'NGN', 'paid', 'psk_3645_venue_fee_dispute', 'legacy'
  );
  -- Stored partner_share + provider_fee must NOT reduce host net under flat 4.5%.
  INSERT INTO public.brand_payout_releases(
    id, brand_id, event_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_release_cents, status
  ) VALUES (
    v_rel, v_brand, v_event, 'dispute-net-rel', 'order', 'paystack', 'ngn',
    v_now - interval '2 hours', v_now + interval '22 hours',
    10000, 450, 45, 300, 10000 - 450, 'pending'
  );
  INSERT INTO public.payout_release_items(
    release_id, source_type, source_id, gross_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_cents, source_finalized_at
  ) VALUES (
    v_rel, 'order', v_order, 10000, 450, 45, 300, 10000 - 450, v_now - interval '2 hours'
  );

  v_out := public.record_paystack_dispute_outcome(
    'dsp_3645_fee_net', 'psk_3645_venue_fee_dispute', 'charge.dispute.create',
    'pending', NULL, 2000, 'ngn', 'chargeback', NULL,
    '{"id":"dsp_3645_fee_net"}'::jsonb, v_now
  );
  IF coalesce((v_out->>'matched')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'H2: expected dispute match, got %', v_out;
  END IF;

  SELECT * INTO v_item FROM public.payout_release_items
   WHERE source_type = 'order' AND source_id = v_order;
  IF v_item.disputed_cents <> 0 OR v_item.net_cents <> 10000 - 450 THEN
    RAISE EXCEPTION 'H2: immutable item changed: disputed %, net %',
      v_item.disputed_cents, v_item.net_cents;
  END IF;
  SELECT * INTO v_release FROM public.brand_payout_releases WHERE id = v_rel;
  IF v_release.disputed_cents <> 2000 THEN
    RAISE EXCEPTION 'H2: release disputed_cents must be 2000, got %',
      v_release.disputed_cents;
  END IF;
  -- Old bug: 10000 - 2000 - 450 - 45 - 300 = 7205.
  -- Flat 4.5%: 10000 - 2000 - 450 = 7550.
  IF v_release.net_release_cents <> 10000 - 2000 - 450 THEN
    RAISE EXCEPTION 'H2: net must be 7550 (ignore partner/provider), got %',
      v_release.net_release_cents;
  END IF;
END
$h2$;

ROLLBACK;
