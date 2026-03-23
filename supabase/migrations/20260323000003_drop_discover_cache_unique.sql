-- Drop the UNIQUE constraint that conflicts with the edge function's
-- categoryHash-based delete+insert caching pattern.
-- The edge function manages uniqueness via delete-by-hash then insert.
-- Multiple rows per user per day are safe — cache reads use
-- ORDER BY created_at DESC LIMIT 5 and filter by categoryHash.

ALTER TABLE public.discover_daily_cache
  DROP CONSTRAINT IF EXISTS discover_daily_cache_user_id_us_date_key_key;
