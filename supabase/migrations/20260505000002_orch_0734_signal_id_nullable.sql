-- ─────────────────────────────────────────────────────────────────────────
-- ORCH-0734 follow-up: relax place_intelligence_trial_runs.signal_id NOT NULL
-- ─────────────────────────────────────────────────────────────────────────
-- The primary ORCH-0734 migration (20260505000001) relaxed the anchor_index
-- CHECK constraint and column nullability. It missed signal_id NOT NULL —
-- the investigation's F-2 only covered anchor_index CHECK, not signal_id
-- nullability. Surfaced at runtime smoke test (operator's first city-runs
-- attempt: "null value in column signal_id violates not-null constraint").
--
-- City-runs rows have no anchor metadata (no signal_id, no anchor_index).
-- Legacy 32-anchor rows preserve their signal_id values; this only relaxes
-- the column to ACCEPT null for new city-runs inserts.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.place_intelligence_trial_runs
  ALTER COLUMN signal_id DROP NOT NULL;

COMMIT;

-- Rollback (within retention window if needed):
--   ALTER TABLE public.place_intelligence_trial_runs
--     ALTER COLUMN signal_id SET NOT NULL;
-- (Note: rollback fails if any city-runs rows have been written with
--  signal_id=NULL by the time of rollback. Operator must DELETE those
--  rows OR backfill signal_id with a sentinel value before re-applying
--  the SET NOT NULL.)
