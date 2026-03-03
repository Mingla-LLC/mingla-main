-- Backfill card_pool.website from place_pool.website for existing rows
-- that were inserted before the website column was added (migration 20260302000009).
-- This is the dominant root cause of the "Policies & Reservations" button being hidden:
-- >90% of cards are served from the pool, and all pre-existing rows have website = NULL.

UPDATE public.card_pool cp
SET website = pp.website
FROM public.place_pool pp
WHERE cp.place_pool_id = pp.id
  AND cp.website IS NULL
  AND pp.website IS NOT NULL;
