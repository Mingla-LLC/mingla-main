-- ORCH-0342 Phase 1: Backfill card_pool.city_id for cards missing it
-- MUST run BEFORE Phase 2 (RPC rewrite) to prevent cards from disappearing.
--
-- Strategy A: Cards with place_pool_id → derive city_id from their parent place
-- Strategy B: Cards with text city matching a seeding city name → direct lookup

-- Strategy A: place_pool FK path (most reliable)
UPDATE card_pool cp
SET city_id = pp.city_id, updated_at = now()
FROM place_pool pp
WHERE cp.place_pool_id = pp.id
  AND cp.city_id IS NULL
  AND pp.city_id IS NOT NULL;

-- Strategy B: text city name match to seeding_cities
-- Only for cards still missing city_id after Strategy A
UPDATE card_pool cp
SET city_id = sc.id, updated_at = now()
FROM seeding_cities sc
WHERE cp.city_id IS NULL
  AND cp.city = sc.name;
