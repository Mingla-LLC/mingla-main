-- ============================================================================
-- Photo Backfill Job System — Tables
-- ============================================================================
-- City-scoped photo download with job tracking. Replaces the global
-- "process everything" approach with batched, pausable, cancellable runs.
-- ============================================================================

-- ── photo_backfill_runs ─────────────────────────────────────────────────────
-- One row per download session, scoped to a single city.

CREATE TABLE public.photo_backfill_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope
  city            TEXT NOT NULL,
  country         TEXT NOT NULL,

  -- Configuration snapshot
  total_places    INTEGER NOT NULL,
  total_batches   INTEGER NOT NULL,
  batch_size      INTEGER NOT NULL DEFAULT 10,

  -- Progress counters (updated after each batch)
  completed_batches  INTEGER NOT NULL DEFAULT 0,
  failed_batches     INTEGER NOT NULL DEFAULT 0,
  skipped_batches    INTEGER NOT NULL DEFAULT 0,

  -- Aggregated results
  total_succeeded    INTEGER NOT NULL DEFAULT 0,
  total_failed       INTEGER NOT NULL DEFAULT 0,
  total_skipped      INTEGER NOT NULL DEFAULT 0,

  -- Cost
  estimated_cost_usd  NUMERIC(8,4) NOT NULL DEFAULT 0,
  actual_cost_usd     NUMERIC(8,4) NOT NULL DEFAULT 0,

  -- Status
  status  TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'running', 'paused', 'completed', 'cancelled', 'failed')),

  -- Who
  triggered_by  UUID NOT NULL REFERENCES auth.users(id),

  -- Timestamps
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_photo_runs_status ON photo_backfill_runs (status);
CREATE INDEX idx_photo_runs_city ON photo_backfill_runs (city, country);

ALTER TABLE public.photo_backfill_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_photo_runs" ON public.photo_backfill_runs
  FOR ALL USING (auth.role() = 'service_role');

-- ── photo_backfill_batches ──────────────────────────────────────────────────
-- One row per batch of places to process.

CREATE TABLE public.photo_backfill_batches (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id    UUID NOT NULL REFERENCES photo_backfill_runs(id) ON DELETE CASCADE,

  -- Execution order
  batch_index  INTEGER NOT NULL,

  -- Places this batch is responsible for
  place_pool_ids  UUID[] NOT NULL,
  place_count     INTEGER NOT NULL,

  -- Status
  status  TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),

  -- Results (populated on completion)
  succeeded  INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  skipped    INTEGER NOT NULL DEFAULT 0,

  -- Error tracking
  error_message  TEXT,
  failed_places  JSONB DEFAULT '[]'::jsonb,

  -- Timestamps
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_photo_batches_run ON photo_backfill_batches (run_id);
CREATE INDEX idx_photo_batches_status ON photo_backfill_batches (run_id, status);

ALTER TABLE public.photo_backfill_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_photo_batches" ON public.photo_backfill_batches
  FOR ALL USING (auth.role() = 'service_role');
