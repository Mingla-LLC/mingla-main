-- ORCH-0417: Backfill utc_offset_minutes for places and cards that are missing it.
-- Uses longitude-based approximation: ROUND(lng / 15) * 60 gives the standard-time
-- UTC offset in minutes. This is accurate to within 1 hour (DST not accounted for,
-- same accuracy as filterByDateTime's existing longitude fallback).
--
-- Affected: ~624 places in place_pool, ~808 singles + ~614 curated in card_pool.

-- Step 1: Backfill place_pool
UPDATE public.place_pool
SET utc_offset_minutes = ROUND(lng / 15.0) * 60
WHERE utc_offset_minutes IS NULL
  AND lng IS NOT NULL;

-- Step 2: Cascade to card_pool (singles — have place_pool_id)
UPDATE public.card_pool cp
SET utc_offset_minutes = pp.utc_offset_minutes
FROM public.place_pool pp
WHERE cp.place_pool_id = pp.id
  AND cp.utc_offset_minutes IS NULL
  AND pp.utc_offset_minutes IS NOT NULL;

-- Step 3: Backfill card_pool directly for cards without place_pool_id (curated cards)
UPDATE public.card_pool
SET utc_offset_minutes = ROUND(lng / 15.0) * 60
WHERE utc_offset_minutes IS NULL
  AND lng IS NOT NULL;
