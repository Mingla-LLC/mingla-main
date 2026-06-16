-- ORCH-1138 Leg 3 REWORK (§4.E) — SYNTHETIC THEMED EXPERIENCE FIXTURE.
-- =============================================================================
-- A clearly-labelled, REMOVABLE QA fixture: ONE test brand ("Mingla QA
-- Experiences") with a VIVID non-null theme (playfair_display bold display font
-- + a punchy accent) and ONE richly-populated experience published THROUGH the
-- real biz_publish_experience RPC (so it exercises the ORCH-1138 materializer +
-- the master-date trigger path), making the mockup match eyeball-verifiable on
-- web (/exp/) + the consumer deck/venue card.
--
-- The experience is:
--   * whenMode='recurring', daily preset, termination 'never' (open-daily
--     forever) → the materializer expands ~52 forward event_dates.
--   * 4 stops, each with real Raleigh coords + ai_description + 2-4 image_urls;
--     stop 1 carries a start_time (time pill).
--   * experience_intents = {adventurous, first-date} (vibe chips).
--   * is_free = true (OQ-4 default — no charges-enabled test brand needed; dodges
--     the ORCH-1075 paid-publish guard). Currency USD (I-7, never GBP).
--   * stops at QA-known Raleigh, NC coords (so it surfaces on a Raleigh-geo'd QA
--     device deck and on the venue card).
--
-- ⚠️ NOT a migration — never auto-applied. Apply manually via the Supabase
-- Management API / psql when you want the QA fixture live. IDEMPOTENT: re-running
-- soft-deletes the prior fixture rows first (by slug), then re-creates.
--
-- CLEANUP (remove the fixture entirely):
--   UPDATE public.events SET deleted_at = now()
--     WHERE brand_id = (SELECT id FROM public.brands WHERE slug='mingla-qa-experiences');
--   UPDATE public.brands SET deleted_at = now() WHERE slug='mingla-qa-experiences';
-- =============================================================================

BEGIN;

DO $fixture$
DECLARE
  v_account_id uuid := '11111111-1138-4e11-aaaa-111111111138'::uuid;
  v_brand_id   uuid := '22222222-1138-4e22-bbbb-222222222138'::uuid;
  v_place_id   uuid := '33333333-1138-4e33-cccc-333333333138'::uuid;
  v_event_id   uuid := '44444444-1138-4e44-dddd-444444444138'::uuid;
  v_today      date := (now() AT TIME ZONE 'America/New_York')::date;
  v_date_iso   text;
  v_payload    jsonb;
  v_result     jsonb;
  v_date_count integer;
