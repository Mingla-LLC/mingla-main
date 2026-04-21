-- ORCH-0588 Slice 1 — place_scores table
-- One row per (place, signal). Score 0-200, contributions JSONB receipt.
-- Invariants: I-SIGNAL-CONTINUOUS, I-SCORE-NON-NEGATIVE enforced via CHECK.

CREATE TABLE public.place_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id uuid NOT NULL REFERENCES public.place_pool(id) ON DELETE CASCADE,
  signal_id text NOT NULL,
  score numeric NOT NULL,
  contributions jsonb NOT NULL DEFAULT '{}'::jsonb,
  scored_at timestamptz NOT NULL DEFAULT now(),
  signal_version_id uuid,
  CONSTRAINT place_scores_score_range CHECK (score >= 0 AND score <= 200),
  CONSTRAINT place_scores_unique_place_signal UNIQUE (place_id, signal_id)
);

CREATE INDEX place_scores_signal_score_idx
  ON public.place_scores (signal_id, score DESC)
  WHERE score > 0;

CREATE INDEX place_scores_place_id_idx
  ON public.place_scores (place_id);

ALTER TABLE public.place_scores ENABLE ROW LEVEL SECURITY;

-- Service role can do anything (used by run-signal-scorer + RPC).
CREATE POLICY place_scores_service_all ON public.place_scores
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users can SELECT (admin preview reads via Supabase JS client; RPC enforces filter).
CREATE POLICY place_scores_auth_read ON public.place_scores
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.place_scores IS
  'ORCH-0588: per-place per-signal scoring receipts. One row per (place_id, signal_id). Score 0-200 clamped (I-SCORE-NON-NEGATIVE). Contributions JSONB shows breakdown.';

-- ROLLBACK:
-- DROP TABLE IF EXISTS public.place_scores CASCADE;
