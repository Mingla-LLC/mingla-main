-- Wipe corrupt/stale curated pool and cache data
-- This is a one-time cleanup migration

-- 1. Delete impressions that reference curated cards
DELETE FROM user_card_impressions
WHERE card_pool_id IN (
  SELECT id FROM card_pool WHERE card_type = 'curated'
);

-- 2. Delete all curated cards from the pool
DELETE FROM card_pool WHERE card_type = 'curated';

-- 3. Delete all turbo pipeline cache entries
DELETE FROM curated_places_cache WHERE location_key LIKE 'turbo_%';

-- 4. Also delete all curated places cache for good measure
DELETE FROM curated_places_cache;

-- 5. Clean up place_pool entries that are no longer referenced
DELETE FROM place_pool
WHERE id NOT IN (
  SELECT DISTINCT place_pool_id FROM card_pool WHERE place_pool_id IS NOT NULL
);
