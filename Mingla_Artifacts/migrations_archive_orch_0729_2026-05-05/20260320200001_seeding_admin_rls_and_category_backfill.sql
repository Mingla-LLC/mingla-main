-- Migration: Add admin write policies to seeding tables + backfill seeding_category
-- Fixes:
--   1. RLS gap: admin dashboard users couldn't INSERT/UPDATE/DELETE on seeding tables
--   2. All 950 place_pool rows had seeding_category = NULL

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Admin write policies for seeding tables
-- ═══════════════════════════════════════════════════════════════════════════════

-- seeding_cities: allow admin users full access
DROP POLICY IF EXISTS "admin_write_seeding_cities" ON public.seeding_cities;
CREATE POLICY "admin_write_seeding_cities" ON public.seeding_cities
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE email = auth.email() AND status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE email = auth.email() AND status = 'active'
    )
  );

-- seeding_tiles: allow admin users full access
DROP POLICY IF EXISTS "admin_write_seeding_tiles" ON public.seeding_tiles;
CREATE POLICY "admin_write_seeding_tiles" ON public.seeding_tiles
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE email = auth.email() AND status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE email = auth.email() AND status = 'active'
    )
  );

-- seeding_operations: allow admin users full access
DROP POLICY IF EXISTS "admin_write_seeding_operations" ON public.seeding_operations;
CREATE POLICY "admin_write_seeding_operations" ON public.seeding_operations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE email = auth.email() AND status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE email = auth.email() AND status = 'active'
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Backfill seeding_category from Google types/primary_type
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE public.place_pool
SET seeding_category = CASE
  -- ── Priority 1: Match on primary_type (most specific) ──────────────────

  -- Wellness
  WHEN primary_type IN ('spa','massage_spa','sauna','wellness_center','yoga_studio') THEN 'wellness'
  -- Fine Dining
  WHEN primary_type IN ('fine_dining_restaurant','french_restaurant','italian_restaurant','steak_house','seafood_restaurant') THEN 'fine_dining'
  -- Watch
  WHEN primary_type IN ('movie_theater') THEN 'watch'
  -- Live Performance
  WHEN primary_type IN ('performing_arts_theater','concert_hall','opera_house','philharmonic_hall','amphitheatre','comedy_club','event_venue','arena') THEN 'live_performance'
  -- Creative & Arts
  WHEN primary_type IN ('art_gallery','art_museum','art_studio','museum','history_museum','cultural_center','cultural_landmark','sculpture','library') THEN 'creative_arts'
  -- Play
  WHEN primary_type IN ('amusement_center','bowling_alley','miniature_golf_course','go_karting_venue','paintball_center','video_arcade','karaoke','amusement_park','ice_skating_rink','indoor_playground') THEN 'play'
  -- Flowers
  WHEN primary_type IN ('florist') THEN 'flowers'
  -- Groceries
  WHEN primary_type IN ('grocery_store','supermarket') THEN 'groceries'
  -- Drink
  WHEN primary_type IN ('bar','cocktail_bar','lounge_bar','wine_bar','pub','brewery','beer_garden','brewpub','night_club') THEN 'drink'
  -- First Meet
  WHEN primary_type IN ('book_store','cafe','coffee_shop','tea_house','bakery','dessert_shop','juice_shop','bistro','ice_cream_shop') THEN 'first_meet'
  -- Picnic Park
  WHEN primary_type IN ('picnic_ground') THEN 'picnic_park'
  -- Nature & Views
  WHEN primary_type IN ('beach','botanical_garden','garden','hiking_area','national_park','nature_preserve','park','scenic_spot','state_park','observation_deck','tourist_attraction','garden_center','farm') THEN 'nature_views'
  -- Casual Eats
  WHEN primary_type IN ('restaurant','brunch_restaurant','breakfast_restaurant','diner','sandwich_shop','pizza_restaurant','hamburger_restaurant','mexican_restaurant','mediterranean_restaurant','thai_restaurant','vegetarian_restaurant') THEN 'casual_eats'
  -- Live Music Venue (best-fit)
  WHEN primary_type IN ('live_music_venue') THEN 'live_performance'

  -- ── Priority 2: Fallback to types array overlap ────────────────────────

  WHEN types && ARRAY['spa','massage_spa','sauna','wellness_center','yoga_studio'] THEN 'wellness'
  WHEN types && ARRAY['fine_dining_restaurant'] THEN 'fine_dining'
  WHEN types && ARRAY['movie_theater'] THEN 'watch'
  WHEN types && ARRAY['performing_arts_theater','concert_hall','opera_house','philharmonic_hall','amphitheatre'] THEN 'live_performance'
  WHEN types && ARRAY['art_gallery','art_museum','art_studio','museum','history_museum','cultural_center','cultural_landmark','sculpture'] THEN 'creative_arts'
  WHEN types && ARRAY['amusement_center','bowling_alley','miniature_golf_course','go_karting_venue','paintball_center','video_arcade','karaoke','amusement_park'] THEN 'play'
  WHEN types && ARRAY['florist'] THEN 'flowers'
  WHEN types && ARRAY['grocery_store','supermarket'] THEN 'groceries'
  WHEN types && ARRAY['bar','cocktail_bar','lounge_bar','wine_bar','pub','brewery','beer_garden','brewpub'] THEN 'drink'
  WHEN types && ARRAY['cafe','coffee_shop','tea_house','bakery','book_store'] THEN 'first_meet'
  WHEN types && ARRAY['picnic_ground'] THEN 'picnic_park'
  WHEN types && ARRAY['park','beach','botanical_garden','hiking_area','national_park','nature_preserve','scenic_spot'] THEN 'nature_views'
  WHEN types && ARRAY['restaurant','bistro','brunch_restaurant','diner'] THEN 'casual_eats'

  -- Unmappable types left as NULL: hotel, beauty_salon, hair_salon, nail_salon,
  -- cosmetics_store, doctor, hardware_store, home_goods_store, gift_shop, service,
  -- educational_institution, point_of_interest, campground, massage, store,
  -- farmers_market (excluded from groceries by seedingCategories.ts)
  ELSE NULL
END
WHERE seeding_category IS NULL;
