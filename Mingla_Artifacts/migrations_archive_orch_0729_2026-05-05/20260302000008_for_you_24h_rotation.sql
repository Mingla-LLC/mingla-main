-- ============================================================
-- For You: 24-hour persistence + batch rotation with exclusion
-- ============================================================
-- Adds:
-- 1. expires_at   — exact 24h expiry per cache row
-- 2. previous_batch_place_ids — place IDs from the batch this one replaced
-- 3. all_place_ids — all Google Place IDs in this batch (heroes + grid)
-- This enables:
--   • True 24h lock (not midnight-based)
--   • Next rotation excludes all cards from removed batch
--   • Category exhaustion recovery (skip only the immediately previous batch)

-- Step 1: Add columns
ALTER TABLE public.discover_daily_cache
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS previous_batch_place_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS all_place_ids TEXT[] DEFAULT '{}';

-- Step 2: Backfill expires_at for existing rows (created_at + 24h)
UPDATE public.discover_daily_cache
SET expires_at = created_at + interval '24 hours'
WHERE expires_at IS NULL;

-- Step 3: Make expires_at NOT NULL + default going forward
ALTER TABLE public.discover_daily_cache
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '24 hours');

-- Step 4: Index on (user_id, expires_at) for fast "is my batch still valid?" lookups
CREATE INDEX IF NOT EXISTS idx_discover_daily_cache_user_expiry
  ON public.discover_daily_cache (user_id, expires_at DESC);
