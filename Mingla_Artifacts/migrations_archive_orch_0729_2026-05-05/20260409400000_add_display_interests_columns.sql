-- Migration: add_display_interests_columns
-- ORCH-0346: Separate profile display interests from deck preferences.
-- display_categories/display_intents are cosmetic (shown on profile).
-- categories/intents remain the deck's exclusive source of truth.

-- Step 1: Add new columns
ALTER TABLE public.preferences
  ADD COLUMN IF NOT EXISTS display_categories text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS display_intents text[] NOT NULL DEFAULT '{}';

-- Step 2: Populate display columns from current data (one-time copy).
UPDATE public.preferences
SET
  display_categories = categories,
  display_intents = intents
WHERE display_categories = '{}' AND display_intents = '{}';

-- Step 3: Normalize deck columns to valid slugs only.
UPDATE public.preferences
SET categories = (
  SELECT COALESCE(array_agg(DISTINCT slug) FILTER (WHERE slug IS NOT NULL), '{}')
  FROM unnest(categories) AS raw_cat,
  LATERAL (
    SELECT CASE lower(trim(raw_cat))
      WHEN 'nature' THEN 'nature'
      WHEN 'nature & views' THEN 'nature'
      WHEN 'nature_views' THEN 'nature'
      WHEN 'first meet' THEN 'first_meet'
      WHEN 'first_meet' THEN 'first_meet'
      WHEN 'picnic park' THEN 'picnic_park'
      WHEN 'picnic_park' THEN 'picnic_park'
      WHEN 'drink' THEN 'drink'
      WHEN 'casual eats' THEN 'casual_eats'
      WHEN 'casual_eats' THEN 'casual_eats'
      WHEN 'fine dining' THEN 'fine_dining'
      WHEN 'fine_dining' THEN 'fine_dining'
      WHEN 'watch' THEN 'watch'
      WHEN 'live performance' THEN 'live_performance'
      WHEN 'live_performance' THEN 'live_performance'
      WHEN 'creative & arts' THEN 'creative_arts'
      WHEN 'creative arts' THEN 'creative_arts'
      WHEN 'creative_arts' THEN 'creative_arts'
      WHEN 'play' THEN 'play'
      WHEN 'wellness' THEN 'wellness'
      WHEN 'flowers' THEN 'flowers'
      WHEN 'groceries & flowers' THEN 'flowers'
      WHEN 'groceries_flowers' THEN 'flowers'
      ELSE NULL
    END AS slug
  ) AS mapped
);

-- Step 4: Cap deck categories at 3
UPDATE public.preferences
SET categories = categories[1:3]
WHERE array_length(categories, 1) > 3;

-- Step 5: Column comments
COMMENT ON COLUMN public.preferences.display_categories IS 'Cosmetic profile interests shown to friends. NOT used by the deck. Written by EditInterestsSheet.';
COMMENT ON COLUMN public.preferences.display_intents IS 'Cosmetic profile intents shown to friends. NOT used by the deck. Written by EditInterestsSheet.';
COMMENT ON COLUMN public.preferences.categories IS 'Deck source of truth. Written ONLY by PreferencesSheet. Always slugs.';
COMMENT ON COLUMN public.preferences.intents IS 'Deck source of truth. Written ONLY by PreferencesSheet. Always slug IDs.';
