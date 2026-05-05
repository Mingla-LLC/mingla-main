-- Migration: backfill_website_from_raw_google_data
-- Purpose: Populate website column in place_pool and card_pool from the stored
--          raw_google_data JSONB. This is a pure data backfill — no API calls,
--          no external requests, zero cost. It extracts websiteUri that Google
--          already returned and was stored but never written to the website column.

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 1: Backfill place_pool.website from raw_google_data->>'websiteUri'
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE public.place_pool
SET website = raw_google_data->>'websiteUri'
WHERE (website IS NULL OR website = '')
  AND raw_google_data->>'websiteUri' IS NOT NULL
  AND raw_google_data->>'websiteUri' != '';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 2: Cascade to card_pool — fill card_pool.website from place_pool.website
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE public.card_pool cp
SET website = pp.website
FROM public.place_pool pp
WHERE cp.place_pool_id = pp.id
  AND (cp.website IS NULL OR cp.website = '')
  AND pp.website IS NOT NULL
  AND pp.website != '';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 3: For card_pool rows without place_pool_id, try matching via
--         google_place_id directly
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE public.card_pool cp
SET website = pp.website
FROM public.place_pool pp
WHERE cp.google_place_id = pp.google_place_id
  AND cp.place_pool_id IS NULL
  AND (cp.website IS NULL OR cp.website = '')
  AND pp.website IS NOT NULL
  AND pp.website != '';
