-- Fix: Backfill utc_offset_minutes and recoverable opening hours for card_pool
-- Root cause: discover-cards used server UTC time instead of place-local time,
-- causing closed places to appear on the swipeable deck.

-- Part A: Backfill utc_offset_minutes from place_pool to card_pool (single cards)
UPDATE card_pool cp
SET utc_offset_minutes = pp.utc_offset_minutes
FROM place_pool pp
WHERE cp.place_pool_id = pp.id
  AND cp.utc_offset_minutes IS NULL
  AND pp.utc_offset_minutes IS NOT NULL;

-- Part B: Backfill recoverable opening hours from place_pool where card_pool is missing them
UPDATE card_pool cp
SET opening_hours = pp.opening_hours
FROM place_pool pp
WHERE cp.place_pool_id = pp.id
  AND cp.is_active = true
  AND cp.card_type = 'single'
  AND cp.opening_hours IS NULL
  AND pp.opening_hours IS NOT NULL;

-- Part C: Backfill utc_offset_minutes on curated cards from their first stop
UPDATE card_pool cp
SET utc_offset_minutes = sub.offset_min
FROM (
  SELECT DISTINCT ON (cps.card_pool_id)
    cps.card_pool_id,
    pp.utc_offset_minutes AS offset_min
  FROM card_pool_stops cps
  JOIN place_pool pp ON pp.id = cps.place_pool_id
  WHERE pp.utc_offset_minutes IS NOT NULL
  ORDER BY cps.card_pool_id, cps.stop_order ASC
) sub
WHERE cp.id = sub.card_pool_id
  AND cp.card_type = 'curated'
  AND cp.utc_offset_minutes IS NULL;
