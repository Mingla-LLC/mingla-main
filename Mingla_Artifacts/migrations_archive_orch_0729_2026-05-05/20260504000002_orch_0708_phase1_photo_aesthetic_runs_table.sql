-- ORCH-0708 Phase 1 — photo_aesthetic_runs table
--
-- Tracks each invocation of the score-place-photo-aesthetics edge function.
-- One row per "run" (operator click of "Run scorer for {city}"). Mirrors
-- photo_backfill_runs pattern — same lifecycle (ready → running → completed/cancelled/failed).
--
-- Spec: §3.2

BEGIN;

CREATE TABLE IF NOT EXISTS public.photo_aesthetic_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city            TEXT,
  country         TEXT,
  scope_type      TEXT NOT NULL CHECK (scope_type IN ('city', 'place_ids', 'all')),
  scope_place_ids UUID[],
  total_places    INTEGER NOT NULL,
  total_batches   INTEGER NOT NULL,
  batch_size      INTEGER NOT NULL DEFAULT 25,

  completed_batches INTEGER NOT NULL DEFAULT 0,
  failed_batches    INTEGER NOT NULL DEFAULT 0,
  skipped_batches   INTEGER NOT NULL DEFAULT 0,
  total_succeeded   INTEGER NOT NULL DEFAULT 0,
  total_failed      INTEGER NOT NULL DEFAULT 0,
  total_skipped     INTEGER NOT NULL DEFAULT 0,

  estimated_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  actual_cost_usd    NUMERIC(10, 6) NOT NULL DEFAULT 0,

  model         TEXT    NOT NULL DEFAULT 'claude-haiku-4-5',
  use_batch_api BOOLEAN NOT NULL DEFAULT false,
  use_cache     BOOLEAN NOT NULL DEFAULT true,
  force_rescore BOOLEAN NOT NULL DEFAULT false,

  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'running', 'paused', 'completed', 'cancelled', 'failed')),

  triggered_by UUID REFERENCES auth.users(id),
  error_message TEXT,
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photo_aesthetic_runs_status
  ON public.photo_aesthetic_runs (status);
CREATE INDEX IF NOT EXISTS idx_photo_aesthetic_runs_city
  ON public.photo_aesthetic_runs (city, country);
CREATE INDEX IF NOT EXISTS idx_photo_aesthetic_runs_created
  ON public.photo_aesthetic_runs (created_at DESC);

ALTER TABLE public.photo_aesthetic_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_photo_aesthetic_runs" ON public.photo_aesthetic_runs;
CREATE POLICY "service_role_all_photo_aesthetic_runs"
  ON public.photo_aesthetic_runs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "admin_read_photo_aesthetic_runs" ON public.photo_aesthetic_runs;
CREATE POLICY "admin_read_photo_aesthetic_runs"
  ON public.photo_aesthetic_runs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email() AND au.status = 'active'
    )
  );

COMMENT ON TABLE public.photo_aesthetic_runs IS
  'ORCH-0708 (Wave 2 Phase 1): one row per invocation of score-place-photo-aesthetics. Tracks total_places, batch progress, cost, and status. Mirrors photo_backfill_runs pattern.';

COMMIT;
