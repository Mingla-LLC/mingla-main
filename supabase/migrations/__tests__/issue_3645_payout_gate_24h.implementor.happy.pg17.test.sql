-- Issue #3645 — payment + 24h payout-run gate, implementor happy path.
--
-- MINGLA-INVARIANT: I-3645-PAYOUT-SWEEP-GATE-PAYMENT-PLUS-24H | issue #3645 | Every eligible sale is attached by the payout sweep at finalized_at + 24 hours, independent of its event, reservation, or stay end date.

BEGIN;

CREATE TEMP TABLE issue_3645_happy_fx(k text PRIMARY KEY, v uuid NOT NULL);

DO $seed$
DECLARE
  v_owner constant uuid := '36452400-0000-4000-8000-000000000001';
  v_brand constant uuid := '36452400-0000-4000-8000-000000000002';
  v_event constant uuid := '36452400-0000-4000-8000-000000000003';
  v_date  constant uuid := '36452400-0000-4000-8000-000000000004';
  v_venue constant uuid := '36452400-0000-4000-8000-000000000005';
  v_stay_venue constant uuid := '36452400-0000-4000-8000-000000000006';
  v_now constant timestamptz := timestamptz '2026-10-21 12:00:00+00';
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'issue-3645-payout-gate@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 Payout Gate', 'issue-3645-payout-gate',
    'stripe', 'US', 'USD', 'USD', timestamptz '2020-01-01 00:00:00+00'
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'Issue 3645 Future Event',
          'issue-3645-future-event', 'live', 'USD');
  INSERT INTO public.event_dates(id, event_id, start_at, end_at, timezone, is_master)
  VALUES (v_date, v_event, v_now + interval '30 days',
          v_now + interval '30 days 3 hours', 'UTC', true);
  INSERT INTO public.venue_listings(
    id, brand_id, slug, name, lat, lng, venue_category, claim_status
  ) VALUES
    (v_venue, v_brand, 'issue3645venue', 'Issue 3645 Venue', 40.7, -74.0,
     'restaurant', 'verified'),
    (v_stay_venue, v_brand, 'issue3645stay', 'Issue 3645 Stay', 40.8, -74.1,
     'stay', 'verified');
  INSERT INTO issue_3645_happy_fx VALUES
    ('owner', v_owner), ('brand', v_brand), ('event', v_event),
    ('date', v_date), ('venue', v_venue), ('stay_venue', v_stay_venue);
END
$seed$;

CREATE FUNCTION pg_temp.fx(p_key text) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT v FROM issue_3645_happy_fx WHERE k = p_key
$$;

-- H1/H2: the real sweep attaches 25h-old money, but not 23h-old money, even
-- though the event itself is still 30 days away.
DO $h1_h2$
DECLARE
  v_now constant timestamptz := timestamptz '2026-10-21 12:00:00+00';
  v_old constant uuid := '36452400-0000-4000-8000-000000000101';
  v_young constant uuid := '36452400-0000-4000-8000-000000000102';
  v_release record;
BEGIN
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source, buyer_phone_e164,
    event_date_id, stripe_application_fee_amount_cents, created_at
  ) VALUES
    (v_old, pg_temp.fx('event'), 10000, 'USD', 'paid', 'pi_3645_h1',
     'ch_3645_h1', 'online_checkout', '+12125550101', pg_temp.fx('date'), 450,
     v_now - interval '25 hours'),
    (v_young, pg_temp.fx('event'), 20000, 'USD', 'paid', 'pi_3645_h2',
     'ch_3645_h2', 'online_checkout', '+12125550102', pg_temp.fx('date'), 900,
     v_now - interval '23 hours');
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents)
  VALUES ('order', v_old, 320), ('order', v_young, 640);

  PERFORM public.run_payout_release_dark_sweep(v_now);

  SELECT release_row.* INTO v_release
  FROM public.brand_payout_releases release_row
  JOIN public.payout_release_items item ON item.release_id = release_row.id
  WHERE item.source_type = 'order' AND item.source_id = v_old;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'H1: 25h-old order was not attached';
  END IF;
  IF v_release.releasable_at <> v_now - interval '1 hour'
     OR v_release.anchor_end_at <> v_now - interval '25 hours' THEN
    RAISE EXCEPTION 'H1: maturity was not finalized_at + 1 day: anchor %, releasable %',
      v_release.anchor_end_at, v_release.releasable_at;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payout_release_items
    WHERE source_type = 'order' AND source_id = v_young
  ) THEN
    RAISE EXCEPTION 'H2: 23h-old order attached before payment + 24h';
  END IF;
END
$h1_h2$;

-- H3: a later sale for the same event-date unit must never mutate a release
-- that has already gone out; it opens generation #1 instead.
DO $h3$
DECLARE
  v_now constant timestamptz := timestamptz '2026-10-21 12:00:00+00';
  v_first constant uuid := '36452400-0000-4000-8000-000000000101';
  v_later constant uuid := '36452400-0000-4000-8000-000000000103';
  v_release_a uuid;
  v_gross_a integer;
  v_net_a integer;
  v_items_a integer;
  v_release_b record;
