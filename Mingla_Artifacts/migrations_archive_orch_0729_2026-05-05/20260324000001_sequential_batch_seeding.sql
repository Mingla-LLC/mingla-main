-- Sequential Batch Seeding: seeding_runs + seeding_batches
-- Replaces the fire-and-forget seeding flow with step-by-step manual approval.
-- Each (tile × category) = one batch row. Runs group batches into sessions.

-- ── seeding_runs ──────────────────────────────────────────────────────────────

CREATE TABLE public.seeding_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id UUID NOT NULL REFERENCES seeding_cities(id) ON DELETE CASCADE,

  -- Configuration snapshot
  selected_categories TEXT[] NOT NULL,
  total_tiles INTEGER NOT NULL,
  total_batches INTEGER NOT NULL,

  -- Progress
  completed_batches INTEGER NOT NULL DEFAULT 0,
  failed_batches INTEGER NOT NULL DEFAULT 0,
  skipped_batches INTEGER NOT NULL DEFAULT 0,
  current_batch_index INTEGER,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'paused', 'completed', 'cancelled')),

  -- Aggregated results
  total_api_calls INTEGER NOT NULL DEFAULT 0,
  total_places_new INTEGER NOT NULL DEFAULT 0,
  total_places_duped INTEGER NOT NULL DEFAULT 0,
  total_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,

  -- Timestamps
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_seeding_runs_city ON seeding_runs (city_id);
CREATE INDEX idx_seeding_runs_status ON seeding_runs (status);

-- ── seeding_batches ───────────────────────────────────────────────────────────

CREATE TABLE public.seeding_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES seeding_runs(id) ON DELETE CASCADE,
  city_id UUID NOT NULL REFERENCES seeding_cities(id) ON DELETE CASCADE,
  tile_id UUID NOT NULL REFERENCES seeding_tiles(id) ON DELETE CASCADE,
  tile_index INTEGER NOT NULL,
  seeding_category TEXT NOT NULL,
  app_category TEXT NOT NULL,

  -- Execution order
  batch_index INTEGER NOT NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),

  -- Results (populated on completion)
  google_api_calls INTEGER NOT NULL DEFAULT 0,
  places_returned INTEGER NOT NULL DEFAULT 0,
  places_rejected_no_photos INTEGER NOT NULL DEFAULT 0,
  places_rejected_closed INTEGER NOT NULL DEFAULT 0,
  places_rejected_excluded_type INTEGER NOT NULL DEFAULT 0,
  places_new_inserted INTEGER NOT NULL DEFAULT 0,
  places_duplicate_skipped INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,

  -- Error tracking
  error_message TEXT,
  error_details JSONB,

  -- Timestamps
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_seeding_batches_run ON seeding_batches (run_id);
CREATE INDEX idx_seeding_batches_city ON seeding_batches (city_id);
CREATE INDEX idx_seeding_batches_status ON seeding_batches (status);
CREATE UNIQUE INDEX idx_seeding_batches_order ON seeding_batches (run_id, batch_index);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE seeding_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE seeding_batches ENABLE ROW LEVEL SECURITY;

-- service_role gets full access (edge functions use service_role)
CREATE POLICY "service_role_all_seeding_runs"
  ON seeding_runs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_seeding_batches"
  ON seeding_batches FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- authenticated users can read (admin dashboard reads via anon/authenticated)
CREATE POLICY "authenticated_select_seeding_runs"
  ON seeding_runs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_select_seeding_batches"
  ON seeding_batches FOR SELECT
  TO authenticated
  USING (true);
