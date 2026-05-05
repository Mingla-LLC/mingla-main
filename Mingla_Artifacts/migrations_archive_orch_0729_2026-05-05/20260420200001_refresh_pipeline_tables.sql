-- ORCH-0553 — Refresh pipeline (parallel to seeding pipeline)
-- Spec: outputs/SPEC_ORCH-0553_REFRESH_PIPELINE.md §2.1
-- Investigation: outputs/INVESTIGATION_ORCH-0553_REFRESH_PIPELINE.md
--
-- Additive only: 2 new tables + 1 new admin_config row.
-- Mirrors seeding_runs/seeding_batches pattern with refresh-specific columns.
--
-- Invariants established by this migration:
--   I-REFRESH-RUN-CITY-EXCLUSIVE     — at most one active refresh run per city
--                                      (enforced at create_refresh_run, not via DB constraint)
--   I-REFRESH-BATCH-RESULTS-COMPLETE — refresh_batches.results JSONB length matches
--                                      array_length(place_ids) when status='completed'
--   I-REFRESH-COST-CAP-RESPECTED     — no run created if estimated cost > $500
--                                      (enforced at create_refresh_run)
--   I-REFRESH-AGGREGATES-EQUAL-SUM   — run aggregates updated atomically with batch updates
--   I-FLAG-DEFAULTS-OFF              — enable_refresh_tab defaults to false
--
-- Carried invariants (must continue to hold):
--   I-REFRESH-NEVER-DEGRADES         — DETAIL_FIELD_MASK in admin-refresh-places
--                                      remains a superset of seed FIELD_MASK
--                                      (already enforced by ORCH-0550.1; nothing here changes it)
--   I-FIELD-MASK-SINGLE-OWNER        — admin-seed-places.FIELD_MASK is authoritative
--                                      (unchanged by this spec)
--
-- Rollback (additive — trivial):
--   DELETE FROM admin_config WHERE key = 'enable_refresh_tab';
--   DROP TABLE IF EXISTS refresh_batches;
--   DROP TABLE IF EXISTS refresh_runs;

-- ── refresh_runs ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.refresh_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id UUID NOT NULL REFERENCES seeding_cities(id) ON DELETE CASCADE,

  -- Filter snapshot (applied at create_refresh_run time)
  filter_categories TEXT[],                          -- NULL = all categories
  filter_stale_days INT,                              -- NULL = no stale filter
  filter_include_failed BOOLEAN NOT NULL DEFAULT false,

  -- Configuration snapshot
  batch_size INT NOT NULL DEFAULT 50,
  total_places INT NOT NULL,
  total_batches INT NOT NULL,

  -- Progress
  completed_batches INT NOT NULL DEFAULT 0,
  failed_batches INT NOT NULL DEFAULT 0,
  skipped_batches INT NOT NULL DEFAULT 0,
  current_batch_index INT,

  -- Status (mirror seeding_runs CHECK exactly)
  status TEXT NOT NULL DEFAULT 'preparing'
    CHECK (status IN ('preparing','ready','running','paused','completed','cancelled','failed_preparing')),

  -- Aggregated results (per-place outcomes summed across batches)
  total_api_calls INT NOT NULL DEFAULT 0,
  places_succeeded INT NOT NULL DEFAULT 0,
  places_failed INT NOT NULL DEFAULT 0,
  places_skipped INT NOT NULL DEFAULT 0,
  total_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,

  -- Timestamps
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Trigger metadata
  triggered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_runs_city ON public.refresh_runs (city_id);
CREATE INDEX IF NOT EXISTS idx_refresh_runs_status ON public.refresh_runs (status);
CREATE INDEX IF NOT EXISTS idx_refresh_runs_city_status ON public.refresh_runs (city_id, status);
CREATE INDEX IF NOT EXISTS idx_refresh_runs_created ON public.refresh_runs (created_at DESC);

-- ── refresh_batches ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.refresh_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES refresh_runs(id) ON DELETE CASCADE,
  city_id UUID NOT NULL REFERENCES seeding_cities(id) ON DELETE CASCADE,

  -- Execution order
  batch_index INT NOT NULL,

  -- Snapshot of which places this batch will refresh (UUID array references place_pool.id)
  place_ids UUID[] NOT NULL,

  -- Status (mirror seeding_batches CHECK exactly)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed','skipped')),

  -- Per-place outcomes (populated on completion)
  -- Shape: [{ "place_id": uuid, "google_place_id": string, "name": string, "success": bool, "error": string|null }]
  results JSONB,
  success_count INT NOT NULL DEFAULT 0,
  failure_count INT NOT NULL DEFAULT 0,

  -- Cost tracking (always batch_size × $0.017 even if some places fail mid-batch)
  google_api_calls INT NOT NULL DEFAULT 0,
  estimated_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,

  -- Error tracking (for batch-level failures only — per-place errors live in results JSONB)
  error_message TEXT,
  error_details JSONB,

  -- Retry tracking
  retry_count INT NOT NULL DEFAULT 0,

  -- Timestamps
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_batches_run ON public.refresh_batches (run_id);
CREATE INDEX IF NOT EXISTS idx_refresh_batches_city ON public.refresh_batches (city_id);
CREATE INDEX IF NOT EXISTS idx_refresh_batches_status ON public.refresh_batches (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_batches_order ON public.refresh_batches (run_id, batch_index);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.refresh_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refresh_batches ENABLE ROW LEVEL SECURITY;

-- service_role gets full access (edge functions use service_role)
CREATE POLICY "service_role_all_refresh_runs"
  ON public.refresh_runs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_refresh_batches"
  ON public.refresh_batches FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- authenticated users can read (admin dashboard reads via authenticated client)
CREATE POLICY "authenticated_select_refresh_runs"
  ON public.refresh_runs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_select_refresh_batches"
  ON public.refresh_batches FOR SELECT
  TO authenticated
  USING (true);

-- ── Feature flag entry ───────────────────────────────────────────────────────
-- Schema: admin_config (key TEXT, value JSONB, updated_by UUID, updated_at TIMESTAMPTZ).
-- Existing prior-art: enable_rules_filter_tab is JSONB boolean per ORCH-0526 M4.1.
-- Operator note: gates Refresh tab + (on AIValidation page) extracted Seed tab.
-- Default false. Flip to true after first successful Raleigh run.

INSERT INTO public.admin_config (key, value)
VALUES (
  'enable_refresh_tab',
  'false'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- ── Verification probes (run after deploy) ───────────────────────────────────

-- Confirm tables exist:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_name IN ('refresh_runs','refresh_batches');
--   -- expect 2 rows

-- Confirm flag exists:
--   SELECT key, value FROM admin_config WHERE key = 'enable_refresh_tab';
--   -- expect: enable_refresh_tab | false