BEGIN
  SELECT item.release_id INTO v_release_a
  FROM public.payout_release_items item
  WHERE item.source_type = 'order' AND item.source_id = v_first;
  UPDATE public.brand_payout_releases
  SET status = 'released', released_at = v_now - interval '30 minutes',
      organiser_cash_delivered_cents = net_release_cents
  WHERE id = v_release_a;
  SELECT gross_cents, net_release_cents INTO v_gross_a, v_net_a
  FROM public.brand_payout_releases WHERE id = v_release_a;
  SELECT count(*) INTO v_items_a FROM public.payout_release_items
  WHERE release_id = v_release_a;

  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source, buyer_phone_e164,
    event_date_id, stripe_application_fee_amount_cents, created_at
  ) VALUES (
    v_later, pg_temp.fx('event'), 5000, 'USD', 'paid', 'pi_3645_h3',
    'ch_3645_h3', 'online_checkout', '+12125550103', pg_temp.fx('date'), 225,
    v_now - interval '24 hours 30 minutes'
  );
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents)
  VALUES ('order', v_later, 160);

  PERFORM public.run_payout_release_dark_sweep(v_now);

  SELECT release_row.* INTO v_release_b
  FROM public.brand_payout_releases release_row
  JOIN public.payout_release_items item ON item.release_id = release_row.id
  WHERE item.source_type = 'order' AND item.source_id = v_later;
  IF NOT FOUND OR v_release_b.status <> 'pending'
     OR v_release_b.occurrence_key <> pg_temp.fx('date')::text || '#1' THEN
    RAISE EXCEPTION 'H3: later sale did not open pending #1 release: %', row_to_json(v_release_b);
  END IF;
  IF (SELECT (gross_cents, net_release_cents) FROM public.brand_payout_releases
      WHERE id = v_release_a) IS DISTINCT FROM ROW(v_gross_a, v_net_a)
     OR (SELECT count(*) FROM public.payout_release_items WHERE release_id = v_release_a)
        <> v_items_a THEN
    RAISE EXCEPTION 'H3: released generation zero was mutated by a later sale';
  END IF;
END
$h3$;

-- H4: a stay paid 25h ago attaches while checkout remains 10 days away. The
-- fixture bypasses only unrelated quote/inventory foreign-key triggers; all
-- CHECKs and the payout functions execute normally.
DO $h4$
DECLARE
  v_now constant timestamptz := timestamptz '2026-10-21 12:00:00+00';
  v_group constant uuid := '36452400-0000-4000-8000-000000000201';
  v_line constant uuid := '36452400-0000-4000-8000-000000000202';
  v_attempt constant uuid := '36452400-0000-4000-8000-000000000203';
  v_result jsonb;
  v_release record;
BEGIN
  INSERT INTO public.stay_settings(
    venue_id, brand_id, property_kind, timezone, default_booking_mode, booking_state
  ) VALUES (pg_temp.fx('stay_venue'), pg_temp.fx('brand'), 'hotel', 'UTC', 'instant', 'active');

  SET LOCAL session_replication_role = replica;
  INSERT INTO public.stay_reservation_groups(
    id, public_reference, quote_id, actor_key_hash, venue_id, brand_id,
    currency_code, mode, state, guest_snapshot, source_subtotal_minor,
    fee_total_minor, tax_total_minor, total_minor, idempotency_key, request_hash
  ) VALUES (
    v_group, 'ST-36452400000000000201', '36452400-0000-4000-8000-000000000211',
    repeat('a', 64), pg_temp.fx('stay_venue'), pg_temp.fx('brand'), 'USD',
    'instant', 'confirmed', '{}'::jsonb, 10000, 450, 0, 10450,
    'issue-3645-h4-group', repeat('b', 64)
  );
  INSERT INTO public.stay_reservation_lines(
    id, group_id, quote_line_id, offering_id, kind, state, room_check_in,
    room_check_out, room_quantity, adults, children, base_minor, fee_minor,
    tax_minor, total_minor, offering_snapshot, price_snapshot, policy_snapshot
  ) VALUES (
    v_line, v_group, '36452400-0000-4000-8000-000000000212',
    '36452400-0000-4000-8000-000000000213', 'room', 'confirmed',
    (v_now + interval '8 days')::date, (v_now + interval '10 days')::date,
    1, 2, 0, 10000, 450, 0, 10450, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  );
  INSERT INTO public.stay_payment_attempts(
    id, group_id, provider, attempt_ordinal, amount_minor, currency_code,
    application_fee_minor, provider_fee_minor, state, provider_payment_ref,
    idempotency_key, request_hash, succeeded_at
  ) VALUES (
    v_attempt, v_group, 'stripe', 1, 10450, 'USD', 450, 300, 'succeeded',
    'pi_3645_h4', 'issue-3645-h4-attempt', repeat('c', 64),
    v_now - interval '25 hours'
  );
  INSERT INTO public.stay_payout_line_snapshots(
    reservation_line_id, payment_attempt_id, platform_fee_minor, provider_fee_minor
  ) VALUES (v_line, v_attempt, 450, 300);
  SET LOCAL session_replication_role = origin;

  v_result := public.run_stay_payout_release_dark_sweep(v_now);
  IF coalesce((v_result->>'attached')::integer, -1) <> 1 THEN
    RAISE EXCEPTION 'H4: stay sweep attached %, expected 1', v_result->>'attached';
  END IF;
  SELECT release_row.* INTO v_release
  FROM public.brand_payout_releases release_row
  JOIN public.payout_release_items item ON item.release_id = release_row.id
  WHERE item.source_type = 'stay_reservation' AND item.source_id = v_line;
  IF NOT FOUND OR v_release.anchor_end_at <> v_now - interval '25 hours'
     OR v_release.releasable_at <> v_now - interval '1 hour' THEN
    RAISE EXCEPTION 'H4: stay release did not anchor on payment: %', row_to_json(v_release);
  END IF;
