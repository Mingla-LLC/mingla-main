-- ─── Card Generation Runs — batch job tracking for single card generation ───
-- Modeled after seeding_runs pattern. One row per city generation job.

CREATE TABLE IF NOT EXISTS public.card_generation_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city            TEXT NOT NULL,
  country         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),

  -- Progress counters (updated after each category)
  total_categories    INTEGER NOT NULL DEFAULT 0,
  completed_categories INTEGER NOT NULL DEFAULT 0,
  current_category    TEXT,

  -- Result counters
  total_created       INTEGER NOT NULL DEFAULT 0,
  total_skipped       INTEGER NOT NULL DEFAULT 0,
  skipped_no_photos   INTEGER NOT NULL DEFAULT 0,
  skipped_duplicate   INTEGER NOT NULL DEFAULT 0,
  skipped_child_venue INTEGER NOT NULL DEFAULT 0,
  total_eligible      INTEGER NOT NULL DEFAULT 0,

  -- Per-category breakdown (JSONB object: { "casual_eats": { created: 10, skipped: 5, eligible: 50 }, ... })
  category_results    JSONB NOT NULL DEFAULT '{}'::JSONB,

  -- Error tracking
  error_message       TEXT,

  -- Timestamps
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,

  -- Who triggered it
  triggered_by        TEXT
);

-- Index for polling active runs by city
CREATE INDEX IF NOT EXISTS idx_card_gen_runs_city_status
  ON public.card_generation_runs (city, status);

-- RLS: admin-only access
ALTER TABLE public.card_generation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read card_generation_runs"
  ON public.card_generation_runs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ));

CREATE POLICY "Admin insert card_generation_runs"
  ON public.card_generation_runs FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ));

-- Service role needs full access for edge function updates
CREATE POLICY "Service role full access card_generation_runs"
  ON public.card_generation_runs FOR ALL
  USING (auth.role() = 'service_role');

-- ─── RPC: poll run status (lightweight) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_card_generation_status(p_run_id UUID)
RETURNS TABLE (
  id                   UUID,
  status               TEXT,
  city                 TEXT,
  country              TEXT,
  total_categories     INTEGER,
  completed_categories INTEGER,
  current_category     TEXT,
  total_created        INTEGER,
  total_skipped        INTEGER,
  skipped_no_photos    INTEGER,
  skipped_duplicate    INTEGER,
  skipped_child_venue  INTEGER,
  total_eligible       INTEGER,
  category_results     JSONB,
  error_message        TEXT,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT r.id, r.status, r.city, r.country,
         r.total_categories, r.completed_categories, r.current_category,
         r.total_created, r.total_skipped,
         r.skipped_no_photos, r.skipped_duplicate, r.skipped_child_venue,
         r.total_eligible, r.category_results, r.error_message,
         r.started_at, r.completed_at
  FROM public.card_generation_runs r
  WHERE r.id = p_run_id;
END;
$$;

-- ─── RPC: get active run for a city (if any) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_card_generation_active(p_city TEXT)
RETURNS TABLE (
  id                   UUID,
  status               TEXT,
  total_categories     INTEGER,
  completed_categories INTEGER,
  current_category     TEXT,
  total_created        INTEGER,
  total_skipped        INTEGER,
  total_eligible       INTEGER,
  category_results     JSONB,
  started_at           TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT r.id, r.status, r.total_categories, r.completed_categories,
         r.current_category, r.total_created, r.total_skipped,
         r.total_eligible, r.category_results, r.started_at
  FROM public.card_generation_runs r
  WHERE r.city = p_city AND r.status = 'running'
  ORDER BY r.started_at DESC
  LIMIT 1;
END;
$$;
