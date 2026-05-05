-- ORCH-0712 — place_intelligence_trial_runs table
--
-- One row per (run_id, place_pool_id). Stores Claude's Q1+Q2 output.
-- run_id groups all 32 places of a single trial invocation.
--
-- I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING: rows MUST NOT be read by any production
-- scoring or ranking surface. Trial is research-only.
--
-- Spec: Mingla_Artifacts/specs/SPEC_ORCH-0712_TRIAL_INTELLIGENCE.md §3.4

BEGIN;

CREATE TABLE IF NOT EXISTS public.place_intelligence_trial_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL,
  place_pool_id   UUID NOT NULL REFERENCES public.place_pool(id) ON DELETE CASCADE,
  signal_id       TEXT NOT NULL,
  anchor_index    INTEGER NOT NULL CHECK (anchor_index IN (1, 2)),

  input_payload   JSONB NOT NULL,
  collage_url     TEXT,
  reviews_count   INTEGER NOT NULL DEFAULT 0,

  q1_response     JSONB,
  q2_response     JSONB,

  model           TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
  model_version   TEXT,
  prompt_version  TEXT NOT NULL DEFAULT 'v1',
  cost_usd        NUMERIC(10, 6) NOT NULL DEFAULT 0,

  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  error_message   TEXT,

  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pit_runs_run_id ON public.place_intelligence_trial_runs (run_id);
CREATE INDEX IF NOT EXISTS idx_pit_runs_place ON public.place_intelligence_trial_runs (place_pool_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pit_runs_status ON public.place_intelligence_trial_runs (status);

ALTER TABLE public.place_intelligence_trial_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_pit_runs" ON public.place_intelligence_trial_runs;
CREATE POLICY "service_role_all_pit_runs"
  ON public.place_intelligence_trial_runs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "admin_read_pit_runs" ON public.place_intelligence_trial_runs;
CREATE POLICY "admin_read_pit_runs"
  ON public.place_intelligence_trial_runs
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email = auth.email() AND au.status = 'active'));

COMMENT ON TABLE public.place_intelligence_trial_runs IS
  'ORCH-0712 — Claude trial output per (run_id, place). Q1 = open exploration (proposed vibes + signals). Q2 = closed evaluation against existing 16 Mingla signals. I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING: rows MUST NOT be read by production scoring or ranking surfaces.';

COMMIT;
