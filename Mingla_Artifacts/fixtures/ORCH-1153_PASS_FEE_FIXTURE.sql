-- ORCH-1153 §8 — SYNTHETIC PASS-FEE FIXTURE (TEST mode only).
--
-- WHY: 0/8 live charges-enabled brands pass any fee, so on live data base ===
-- all-in and the WS3 display fix is invisible. To PROVE displayed===charged with
-- a NON-ZERO fee, create this synthetic brand + experience in TEST mode (Stripe
-- is test-mode end-to-end, sandbox acct_1TTnt1). NEVER flip a live brand.
--
-- WHO RUNS THIS: the tester / orchestrator (it is a DB WRITE — the implementor
-- does not mutate prod). Run against the TEST project with the connected sandbox
-- account so checkout reaches the PaymentSheet. The brand's pass_mingla_fee=true
-- grosses the all-in above base (pg_public_event_tier_allin), so the page price
-- (ticket.priceAllInGbp ×100) MUST equal the cart total and the charged amount.
--
-- After running, record the printed brand_id / event_id / slug in the TEST
-- report for reuse + teardown. The experience is daily/never recurring so it also
-- exercises the open-daily picker + the backfill/top-up paths.
--
-- TEARDOWN (after QA): soft-delete the event + brand
--   UPDATE public.events SET deleted_at = now() WHERE id = '<event_id>';
--   UPDATE public.brands SET deleted_at = now() WHERE id = '<brand_id>';

DO $fixture$
DECLARE
  v_owner   uuid;
  v_brand   uuid;
  v_event   uuid;
  v_ticket  uuid;
  v_tz      text := 'America/New_York';
  v_master  timestamptz := date_trunc('day', now()) + INTERVAL '1 day' + INTERVAL '19 hours'; -- tomorrow 7pm local-ish
BEGIN
  -- Pick any existing user as the brand owner (TEST data only).
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'no auth.users row to own the fixture brand';
  END IF;

  -- 1) the pass-fee brand. pass_mingla_fee=true → all-in grosses above base.
  --    charges_enabled must be true so the paid offering is sellable/visible;
  --    point stripe_account_id at the sandbox connected account for PaymentSheet.
  INSERT INTO public.brands (
    name, slug, default_currency, claim_status, deleted_at,
    pass_mingla_fee, pass_service_fee, pass_tax
  ) VALUES (
    'ORCH-1153 Pass-Fee QA',
    'orch-1153-pass-fee-qa-' || substr(gen_random_uuid()::text, 1, 8),
    'USD', 'verified', NULL,
    true, false, false
  ) RETURNING id INTO v_brand;

  -- NOTE: set the brand's Stripe readiness the same way the QA fixtures do in
  -- your environment (e.g. UPDATE public.brands SET stripe_account_id=...,
  -- stripe_charges_enabled=true WHERE id=v_brand) so pg_brand_can_charge() passes
  -- and the experience is supply-eligible + checkout reaches PaymentSheet.

  -- 2) the paid, recurring daily/never experience (base $50.00).
  INSERT INTO public.events (
    brand_id, title, slug, description, event_type, status, visibility,
    is_recurring, recurrence_rules, location_mode, pricing_mode, whole_price_cents,
    experience_intents, experience_intent, currency, timezone, published_at
  ) VALUES (
    v_brand,
    'ORCH-1153 Pass-Fee Tasting Crawl',
    'orch-1153-pass-fee-tasting-crawl-' || substr(gen_random_uuid()::text, 1, 8),
    'A synthetic pass-fee QA experience so displayed===charged is provable with a non-zero Mingla fee.',
    'experience', 'scheduled', 'public',
    true, '{"preset":"daily","termination":{"kind":"never"}}'::jsonb,
    'single', 'whole', 5000,
    ARRAY['first-date']::text[], 'first-date', 'USD', v_tz, now()
  ) RETURNING id INTO v_event;

  -- 3) the ONE sellable ticket (I-1), base 5000 cents.
  INSERT INTO public.ticket_types (
    event_id, name, price_cents, currency, quantity_total, is_unlimited, is_free,
    min_purchase_qty, max_purchase_qty, is_hidden, is_disabled, requires_approval,
    allow_transfers, password_protected, available_online, available_in_person,
    waitlist_enabled, display_order
  ) VALUES (
    v_event, 'Standard', 5000, 'USD', 20, false, false,
    1, NULL, false, false, false, true, false, true, true, false, 0
  ) RETURNING id INTO v_ticket;

  -- 4) materialise the master + the recurrence (so it is bookable + open-daily).
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (v_event, v_master, v_master + INTERVAL '2 hours', v_tz, true);
  PERFORM public.pg_expand_experience_recurrence(
    v_event, v_master, v_master + INTERVAL '2 hours',
    '{"preset":"daily","termination":{"kind":"never"}}'::jsonb, v_tz);

  -- 5) add at least one stop with geo so it publishes + appears on supply.
  INSERT INTO public.experience_stops (
    event_id, stop_order, place_name, address, city, region, country_code, lat, lng,
    image_urls, price_cents, ai_description
  ) VALUES
    (v_event, 0, 'Tasting Room A', '1 Glenwood Ave', 'Raleigh', 'NC', 'US', 35.7796, -78.6382,
     ARRAY[]::text[], 0, 'First stop'),
    (v_event, 1, 'Tasting Room B', '2 Glenwood Ave', 'Raleigh', 'NC', 'US', 35.7800, -78.6390,
     ARRAY[]::text[], 0, 'Second stop');

  RAISE NOTICE 'ORCH-1153 fixture created: brand_id=% event_id=% ticket_id=%', v_brand, v_event, v_ticket;
  RAISE NOTICE 'slug: query SELECT slug FROM events WHERE id=''%''', v_event;
END;
$fixture$;