BEGIN
  -- ----- 0. Clean any prior fixture (idempotent) -----
  DELETE FROM public.event_dates WHERE event_id = v_event_id;
  DELETE FROM public.experience_stops WHERE event_id = v_event_id;
  UPDATE public.ticket_types SET deleted_at = now()
    WHERE event_id = v_event_id AND deleted_at IS NULL;
  DELETE FROM public.events WHERE id = v_event_id;

  -- ----- 1. Synthetic auth user + creator account + auth shim -----
  -- biz_publish_experience reads auth.uid(); we simulate it via the request JWT
  -- claim below. creator_accounts.id FKs auth.users.id, so seed a synthetic,
  -- clearly-test auth user first (id-only; all other columns nullable/defaulted).
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  VALUES (
    v_account_id,
    'qa-experiences-1138@mingla.test',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.creator_accounts (id)
  VALUES (v_account_id)
  ON CONFLICT (id) DO NOTHING;

  -- ----- 2. A place_pool the brand claims (venue-card path) — BEFORE the brand
  --          (brands.place_pool_id FKs place_pool). -----
  INSERT INTO public.place_pool (id, name, lat, lng, is_active)
  VALUES (v_place_id, 'Mingla QA Venue (Raleigh)', 35.7796, -78.6382, true)
  ON CONFLICT (id) DO NOTHING;

  -- ----- 3. Synthetic THEMED brand (vivid accent + bold display font) -----
  INSERT INTO public.brands (id, account_id, name, slug, theme_color, theme_font, claim_status, place_pool_id, default_currency, pricing_currency)
  VALUES (
    v_brand_id, v_account_id, 'Mingla QA Experiences', 'mingla-qa-experiences',
    '#7c3aed',            -- vivid violet accent (visible theming)
    'playfair_display',   -- bold serif display font
    'verified',           -- so the venue->experiences path returns it
    v_place_id,
    'USD', 'USD'          -- I-7: USD, never GBP
  )
  ON CONFLICT (id) DO UPDATE
    SET theme_color = EXCLUDED.theme_color,
        theme_font  = EXCLUDED.theme_font,
        claim_status = 'verified',
        place_pool_id = EXCLUDED.place_pool_id,
        default_currency = 'USD',
        pricing_currency = 'USD',
        deleted_at = NULL;

  -- ----- 4. A DRAFT experience row biz_publish_experience can publish -----
  INSERT INTO public.events (id, brand_id, created_by, title, slug, event_type, currency, status, visibility, timezone)
  VALUES (
    v_event_id, v_brand_id, v_account_id,
    'QA · Raleigh Twilight Tasting Crawl', 'qa-raleigh-twilight-tasting-crawl',
    'experience', 'USD', 'draft', 'private', 'America/New_York'
  );

  -- ----- 5. Publish THROUGH the real RPC (exercises the materializer) -----
  -- Simulate the brand owner's auth.uid() for the SECURITY DEFINER RPC.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_account_id::text, 'role', 'authenticated')::text,
    true
  );

  v_date_iso := to_char(v_today, 'YYYY-MM-DD');
  v_payload := jsonb_build_object(
    'title', 'QA · Raleigh Twilight Tasting Crawl',
    'description', 'A four-stop evening crawl through Raleigh''s best wine bars, cocktail dens, and dessert spots — open daily, any time within the window. A synthetic QA fixture for ORCH-1138.',
    'experience_intents', jsonb_build_array('adventurous', 'first-date'),
    'currency', 'USD',
    'is_free', true,
    'capacity', 12,
    'location_mode', 'per_stop',
    'pricing_mode', 'whole',
    'whole_price_cents', 0,
    'whenMode', 'recurring',
    'timezone', 'America/New_York',
    'when', jsonb_build_object('date', v_date_iso, 'doorsOpen', '17:00', 'endsAt', '23:00'),
    'recurrence_rules', jsonb_build_object(
      'preset', 'daily',
      'termination', jsonb_build_object('kind', 'never')
    ),
    'stops', jsonb_build_array(
      jsonb_build_object(
        'stop_order', 0, 'place_id', 'qa-stop-1', 'place_name', 'The Cork Room',
        'address', '14 E Martin St, Raleigh, NC', 'city', 'Raleigh', 'region', 'NC', 'country_code', 'US',
        'lat', 35.7780, 'lng', -78.6389, 'start_time', '17:00',
        'ai_description', 'Start with a flight of natural wines in a candlelit cellar — the sommelier picks three to match your mood.',
        'image_urls', jsonb_build_array(
          'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800',
          'https://images.unsplash.com/photo-1547595628-c61a29f496f0?w=800',
          'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800'
        )
      ),
      jsonb_build_object(
        'stop_order', 1, 'place_id', 'qa-stop-2', 'place_name', 'Foundation Bar',
        'address', '213 Fayetteville St, Raleigh, NC', 'city', 'Raleigh', 'region', 'NC', 'country_code', 'US',
        'lat', 35.7768, 'lng', -78.6386,
        'ai_description', 'A subterranean cocktail den — order the barrel-aged Old Fashioned and grab the corner booth.',
        'image_urls', jsonb_build_array(
          'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=800',
          'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=800'
        )
      ),
      jsonb_build_object(
        'stop_order', 2, 'place_id', 'qa-stop-3', 'place_name', 'Gallo Pelón',
        'address', '106 S Wilmington St, Raleigh, NC', 'city', 'Raleigh', 'region', 'NC', 'country_code', 'US',
        'lat', 35.7762, 'lng', -78.6391,
        'ai_description', 'Mezcal and small plates — the smoky margarita is the move before dessert.',
        'image_urls', jsonb_build_array(
          'https://images.unsplash.com/photo-1551024601-bec78aea704b?w=800',
          'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=800',
          'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800',
          'https://images.unsplash.com/photo-1606787366850-de6330128bfc?w=800'
        )
      ),
      jsonb_build_object(
        'stop_order', 3, 'place_id', 'qa-stop-4', 'place_name', 'Lucettegrace',
        'address', '235 S Salisbury St, Raleigh, NC', 'city', 'Raleigh', 'region', 'NC', 'country_code', 'US',
        'lat', 35.7758, 'lng', -78.6402,
        'ai_description', 'End with a pastry flight and an espresso — the salted-caramel éclair is the finale.',
        'image_urls', jsonb_build_array(
          'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=800',
          'https://images.unsplash.com/photo-1551024506-0bccd828d307?w=800'
        )
      )
    )
  );

  v_result := public.biz_publish_experience(v_event_id, v_payload, true);

  -- ----- 6. Assert the materializer produced real bookable occurrences -----
  SELECT count(*) INTO v_date_count FROM public.event_dates WHERE event_id = v_event_id;
  RAISE NOTICE 'ORCH-1138 fixture published: event=% dates=% (expect ~52)', v_event_id, v_date_count;
  IF v_date_count < 2 THEN
    RAISE EXCEPTION 'ORCH-1138 fixture FAILED: materializer produced % event_dates (expected >1 — is 20261005000000 applied?)', v_date_count;
  END IF;
END
$fixture$;

COMMIT;
