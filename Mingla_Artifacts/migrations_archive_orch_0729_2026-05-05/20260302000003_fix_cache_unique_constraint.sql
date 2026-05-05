-- ============================================================
-- Fix: google_places_cache UNIQUE constraint with nullable text_query
-- Problem: NULL != NULL in PostgreSQL UNIQUE constraints, so
-- nearby-search upserts (text_query=NULL) never match existing rows.
-- Fix: Make text_query NOT NULL DEFAULT '' so all comparisons work.
-- ============================================================

-- Step 1: Update existing NULL values to empty string
UPDATE public.google_places_cache
SET text_query = ''
WHERE text_query IS NULL;

-- Step 2: Drop the old UNIQUE constraint
ALTER TABLE public.google_places_cache
  DROP CONSTRAINT IF EXISTS uq_places_cache_key;

-- Step 3: Make text_query NOT NULL with empty string default
ALTER TABLE public.google_places_cache
  ALTER COLUMN text_query SET NOT NULL,
  ALTER COLUMN text_query SET DEFAULT '';

-- Step 4: Deduplicate any existing duplicate rows (keep the most recent)
DELETE FROM public.google_places_cache a
USING public.google_places_cache b
WHERE a.id < b.id
  AND a.place_type = b.place_type
  AND a.location_key = b.location_key
  AND a.radius_bucket = b.radius_bucket
  AND a.search_strategy = b.search_strategy
  AND a.text_query = b.text_query;

-- Step 5: Recreate UNIQUE constraint (now works correctly since text_query is NOT NULL)
ALTER TABLE public.google_places_cache
  ADD CONSTRAINT uq_places_cache_key
  UNIQUE (place_type, location_key, radius_bucket, search_strategy, text_query);
