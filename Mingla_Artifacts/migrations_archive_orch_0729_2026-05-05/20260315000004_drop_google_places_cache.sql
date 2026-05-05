-- Drop the google_places_cache table and its cleanup function.
-- No code reads or writes to this table after the placesCache.ts simplification.
-- Deploy this migration AFTER verifying Change 1 (cache code removal) for 24h.

-- Drop the cleanup function that was never called (references the table)
DROP FUNCTION IF EXISTS public.cleanup_expired_places_cache();

-- Drop the table itself
DROP TABLE IF EXISTS public.google_places_cache;