END
$h4$;

-- H5: the other three non-installment money surfaces all attach at payment+24h.
DO $h5$
DECLARE
  v_now constant timestamptz := timestamptz '2026-10-21 12:00:00+00';
  v_rsvp constant uuid := '36452400-0000-4000-8000-000000000301';
  v_reservation constant uuid := '36452400-0000-4000-8000-000000000302';
  v_checkout constant uuid := '36452400-0000-4000-8000-000000000303';
  v_session constant uuid := '36452400-0000-4000-8000-000000000304';
  v_menu_order constant uuid := '36452400-0000-4000-8000-000000000305';
  v_attached integer;
BEGIN
  INSERT INTO public.event_rsvp_contributions(
    id, event_id, brand_id, provider, currency, amount_cents, buyer_total_cents,
    application_fee_amount_cents, pricing_breakdown, status,
    stripe_payment_intent_id, paid_at, created_at
  ) VALUES (
    v_rsvp, pg_temp.fx('event'), pg_temp.fx('brand'), 'stripe', 'USD', 2000,
    2000, 90, '{}'::jsonb, 'paid', 'pi_3645_h5_rsvp',
    v_now - interval '25 hours', v_now - interval '25 hours'
  );

  INSERT INTO public.reservations(
    id, brand_id, venue_id, reserved_for, party_size, status, source, created_via,
    fee_cents, fee_currency, payment_intent_id, payment_status, created_at
  ) VALUES (
    v_reservation, pg_temp.fx('brand'), pg_temp.fx('venue'), v_now + interval '30 days',
    2, 'confirmed', 'website', 'consumer', 3000, 'USD', 'pi_3645_h5_reservation',
    'paid', v_now - interval '25 hours'
  );
  INSERT INTO public.reservation_checkout_sessions(
    id, brand_id, venue_id, reserved_for, party_size, buyer_name, buyer_email,
    buyer_phone_e164, amount_cents, currency, stripe_payment_intent_id,
    created_via, status, reservation_id, application_fee_amount_cents
  ) VALUES (
    v_checkout, pg_temp.fx('brand'), pg_temp.fx('venue'), v_now + interval '30 days',
    2, 'Guest', 'guest-3645@example.test', '+12125550303', 3000, 'USD',
    'pi_3645_h5_reservation', 'web', 'completed', v_reservation, 135
  );

  INSERT INTO public.venue_order_sessions(id, brand_id, venue_id, currency)
  VALUES (v_session, pg_temp.fx('brand'), pg_temp.fx('venue'), 'USD');
  INSERT INTO public.venue_orders(
    id, session_id, brand_id, venue_id, source, pickup_code, buyer_name,
    buyer_email, buyer_phone_e164, money_path, currency,
    subtotal_cents, service_charge_bps, service_charge_cents, tip_cents,
    effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
    platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, tax_amount_cents, total_cents, provider, payment_status,
    confirmed_at, idempotency_key, created_at
  ) VALUES (
    v_menu_order, v_session, pg_temp.fx('brand'), pg_temp.fx('venue'), 'guest_page', '42',
    'Guest', 'menu-3645@example.test', '+12125550305', 'mingla', 'USD',
    4000, 1250, 500, 0, 1000, 300, 450, 135,
    true, true, false, 5085, 0, 5085, 'stripe', 'paid',
    v_now - interval '25 hours', 'issue-3645-h5-menu', v_now - interval '25 hours'
  );
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents)
  VALUES
    ('rsvp_contribution', v_rsvp, 70),
    ('venue_reservation', v_checkout, 100),
    ('venue_menu_order', v_menu_order, 180);

  PERFORM public.run_payout_release_dark_sweep(v_now);
  SELECT count(*) INTO v_attached
  FROM public.payout_release_items
  WHERE (source_type, source_id) IN (
    ('rsvp_contribution', v_rsvp),
    ('venue_reservation', v_checkout),
    ('venue_menu_order', v_menu_order)
  );
  IF v_attached <> 3 THEN
    RAISE EXCEPTION 'H5: expected all three money surfaces, attached %', v_attached;
  END IF;
END
$h5$;

ROLLBACK;
