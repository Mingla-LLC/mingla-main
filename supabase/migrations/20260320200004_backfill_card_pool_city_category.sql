-- ═══════════════════════════════════════════════════════════════════════════════
-- BACKFILL: card_pool.city_id
-- ═══════════════════════════════════════════════════════════════════════════════

-- Single cards: derive city_id from place_pool via place_pool_id FK
UPDATE public.card_pool cp
SET city_id = pp.city_id
FROM public.place_pool pp
WHERE cp.place_pool_id = pp.id
  AND cp.card_type = 'single'
  AND cp.city_id IS NULL;

-- Curated cards: derive city_id from first stop's place (stop_order = 0)
UPDATE public.card_pool cp
SET city_id = pp.city_id
FROM public.card_pool_stops cps
JOIN public.place_pool pp ON pp.id = cps.place_pool_id
WHERE cps.card_pool_id = cp.id
  AND cp.card_type = 'curated'
  AND cp.city_id IS NULL
  AND cps.stop_order = (
    SELECT MIN(cps2.stop_order)
    FROM public.card_pool_stops cps2
    WHERE cps2.card_pool_id = cp.id
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- BACKFILL: card_pool.category → slug normalization
-- ═══════════════════════════════════════════════════════════════════════════════

-- Step 1: Display name → slug (for single cards)
UPDATE public.card_pool SET category = 'nature_views'    WHERE category = 'Nature & Views';
UPDATE public.card_pool SET category = 'first_meet'      WHERE category = 'First Meet';
UPDATE public.card_pool SET category = 'picnic_park'     WHERE category = 'Picnic Park';
UPDATE public.card_pool SET category = 'drink'           WHERE category = 'Drink';
UPDATE public.card_pool SET category = 'casual_eats'     WHERE category = 'Casual Eats';
UPDATE public.card_pool SET category = 'fine_dining'     WHERE category = 'Fine Dining';
UPDATE public.card_pool SET category = 'watch'           WHERE category = 'Watch';
UPDATE public.card_pool SET category = 'live_performance' WHERE category = 'Live Performance';
UPDATE public.card_pool SET category = 'creative_arts'   WHERE category = 'Creative & Arts';
UPDATE public.card_pool SET category = 'play'            WHERE category = 'Play';
UPDATE public.card_pool SET category = 'wellness'        WHERE category = 'Wellness';
UPDATE public.card_pool SET category = 'flowers'         WHERE category = 'Flowers';
UPDATE public.card_pool SET category = 'groceries'       WHERE category = 'Groceries';

-- Step 2: Google type → slug (for curated cards)
-- Nature & Views
UPDATE public.card_pool SET category = 'nature_views' WHERE category IN (
  'beach', 'botanical_garden', 'garden', 'hiking_area', 'national_park',
  'nature_preserve', 'park', 'scenic_spot', 'state_park', 'observation_deck',
  'tourist_attraction'
) AND card_type = 'curated';

-- First Meet
UPDATE public.card_pool SET category = 'first_meet' WHERE category IN (
  'cafe', 'coffee_shop', 'tea_house', 'bakery', 'dessert_shop',
  'ice_cream_shop', 'juice_shop', 'donut_shop', 'book_store'
) AND card_type = 'curated';

-- Picnic Park
UPDATE public.card_pool SET category = 'picnic_park' WHERE category IN (
  'picnic_ground'
) AND card_type = 'curated';

-- Drink
UPDATE public.card_pool SET category = 'drink' WHERE category IN (
  'bar', 'cocktail_bar', 'wine_bar', 'pub', 'brewery',
  'beer_garden', 'brewpub', 'lounge_bar', 'night_club'
) AND card_type = 'curated';

-- Casual Eats
UPDATE public.card_pool SET category = 'casual_eats' WHERE category IN (
  'restaurant', 'bistro', 'brunch_restaurant', 'breakfast_restaurant', 'diner',
  'fast_food_restaurant', 'hamburger_restaurant', 'pizza_restaurant',
  'ramen_restaurant', 'sandwich_shop', 'sushi_restaurant', 'buffet_restaurant',
  'american_restaurant', 'asian_restaurant', 'barbecue_restaurant',
  'brazilian_restaurant', 'chinese_restaurant', 'indian_restaurant',
  'indonesian_restaurant', 'japanese_restaurant', 'korean_restaurant',
  'lebanese_restaurant', 'mediterranean_restaurant', 'mexican_restaurant',
  'middle_eastern_restaurant', 'seafood_restaurant', 'spanish_restaurant',
  'thai_restaurant', 'turkish_restaurant', 'vegan_restaurant',
  'vegetarian_restaurant', 'vietnamese_restaurant', 'italian_restaurant',
  'greek_restaurant', 'afghani_restaurant', 'african_restaurant'
) AND card_type = 'curated';

-- Fine Dining
UPDATE public.card_pool SET category = 'fine_dining' WHERE category IN (
  'fine_dining_restaurant', 'french_restaurant', 'steak_house'
) AND card_type = 'curated';

-- Watch
UPDATE public.card_pool SET category = 'watch' WHERE category IN (
  'movie_theater'
) AND card_type = 'curated';

-- Live Performance
UPDATE public.card_pool SET category = 'live_performance' WHERE category IN (
  'performing_arts_theater', 'concert_hall', 'opera_house',
  'philharmonic_hall', 'amphitheatre'
) AND card_type = 'curated';

-- Creative & Arts
UPDATE public.card_pool SET category = 'creative_arts' WHERE category IN (
  'art_gallery', 'art_museum', 'art_studio', 'museum', 'history_museum',
  'cultural_center', 'cultural_landmark', 'sculpture'
) AND card_type = 'curated';

-- Play
UPDATE public.card_pool SET category = 'play' WHERE category IN (
  'amusement_center', 'amusement_park', 'bowling_alley', 'miniature_golf_course',
  'go_karting_venue', 'paintball_center', 'video_arcade', 'karaoke'
) AND card_type = 'curated';

-- Wellness
UPDATE public.card_pool SET category = 'wellness' WHERE category IN (
  'spa', 'massage_spa', 'sauna', 'yoga_studio', 'wellness_center'
) AND card_type = 'curated';

-- Flowers
UPDATE public.card_pool SET category = 'flowers' WHERE category IN (
  'florist'
) AND card_type = 'curated';

-- Groceries
UPDATE public.card_pool SET category = 'groceries' WHERE category IN (
  'grocery_store', 'supermarket'
) AND card_type = 'curated';

-- Step 3: Catch-all — any remaining unmapped Google types on curated cards.
-- Derive from parent place's seeding_category via card_pool_stops.
UPDATE public.card_pool cp
SET category = pp.seeding_category
FROM public.card_pool_stops cps
JOIN public.place_pool pp ON pp.id = cps.place_pool_id
WHERE cps.card_pool_id = cp.id
  AND cp.card_type = 'curated'
  AND cp.category NOT IN (
    'nature_views', 'first_meet', 'picnic_park', 'drink', 'casual_eats',
    'fine_dining', 'watch', 'live_performance', 'creative_arts', 'play',
    'wellness', 'flowers', 'groceries'
  )
  AND pp.seeding_category IS NOT NULL
  AND cps.stop_order = (
    SELECT MIN(cps2.stop_order)
    FROM public.card_pool_stops cps2
    WHERE cps2.card_pool_id = cp.id
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- BACKFILL: card_pool.categories[] → slug normalization
-- ═══════════════════════════════════════════════════════════════════════════════

-- Replace display names in the categories array with slugs.
UPDATE public.card_pool
SET categories = (
  SELECT array_agg(
    CASE val
      WHEN 'Nature & Views' THEN 'nature_views'
      WHEN 'First Meet' THEN 'first_meet'
      WHEN 'Picnic Park' THEN 'picnic_park'
      WHEN 'Drink' THEN 'drink'
      WHEN 'Casual Eats' THEN 'casual_eats'
      WHEN 'Fine Dining' THEN 'fine_dining'
      WHEN 'Watch' THEN 'watch'
      WHEN 'Live Performance' THEN 'live_performance'
      WHEN 'Creative & Arts' THEN 'creative_arts'
      WHEN 'Play' THEN 'play'
      WHEN 'Wellness' THEN 'wellness'
      WHEN 'Flowers' THEN 'flowers'
      WHEN 'Groceries' THEN 'groceries'
      -- Google types → slugs (most common curated card types)
      WHEN 'restaurant' THEN 'casual_eats'
      WHEN 'bar' THEN 'drink'
      WHEN 'cocktail_bar' THEN 'drink'
      WHEN 'wine_bar' THEN 'drink'
      WHEN 'pub' THEN 'drink'
      WHEN 'brewery' THEN 'drink'
      WHEN 'park' THEN 'nature_views'
      WHEN 'beach' THEN 'nature_views'
      WHEN 'cafe' THEN 'first_meet'
      WHEN 'coffee_shop' THEN 'first_meet'
      WHEN 'movie_theater' THEN 'watch'
      WHEN 'art_gallery' THEN 'creative_arts'
      WHEN 'museum' THEN 'creative_arts'
      WHEN 'fine_dining_restaurant' THEN 'fine_dining'
      WHEN 'french_restaurant' THEN 'fine_dining'
      WHEN 'steak_house' THEN 'fine_dining'
      WHEN 'performing_arts_theater' THEN 'live_performance'
      WHEN 'concert_hall' THEN 'live_performance'
      WHEN 'bowling_alley' THEN 'play'
      WHEN 'amusement_center' THEN 'play'
      WHEN 'spa' THEN 'wellness'
      WHEN 'florist' THEN 'flowers'
      WHEN 'grocery_store' THEN 'groceries'
      WHEN 'supermarket' THEN 'groceries'
      WHEN 'picnic_ground' THEN 'picnic_park'
      ELSE val -- leave unknown values as-is (will be caught by verification)
    END
  )
  FROM unnest(categories) AS val
)
WHERE categories IS NOT NULL AND array_length(categories, 1) > 0;
