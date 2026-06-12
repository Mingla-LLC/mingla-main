-- ===========================================================================
-- ORCH-426 G1 — discover-merged-events scale: cache table + hot-path indexes
-- ===========================================================================
--
-- Phase 2 @ 1k VU showed discover p95 ~9s while checkout paths stayed <200ms.
-- Response cache + event_dates master-end index target the discover fan-out path.
--
BEGIN;

CREATE TABLE IF NOT EXISTS public.discover_merged_events_cache (
  cache_key text PRIMARY KEY,
  response jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discover_merged_cache_expires
  ON public.discover_merged_events_cache (expires_at);

ALTER TABLE public.discover_merged_events_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access discover merged cache"
  ON public.discover_merged_events_cache;
CREATE POLICY "Service role full access discover merged cache"
  ON public.discover_merged_events_cache
  FOR ALL
  USING (true)
  WITH CHECK (true);

GRANT ALL ON TABLE public.discover_merged_events_cache TO service_role;

-- Narrower partial index for consumer discover feed (includes event_type).
DROP INDEX IF EXISTS public.idx_events_discover_feed;
CREATE INDEX idx_events_discover_feed
  ON public.events (city)
  WHERE deleted_at IS NULL
    AND visibility = 'public'
    AND status IN ('scheduled', 'live')
    AND event_type = 'event';

-- Master-date end_at floor used on every discover query path.
CREATE INDEX IF NOT EXISTS idx_event_dates_master_end_at
  ON public.event_dates (event_id, end_at)
  WHERE is_master = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_events_discover_feed'
  ) THEN
    RAISE EXCEPTION 'ORCH-426 discover scale: idx_events_discover_feed missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_event_dates_master_end_at'
  ) THEN
    RAISE EXCEPTION 'ORCH-426 discover scale: idx_event_dates_master_end_at missing';
  END IF;
END $$;

COMMIT;
